package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/structpb"
	corev1 "k8s.io/api/core/v1"
	k8sresource "k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	appk8s "github.com/flyteorg/flyte/v2/app/internal/k8s"
	aionedownloader "github.com/flyteorg/flyte/v2/flyteplugins/aione/downloader"
	pluginutils "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/utils"
	"github.com/flyteorg/flyte/v2/flytestdlib/logger"
	cloudstoragepb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/cloudstorage"
	flyteapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/app"
	flytecoreapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
	"github.com/flyteorg/flyte/v2/runs/repository/interfaces"
	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

const (
	vllmImageAlias        = "vllm"
	defaultVLLMImage      = "docker.ops.fzyun.io:5000/vllm/vllm-openai:latest"
	defaultVLLMPort       = 8000
	defaultModelPVCSize   = "80Gi"
	defaultStorageClass   = "local-path"
	defaultGPUResourceKey = "nvidia.com/gpu"
	modelPVCMountPath     = "/models"
	huggingFaceCachePath  = "/root/.cache/huggingface"
)

var nonDNSLabelChars = regexp.MustCompile(`[^a-z0-9-]+`)

// CreateModelApp builds and deploys a VLLM/OpenAI-compatible App from a
// model-specific request. Secret-bearing downloader params are stored in a K8s
// Secret and are not persisted in the App spec annotation.
func (s *InternalAppService) CreateModelApp(
	ctx context.Context,
	req *connect.Request[flyteapp.CreateModelAppRequest],
) (*connect.Response[flyteapp.CreateResponse], error) {
	input := req.Msg.GetModel()
	if input == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("model input is required"))
	}
	if err := validateModelSourceCredentials(input.GetCodes()); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := validateModelAppCloudStorageMounts(input.GetCloudStorageMounts(), modelAppInputModelPath(input)); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	cloudStorageMounts, err := s.resolveModelAppCloudStorageMounts(ctx, input)
	if err != nil {
		return nil, err
	}

	app, resources, err := buildModelApp(input, cloudStorageMounts)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	if err := s.k8s.DeployWithResources(ctx, app, resources); err != nil {
		logger.Errorf(ctx, "Failed to deploy model app %s: %v", app.GetMetadata().GetId().GetName(), err)
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	for _, mount := range cloudStorageMounts {
		pvcName := modelAppCloudStoragePVCName(mount.storage.ID)
		if err := s.cloudStorageRepo.SetMaterialized(ctx, mount.storage.CloudStorageKey, appk8s.AppNamespace, pvcName); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	app.Status = &flyteapp.Status{
		Ingress: s.k8s.PublicIngress(app.GetMetadata().GetId()),
	}
	return connect.NewResponse(&flyteapp.CreateResponse{App: app}), nil
}

type resolvedModelAppCloudStorageMount struct {
	storage   *models.CloudStorage
	mountPath string
}

func (s *InternalAppService) resolveModelAppCloudStorageMounts(ctx context.Context, input *flyteapp.ModelAppInput) ([]resolvedModelAppCloudStorageMount, error) {
	mounts := input.GetCloudStorageMounts()
	if len(mounts) == 0 {
		return nil, nil
	}
	if s.cloudStorageRepo == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("cloud storage repository is required"))
	}

	resolved := make([]resolvedModelAppCloudStorageMount, 0, len(mounts))
	for _, mount := range mounts {
		key := models.CloudStorageKey{
			Org:     strings.TrimSpace(input.GetOrg()),
			Project: strings.TrimSpace(input.GetProject()),
			Domain:  strings.TrimSpace(input.GetDomain()),
			ID:      strings.TrimSpace(mount.GetCloudStorageId()),
		}
		if _, err := s.cloudStorageRepo.GetByID(ctx, key.ID); err != nil {
			if errors.Is(err, interfaces.ErrCloudStorageIDAmbiguous) {
				return nil, connect.NewError(connect.CodeFailedPrecondition, err)
			}
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check cloud storage id uniqueness: %w", err))
		}
		storage, err := s.cloudStorageRepo.Get(ctx, key)
		if err != nil {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		resolved = append(resolved, resolvedModelAppCloudStorageMount{
			storage:   storage,
			mountPath: normalizeModelAppCloudStorageMountPath(mount.GetMountPath()),
		})
	}
	return resolved, nil
}

