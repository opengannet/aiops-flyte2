package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	corev1 "k8s.io/api/core/v1"

	appk8s "github.com/flyteorg/flyte/v2/app/internal/k8s"
	aionedownloader "github.com/flyteorg/flyte/v2/flyteplugins/aione/downloader"
	cloudstoragepb "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/cloudstorage"
	flyteapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/app"
)

func (s *InternalAppService) GetModelAppConfig(
	ctx context.Context,
	req *connect.Request[flyteapp.GetModelAppConfigRequest],
) (*connect.Response[flyteapp.GetModelAppConfigResponse], error) {
	appID := req.Msg.GetAppId()
	if appID == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("app_id is required"))
	}
	app, err := s.getApp(ctx, appID)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(app.GetSpec().GetProfile().GetType(), "VLLM") {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("app %s is not a VLLM model app", appID.GetName()))
	}
	podSpec, err := s.k8s.GetRuntimePodSpec(ctx, appID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	container, err := primaryModelContainer(app, podSpec)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	codes, err := s.modelCodeSourceViews(ctx, app)
	if err != nil {
		return nil, err
	}
	model := &flyteapp.ModelAppConfig{
		AppId:              appID,
		Name:               app.GetSpec().GetProfile().GetName(),
		Code:               modelInputString(app, "code"),
		Image:              container.Image,
		Param:              strings.Join(editableModelArgs(container.Args), "\n"),
		Codes:              codes,
		ResourceDefinition: modelResourcesFromContainer(app, container),
		CloudStorageMounts: modelCloudStorageMounts(podSpec, container),
	}
	return connect.NewResponse(&flyteapp.GetModelAppConfigResponse{Model: model}), nil
}

func (s *InternalAppService) UpdateModelApp(
	ctx context.Context,
	req *connect.Request[flyteapp.UpdateModelAppRequest],
) (*connect.Response[flyteapp.UpdateModelAppResponse], error) {
	appID := req.Msg.GetAppId()
	if appID == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("app_id is required"))
	}
	existing, err := s.getApp(ctx, appID)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(existing.GetSpec().GetProfile().GetType(), "VLLM") {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("app %s is not a VLLM model app", appID.GetName()))
	}
	if err := validateModelAppCloudStorageMounts(req.Msg.GetCloudStorageMounts()); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	codes, err := s.modelDownloaderCodes(ctx, existing)
	if err != nil {
		return nil, err
	}
	input := &flyteapp.ModelAppInput{
		Org:                appID.GetOrg(),
		Project:            appID.GetProject(),
		Domain:             appID.GetDomain(),
		Name:               req.Msg.GetName(),
		Id:                 appID.GetName(),
		Code:               modelInputString(existing, "code"),
		Image:              req.Msg.GetImage(),
		Param:              req.Msg.GetParam(),
		Codes:              downloaderCodesToModelSources(codes),
		ResourceDefinition: req.Msg.GetResourceDefinition(),
		CloudStorageMounts: req.Msg.GetCloudStorageMounts(),
	}
	cloudStorageMounts, err := s.resolveModelAppCloudStorageMounts(ctx, input)
	if err != nil {
		return nil, err
	}
	updated, resources, err := buildModelApp(input, cloudStorageMounts)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	if err := s.k8s.RedeployWithResources(ctx, updated, resources); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	for _, mount := range cloudStorageMounts {
		pvcName := modelAppCloudStoragePVCName(mount.storage.ID)
		if err := s.cloudStorageRepo.SetMaterialized(ctx, mount.storage.CloudStorageKey, appk8s.AppNamespace, pvcName); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}
	updated.Status = &flyteapp.Status{Ingress: s.k8s.PublicIngress(appID)}
	return connect.NewResponse(&flyteapp.UpdateModelAppResponse{App: updated}), nil
}

func primaryModelContainer(app *flyteapp.App, podSpec *corev1.PodSpec) (*corev1.Container, error) {
	primaryName := app.GetSpec().GetPod().GetPrimaryContainerName()
	for i := range podSpec.Containers {
		if primaryName == "" || podSpec.Containers[i].Name == primaryName {
			return &podSpec.Containers[i], nil
		}
	}
	return nil, fmt.Errorf("model app has no primary container")
}