func validateModelAppCloudStorageMounts(mounts []*cloudstoragepb.CloudStorageMount, additionalReservedPaths ...string) error {
	reservedPaths := []string{modelPVCMountPath, huggingFaceCachePath}
	reservedPaths = append(reservedPaths, additionalReservedPaths...)
	seenMountPaths := make(map[string]struct{}, len(mounts))
	for _, mount := range mounts {
		cloudStorageID := strings.TrimSpace(mount.GetCloudStorageId())
		mountPath := strings.TrimSpace(mount.GetMountPath())
		if cloudStorageID == "" || mountPath == "" {
			return fmt.Errorf("cloud storage id and mount path are required")
		}
		if !path.IsAbs(mountPath) {
			return fmt.Errorf("cloud storage mount path must be absolute")
		}
		mountPath = normalizeModelAppCloudStorageMountPath(mountPath)
		for _, reservedPath := range reservedPaths {
			if pathIsWithin(mountPath, reservedPath) {
				return fmt.Errorf("cloud storage mount path is reserved for model cache: %s", mountPath)
			}
		}
		if _, ok := seenMountPaths[mountPath]; ok {
			return fmt.Errorf("cloud storage mount path must be unique: %s", mountPath)
		}
		seenMountPaths[mountPath] = struct{}{}
	}
	return nil
}

func pathIsWithin(candidate, parent string) bool {
	candidate = normalizeModelAppCloudStorageMountPath(candidate)
	parent = normalizeModelAppCloudStorageMountPath(parent)
	return parent != "." && (candidate == parent || strings.HasPrefix(candidate, parent+"/"))
}

func modelAppInputModelPath(input *flyteapp.ModelAppInput) string {
	modelCode := strings.TrimSpace(input.GetCode())
	if modelCode == "" {
		modelCode = safeDNSLabel(firstNonEmpty(input.GetId(), input.GetName()), 30)
	}
	modelPath, _ := modelDownloadCodes(input, modelCode)
	return modelPath
}

func normalizeModelAppCloudStorageMountPath(mountPath string) string {
	return path.Clean(strings.TrimSpace(mountPath))
}

func buildModelApp(input *flyteapp.ModelAppInput, cloudStorageMounts []resolvedModelAppCloudStorageMount) (*flyteapp.App, appk8s.AppAuxResources, error) {
	project := strings.TrimSpace(input.GetProject())
	domain := strings.TrimSpace(input.GetDomain())
	if project == "" || domain == "" {
		return nil, appk8s.AppAuxResources{}, fmt.Errorf("project and domain are required")
	}

	modelCode := strings.TrimSpace(input.GetCode())
	appNameSeed := firstNonEmpty(input.GetId(), modelCode, input.GetName())
	appName := safeDNSLabel(appNameSeed, 30)
	if appName == "" {
		return nil, appk8s.AppAuxResources{}, fmt.Errorf("model id, code, or name is required")
	}
	if modelCode == "" {
		modelCode = appName
	}
	if err := validateModelResourceDefinition(input.GetResourceDefinition()); err != nil {
		return nil, appk8s.AppAuxResources{}, err
	}

	appID := &flyteapp.Identifier{
		Org:     strings.TrimSpace(input.GetOrg()),
		Project: project,
		Domain:  domain,
		Name:    appName,
	}

	image := resolveModelImage(input.GetImage())
	args := splitModelArgs(input.GetParam())
	modelPath, downloaderCodes := modelDownloadCodes(input, modelCode)
	if modelPath != "" {
		args = ensureModelArg(args, modelPath)
	}
	args = ensureArgPair(args, "--host", "0.0.0.0")
	args = ensureArgPair(args, "--port", strconv.Itoa(defaultVLLMPort))
	port := modelPort(args)

	pvcName := auxResourceName(appID, "model-cache")
	secretName := auxResourceName(appID, "model-downloader")
	podSpec := buildModelPodSpec(image, args, port, input.GetResourceDefinition(), pvcName, secretName, len(downloaderCodes) > 0)
	resources, err := buildModelAuxResources(pvcName, secretName, downloaderCodes)
	if err != nil {
		return nil, appk8s.AppAuxResources{}, err
	}
	addModelAppCloudStorageResources(&podSpec, &resources, cloudStorageMounts)
	podStruct, err := podSpecToStruct(podSpec)
	if err != nil {
		return nil, appk8s.AppAuxResources{}, err
	}

	displayName := strings.TrimSpace(input.GetName())
	if displayName == "" {
		displayName = modelCode
	}
	app := &flyteapp.App{
		Metadata: &flyteapp.Meta{Id: appID},
		Spec: &flyteapp.Spec{
			AppPayload: &flyteapp.Spec_Pod{
				Pod: &flytecoreapp.K8SPod{
					PodSpec:              podStruct,
					PrimaryContainerName: "vllm",
				},
			},
			Autoscaling:  &flyteapp.AutoscalingConfig{Replicas: &flyteapp.Replicas{Min: 1, Max: 1}},
			DesiredState: flyteapp.Spec_DESIRED_STATE_ACTIVE,
			Profile: &flyteapp.Profile{
				Type:             "VLLM",
				Name:             displayName,
				ShortDescription: "OpenAI-compatible model server",
			},
			Inputs:   modelInputs(input, modelCode, modelPath, pvcName),
			Links:    []*flyteapp.Link{{Path: "/v1/models", Title: "Models", IsRelative: true}},
			Timeouts: &flyteapp.TimeoutConfig{RequestTimeout: durationpb.New(time.Hour)},
		},
	}
	return app, resources, nil
}