func editableModelArgs(args []string) []string {
	result := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--model" {
			i++
			continue
		}
		if strings.HasPrefix(arg, "--model=") {
			continue
		}
		if arg == "--host" && i+1 < len(args) && args[i+1] == "0.0.0.0" {
			i++
			continue
		}
		if arg == "--host=0.0.0.0" || arg == "--port="+strconv.Itoa(defaultVLLMPort) {
			continue
		}
		if arg == "--port" && i+1 < len(args) && args[i+1] == strconv.Itoa(defaultVLLMPort) {
			i++
			continue
		}
		result = append(result, arg)
	}
	return result
}

func (s *InternalAppService) modelCodeSourceViews(ctx context.Context, app *flyteapp.App) ([]*flyteapp.ModelCodeSourceView, error) {
	if persisted := modelInputString(app, "model_sources"); persisted != "" {
		views := make([]*flyteapp.ModelCodeSourceView, 0)
		if err := json.Unmarshal([]byte(persisted), &views); err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to parse persisted model sources: %w", err))
		}
		return views, nil
	}
	codes, err := s.modelDownloaderCodes(ctx, app)
	if err != nil {
		return nil, err
	}
	views := make([]*flyteapp.ModelCodeSourceView, 0, len(codes))
	for _, code := range codes {
		views = append(views, &flyteapp.ModelCodeSourceView{
			Id: code.ID, Branch: code.Branch, Path: code.Path, TokenConfigured: code.Token != "",
		})
	}
	return views, nil
}

func (s *InternalAppService) modelDownloaderCodes(ctx context.Context, app *flyteapp.App) ([]aionedownloader.Code, error) {
	if modelInputString(app, "model_path") == "" {
		return nil, nil
	}
	appID := app.GetMetadata().GetId()
	secretName := auxResourceName(appID, "model-downloader")
	secret, err := s.k8s.GetAuxSecret(ctx, appID, secretName)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to read model source: %w", err))
	}
	encoded := secret.Data[aionedownloader.SecretKey]
	raw, err := base64.StdEncoding.DecodeString(string(encoded))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to decode model source: %w", err))
	}
	params := aionedownloader.Params{}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to parse model source: %w", err))
	}
	return params.Codes, nil
}

func downloaderCodesToModelSources(codes []aionedownloader.Code) []*flyteapp.ModelCodeSource {
	sources := make([]*flyteapp.ModelCodeSource, 0, len(codes))
	for _, code := range codes {
		sources = append(sources, &flyteapp.ModelCodeSource{Id: code.ID, Branch: code.Branch, Path: code.Path, Token: code.Token})
	}
	return sources
}

func modelInputString(app *flyteapp.App, name string) string {
	for _, input := range app.GetSpec().GetInputs().GetItems() {
		if input.GetName() == name {
			return input.GetStringValue()
		}
	}
	return ""
}

func modelResourcesFromContainer(app *flyteapp.App, container *corev1.Container) *flyteapp.ModelResourceDefinition {
	definition := &flyteapp.ModelResourceDefinition{}
	if quantity, ok := container.Resources.Requests[corev1.ResourceCPU]; ok {
		definition.Cpu = quantity.String()
	}
	if quantity, ok := container.Resources.Requests[corev1.ResourceMemory]; ok {
		definition.Memory = quantity.String()
	}
	definition.GpuKey = modelInputString(app, "gpu_key")
	if definition.GpuKey != "" {
		if quantity, ok := container.Resources.Requests[corev1.ResourceName(definition.GpuKey)]; ok {
			value, _ := quantity.AsInt64()
			if value > 0 {
				definition.Gpu = uint32(value)
			}
		}
	}
	return definition
}

func modelCloudStorageMounts(podSpec *corev1.PodSpec, container *corev1.Container) []*cloudstoragepb.CloudStorageMount {
	mountPaths := make(map[string]string, len(container.VolumeMounts))
	for _, mount := range container.VolumeMounts {
		mountPaths[mount.Name] = mount.MountPath
	}
	result := make([]*cloudstoragepb.CloudStorageMount, 0)
	for _, volume := range podSpec.Volumes {
		claim := volume.PersistentVolumeClaim
		mountPath := mountPaths[volume.Name]
		if !strings.HasPrefix(volume.Name, "cloud-storage-") || claim == nil || !strings.HasPrefix(claim.ClaimName, "cs-") || mountPath == "" {
			continue
		}
		result = append(result, &cloudstoragepb.CloudStorageMount{CloudStorageId: strings.TrimPrefix(claim.ClaimName, "cs-"), MountPath: mountPath})
	}
	return result
}