func addModelAppCloudStorageResources(podSpec *corev1.PodSpec, resources *appk8s.AppAuxResources, mounts []resolvedModelAppCloudStorageMount) {
	mainContainerIndex := -1
	for i := range podSpec.Containers {
		if podSpec.Containers[i].Name == vllmImageAlias {
			mainContainerIndex = i
			break
		}
	}
	if mainContainerIndex < 0 {
		return
	}

	for i, mount := range mounts {
		volumeName := fmt.Sprintf("cloud-storage-%d", i)
		pvcName := modelAppCloudStoragePVCName(mount.storage.ID)
		storageClass := mount.storage.StorageClass
		resources.PersistentVolumeClaims = append(resources.PersistentVolumeClaims, &corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{
				Name:      pvcName,
				Namespace: appk8s.AppNamespace,
				Labels: map[string]string{
					"flyte.org/cloud-storage":    "true",
					"flyte.org/cloud-storage-id": mount.storage.ID,
				},
			},
			Spec: corev1.PersistentVolumeClaimSpec{
				AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				StorageClassName: &storageClass,
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceStorage: k8sresource.MustParse(fmt.Sprintf("%dGi", mount.storage.SizeGB)),
					},
				},
			},
		})
		podSpec.Volumes = append(podSpec.Volumes, corev1.Volume{
			Name: volumeName,
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pvcName},
			},
		})
		podSpec.Containers[mainContainerIndex].VolumeMounts = append(
			podSpec.Containers[mainContainerIndex].VolumeMounts,
			corev1.VolumeMount{Name: volumeName, MountPath: mount.mountPath},
		)
	}
}

func modelAppCloudStoragePVCName(id string) string {
	return pluginutils.ConvertToDNS1123SubdomainCompatibleString("cs-" + id)
}

func buildModelPodSpec(image string, args []string, port int32, resourceDefinition *flyteapp.ModelResourceDefinition, pvcName, secretName string, hasDownloader bool) corev1.PodSpec {
	volumeName := "models"
	main := corev1.Container{
		Name:            "vllm",
		Image:           image,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Args:            args,
		Ports:           []corev1.ContainerPort{{Name: "http1", ContainerPort: port}},
		Env:             []corev1.EnvVar{{Name: "HF_HOME", Value: huggingFaceCachePath}},
		Resources:       modelResourceRequirements(resourceDefinition),
		VolumeMounts: []corev1.VolumeMount{
			{Name: volumeName, MountPath: modelPVCMountPath},
			{Name: volumeName, MountPath: huggingFaceCachePath},
		},
		ReadinessProbe: modelHTTPProbe(port, 0, 10, 3),
		StartupProbe:   modelHTTPProbe(port, 10, 10, 180),
	}

	podSpec := corev1.PodSpec{
		Containers: []corev1.Container{main},
		Volumes: []corev1.Volume{{
			Name: volumeName,
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: pvcName},
			},
		}},
		EnableServiceLinks: boolPtr(false),
	}
	if hasDownloader {
		podSpec.InitContainers = []corev1.Container{{
			Name:            "model-downloader",
			Image:           aionedownloader.Image(os.Getenv("AIONE_DOWNLOADER_IMAGE")),
			ImagePullPolicy: corev1.PullIfNotPresent,
			Env:             []corev1.EnvVar{aionedownloader.EnvVar(secretName)},
			VolumeMounts:    []corev1.VolumeMount{{Name: volumeName, MountPath: modelPVCMountPath}},
		}}
	}
	return podSpec
}

func modelHTTPProbe(port int32, initialDelaySeconds int32, periodSeconds int32, failureThreshold int32) *corev1.Probe {
	return &corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{
			HTTPGet: &corev1.HTTPGetAction{Path: "/v1/models", Port: intstr.FromInt32(port)},
		},
		InitialDelaySeconds: initialDelaySeconds,
		PeriodSeconds:       periodSeconds,
		FailureThreshold:    failureThreshold,
	}
}

func modelResourceRequirements(def *flyteapp.ModelResourceDefinition) corev1.ResourceRequirements {
	reqs := corev1.ResourceList{}
	limits := corev1.ResourceList{}
	if cpu := strings.TrimSpace(def.GetCpu()); cpu != "" {
		q := k8sresource.MustParse(cpu)
		reqs[corev1.ResourceCPU] = q
		limits[corev1.ResourceCPU] = q
	}
	if memory := strings.TrimSpace(def.GetMemory()); memory != "" {
		q := k8sresource.MustParse(memory)
		reqs[corev1.ResourceMemory] = q
		limits[corev1.ResourceMemory] = q
	}
	if gpu := def.GetGpu(); gpu > 0 {
		key := strings.TrimSpace(def.GetGpuKey())
		if key == "" {
			key = defaultGPUResourceKey
		}
		q := k8sresource.MustParse(strconv.FormatUint(uint64(gpu), 10))
		reqs[corev1.ResourceName(key)] = q
		limits[corev1.ResourceName(key)] = q
	}
	return corev1.ResourceRequirements{Requests: reqs, Limits: limits}
}

func buildModelAuxResources(pvcName, secretName string, codes []aionedownloader.Code) (appk8s.AppAuxResources, error) {
	storageClassName := defaultStorageClass
	resources := appk8s.AppAuxResources{
		PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{{
			ObjectMeta: metav1.ObjectMeta{Name: pvcName, Namespace: appk8s.AppNamespace},
			Spec: corev1.PersistentVolumeClaimSpec{
				AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
				StorageClassName: &storageClassName,
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceStorage: k8sresource.MustParse(defaultModelPVCSize)},
				},
			},
		}},
	}
	if len(codes) == 0 {
		return resources, nil
	}
	data, err := aionedownloader.SecretValue(aionedownloader.Params{Codes: codes})
	if err != nil {
		return appk8s.AppAuxResources{}, err
	}
	resources.Secrets = []*corev1.Secret{{
		ObjectMeta: metav1.ObjectMeta{Name: secretName, Namespace: appk8s.AppNamespace},
		Type:       corev1.SecretTypeOpaque,
		Data:       map[string][]byte{aionedownloader.SecretKey: data},
	}}
	return resources, nil
}

func modelInputs(input *flyteapp.ModelAppInput, modelCode, modelPath, pvcName string) *flyteapp.InputList {
	def := input.GetResourceDefinition()
	items := []*flyteapp.Input{
		stringInput("code", modelCode),
		stringInput("image", resolveModelImage(input.GetImage())),
		stringInput("model_cache_pvc", pvcName),
	}
	if modelPath != "" {
		items = append(items, stringInput("model_path", modelPath))
	}
	if sources := redactedModelSources(input, modelCode); sources != "" {
		items = append(items, stringInput("model_sources", sources))
	}
	if mounts := persistedModelCloudStorageMounts(input.GetCloudStorageMounts()); mounts != "" {
		items = append(items, stringInput("cloud_storage_mounts", mounts))
	}
	if cpu := strings.TrimSpace(def.GetCpu()); cpu != "" {
		items = append(items, stringInput("cpu", cpu))
	}
	if memory := strings.TrimSpace(def.GetMemory()); memory != "" {
		items = append(items, stringInput("memory", memory))
	}
	if gpu := def.GetGpu(); gpu > 0 {
		items = append(items, stringInput("gpu", strconv.FormatUint(uint64(gpu), 10)))
	}
	key := strings.TrimSpace(def.GetGpuKey())
	if key == "" && def.GetGpu() > 0 {
		key = defaultGPUResourceKey
	}
	if key != "" {
		items = append(items, stringInput("gpu_key", key))
	}
	return &flyteapp.InputList{Items: items}
}

func redactedModelSources(input *flyteapp.ModelAppInput, modelCode string) string {
	_, codes := modelDownloadCodes(input, modelCode)
	if len(codes) == 0 {
		return ""
	}
	views := make([]*flyteapp.ModelCodeSourceView, 0, len(codes))
	for _, code := range codes {
		sanitizedID, sensitive, valid := sanitizeRepositoryID(code.ID)
		views = append(views, &flyteapp.ModelCodeSourceView{
			Id: sanitizedID, Branch: code.Branch, Path: code.Path, TokenConfigured: code.Token != "" || sensitive || !valid,
		})
	}
	raw, err := json.Marshal(views)
	if err != nil {
		return ""
	}
	return string(raw)
}

func persistedModelCloudStorageMounts(mounts []*cloudstoragepb.CloudStorageMount) string {
	if len(mounts) == 0 {
		return ""
	}
	persisted := make([]*cloudstoragepb.CloudStorageMount, 0, len(mounts))
	for _, mount := range mounts {
		persisted = append(persisted, &cloudstoragepb.CloudStorageMount{
			CloudStorageId: strings.TrimSpace(mount.GetCloudStorageId()),
			MountPath:      normalizeModelAppCloudStorageMountPath(mount.GetMountPath()),
		})
	}
	raw, err := json.Marshal(persisted)
	if err != nil {
		return ""
	}
	return string(raw)
}

func validateModelSourceCredentials(sources []*flyteapp.ModelCodeSource) error {
	for _, source := range sources {
		_, sensitive, valid := sanitizeRepositoryID(source.GetId())
		if !valid {
			return fmt.Errorf("repository URL must be an absolute HTTP(S), SSH, or Git URL with a host")
		}
		if sensitive {
			return fmt.Errorf("repository URL must not contain userinfo, query parameters, or a fragment; use the token field")
		}
	}
	return nil
}

func sanitizeRepositoryID(id string) (string, bool, bool) {
	id = strings.TrimSpace(id)
	parsed, err := url.Parse(id)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || !supportedRepositoryScheme(parsed.Scheme) {
		return "", true, false
	}
	sensitive := parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawFragment != ""
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	parsed.RawFragment = ""
	return parsed.String(), sensitive, true
}

func supportedRepositoryScheme(scheme string) bool {
	switch strings.ToLower(scheme) {
	case "http", "https", "ssh", "git":
		return true
	default:
		return false
	}
}

func validateModelResourceDefinition(def *flyteapp.ModelResourceDefinition) error {
	if cpu := strings.TrimSpace(def.GetCpu()); cpu != "" {
		if _, err := k8sresource.ParseQuantity(cpu); err != nil {
			return fmt.Errorf("invalid CPU quantity %q: %w", cpu, err)
		}
	}
	if memory := strings.TrimSpace(def.GetMemory()); memory != "" {
		if _, err := k8sresource.ParseQuantity(memory); err != nil {
			return fmt.Errorf("invalid memory quantity %q: %w", memory, err)
		}
	}
	return nil
}

func stringInput(name, value string) *flyteapp.Input {
	return &flyteapp.Input{Name: name, Value: &flyteapp.Input_StringValue{StringValue: value}}
}

func modelDownloadCodes(input *flyteapp.ModelAppInput, modelCode string) (string, []aionedownloader.Code) {
	codes := input.GetCodes()
	if len(codes) == 0 {
		return "", nil
	}
	out := make([]aionedownloader.Code, 0, len(codes))
	var primaryPath string
	for i, source := range codes {
		if strings.TrimSpace(source.GetId()) == "" {
			continue
		}
		targetPath := strings.TrimSpace(source.GetPath())
		if targetPath == "" {
			seed := modelCode
			if i > 0 {
				seed = source.GetId()
			}
			targetPath = path.Join(modelPVCMountPath, safePathSegment(seed))
		}
		if primaryPath == "" {
			primaryPath = targetPath
		}
		branch := strings.TrimSpace(source.GetBranch())
		if branch == "" {
			branch = "master"
		}
		out = append(out, aionedownloader.Code{
			ID:     strings.TrimSpace(source.GetId()),
			Path:   targetPath,
			Token:  source.GetToken(),
			Branch: branch,
		})
	}
	return primaryPath, out
}

func resolveModelImage(image string) string {
	image = strings.TrimSpace(image)
	if image == "" || strings.EqualFold(image, vllmImageAlias) {
		return defaultVLLMImage
	}
	return image
}

func splitModelArgs(param string) []string {
	if strings.TrimSpace(param) == "" {
		return nil
	}
	param = strings.ReplaceAll(param, "\r\n", "\n")
	parts := strings.Split(param, "\n")
	args := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			args = append(args, part)
		}
	}
	return args
}

func ensureArgPair(args []string, flag, value string) []string {
	if hasArg(args, flag) {
		return args
	}
	return append(args, flag, value)
}

func ensureModelArg(args []string, modelPath string) []string {
	for i, arg := range args {
		if arg == "--model" {
			if i+1 >= len(args) {
				return append(args, modelPath)
			}
			if isPlaceholderModel(args[i+1]) {
				args[i+1] = modelPath
			}
			return args
		}
		if strings.HasPrefix(arg, "--model=") {
			value := strings.TrimPrefix(arg, "--model=")
			if isPlaceholderModel(value) {
				args[i] = "--model=" + modelPath
			}
			return args
		}
	}
	return append(args, "--model", modelPath)
}

func hasArg(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag || strings.HasPrefix(arg, flag+"=") {
			return true
		}
	}
	return false
}

func isPlaceholderModel(value string) bool {
	value = strings.TrimSpace(strings.ToLower(value))
	switch value {
	case "", "model", "model-path", "model_path", "path-to-model", "/path/to/model", "your-model", "your_model", "{{model_path}}", "{{model}}", "${model_path}", "<model>", "<model-path>":
		return true
	default:
		return false
	}
}

func modelPort(args []string) int32 {
	for i, arg := range args {
		var value string
		if arg == "--port" && i+1 < len(args) {
			value = args[i+1]
		} else if strings.HasPrefix(arg, "--port=") {
			value = strings.TrimPrefix(arg, "--port=")
		}
		if value == "" {
			continue
		}
		port, err := strconv.ParseInt(value, 10, 32)
		if err == nil && port > 0 {
			return int32(port)
		}
	}
	return defaultVLLMPort
}

func podSpecToStruct(podSpec corev1.PodSpec) (*structpb.Struct, error) {
	raw, err := json.Marshal(podSpec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal model pod spec: %w", err)
	}
	var fields map[string]interface{}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, fmt.Errorf("failed to unmarshal model pod spec JSON: %w", err)
	}
	out, err := structpb.NewStruct(fields)
	if err != nil {
		return nil, fmt.Errorf("failed to convert model pod spec to struct: %w", err)
	}
	return out, nil
}

func safePathSegment(seed string) string {
	if u, err := url.Parse(seed); err == nil && u.Path != "" {
		base := path.Base(strings.TrimSuffix(u.Path, "/"))
		if base != "." && base != "/" {
			seed = strings.TrimSuffix(base, ".git")
		}
	}
	label := safeDNSLabel(seed, 63)
	if label == "" {
		return "model"
	}
	return label
}

func safeDNSLabel(seed string, maxLen int) string {
	value := strings.ToLower(strings.TrimSpace(seed))
	value = nonDNSLabelChars.ReplaceAllString(value, "-")
	value = strings.Trim(value, "-")
	for strings.Contains(value, "--") {
		value = strings.ReplaceAll(value, "--", "-")
	}
	if value == "" {
		return ""
	}
	if len(value) <= maxLen {
		return value
	}
	sum := sha256.Sum256([]byte(value))
	suffix := hex.EncodeToString(sum[:4])
	prefixLen := maxLen - len(suffix) - 1
	if prefixLen < 1 {
		return suffix[:maxLen]
	}
	return strings.TrimRight(value[:prefixLen], "-") + "-" + suffix
}

func auxResourceName(appID *flyteapp.Identifier, suffix string) string {
	return safeDNSLabel(appk8s.AppResourceName(appID)+"-"+suffix, 63)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func boolPtr(b bool) *bool { return &b }
