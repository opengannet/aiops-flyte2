package k8s

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	k8sresource "k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/util/intstr"
	ctrlclient "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	"github.com/flyteorg/flyte/v2/app/internal/config"
	flyteapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/app"
	flytecoreapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

func testScheme(t *testing.T) *runtime.Scheme {
	t.Helper()
	scheme := runtime.NewScheme()
	require.NoError(t, appsv1.AddToScheme(scheme))
	require.NoError(t, corev1.AddToScheme(scheme))
	require.NoError(t, networkingv1.AddToScheme(scheme))
	require.NoError(t, storagev1.AddToScheme(scheme))
	return scheme
}

func testClient(t *testing.T, objects ...ctrlclient.Object) *AppK8sClient {
	t.Helper()
	client := fake.NewClientBuilder().WithScheme(testScheme(t)).WithStatusSubresource(&appsv1.Deployment{}).WithObjects(objects...).Build()
	return NewAppK8sClient(client, nil, AppNamespace, &config.InternalAppConfig{BaseDomain: "ops.fzyun.io", Scheme: "https", IngressClassName: "traefik", WatchBufferSize: 10, NamespacedNameSuffixTemplate: "{{ project }}-{{ domain }}"})
}

func testApp(project, domain, name, image string) *flyteapp.App {
	return &flyteapp.App{Metadata: &flyteapp.Meta{Id: &flyteapp.Identifier{Project: project, Domain: domain, Name: name}}, Spec: &flyteapp.Spec{AppPayload: &flyteapp.Spec_Container{Container: &flytecoreapp.Container{Image: image}}}}
}

func podSpecStruct(t *testing.T, podSpec corev1.PodSpec) *structpb.Struct {
	t.Helper()
	raw, err := json.Marshal(podSpec)
	require.NoError(t, err)
	var fields map[string]any
	require.NoError(t, json.Unmarshal(raw, &fields))
	result, err := structpb.NewStruct(fields)
	require.NoError(t, err)
	return result
}

func TestDeploy_CreateNativeResources(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "myapp", "nginx:latest")
	require.NoError(t, client.Deploy(context.Background(), app))

	deployment := &appsv1.Deployment{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), deployment))
	assert.Equal(t, int32(1), *deployment.Spec.Replicas)
	assert.Equal(t, appsv1.RecreateDeploymentStrategyType, deployment.Spec.Strategy.Type)
	assert.Equal(t, "proj/dev/myapp", deployment.Annotations[annotationAppID])
	assert.Equal(t, "nginx:latest", deployment.Spec.Template.Spec.Containers[0].Image)

	service := &corev1.Service{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), service))
	assert.Equal(t, corev1.ServiceTypeClusterIP, service.Spec.Type)
	assert.Equal(t, int32(80), service.Spec.Ports[0].Port)
	assert.Equal(t, int32(8080), service.Spec.Ports[0].TargetPort.IntVal)

	ingress := &networkingv1.Ingress{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), ingress))
	assert.Equal(t, "myapp-proj-dev.ops.fzyun.io", ingress.Spec.Rules[0].Host)
	require.NotNil(t, ingress.Spec.IngressClassName)
	assert.Equal(t, "traefik", *ingress.Spec.IngressClassName)
}

func TestDeploy_UsesConfiguredNamespace(t *testing.T) {
	k8sClient := fake.NewClientBuilder().WithScheme(testScheme(t)).WithStatusSubresource(&appsv1.Deployment{}).Build()
	client := NewAppK8sClient(k8sClient, nil, "custom-apps", &config.InternalAppConfig{
		BaseDomain:                   "ops.fzyun.io",
		IngressClassName:             "traefik",
		NamespacedNameSuffixTemplate: "{{ project }}-{{ domain }}",
	})

	require.NoError(t, client.Deploy(context.Background(), testApp("proj", "dev", "myapp", "nginx:latest")))
	deployment := &appsv1.Deployment{}
	require.NoError(t, k8sClient.Get(context.Background(), ctrlclient.ObjectKey{Namespace: "custom-apps", Name: "myapp-proj-dev"}, deployment))
	assert.Equal(t, "custom-apps", deployment.Namespace)
	assert.Equal(t, "http://{app_fqdn}-proj-dev.custom-apps.svc.cluster.local", deployment.Spec.Template.Spec.Containers[0].Env[0].Value)
}

func TestDeploy_InjectsExecutionEnvAndSecretWebhookMetadata(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "myapp", "nginx:latest")
	app.Spec.SecurityContext = &flyteapp.SecurityContext{
		Secrets: []*flytecoreapp.Secret{{Group: "my_group", Key: "my_key", MountRequirement: flytecoreapp.Secret_ENV_VAR}},
	}
	require.NoError(t, client.Deploy(context.Background(), app))

	deployment := &appsv1.Deployment{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), deployment))
	env := map[string]string{}
	for _, item := range deployment.Spec.Template.Spec.Containers[0].Env {
		env[item.Name] = item.Value
	}
	assert.Equal(t, "proj", env["FLYTE_INTERNAL_EXECUTION_PROJECT"])
	assert.Equal(t, "dev", env["FLYTE_INTERNAL_EXECUTION_DOMAIN"])
	assert.Equal(t, "flyte", deployment.Spec.Template.Labels["organization"])
	assert.Equal(t, "proj", deployment.Spec.Template.Labels["project"])
	assert.Equal(t, "dev", deployment.Spec.Template.Labels["domain"])
	assert.Equal(t, "true", deployment.Spec.Template.Labels["inject-flyte-secrets"])
	assert.Contains(t, deployment.Spec.Template.Annotations, "flyte.secrets/s0")
}

func TestDeploy_K8sPodPayloadPreservesVLLMShape(t *testing.T) {
	client := testClient(t)
	gpuResource := corev1.ResourceName("example.com/gpu")
	podSpec := corev1.PodSpec{
		InitContainers: []corev1.Container{
			{
				Name:  "model-downloader",
				Image: "downloader",
				Env: []corev1.EnvVar{{
					Name: "AIONE_PARAMS",
					ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{
						LocalObjectReference: corev1.LocalObjectReference{Name: "model-secret"},
						Key:                  "aione_params",
					}},
				}},
				VolumeMounts: []corev1.VolumeMount{{Name: "models", MountPath: "/models"}},
			},
		},
		Containers: []corev1.Container{
			{
				Name:  "vllm",
				Image: "vllm",
				Args:  []string{"--model", "/models/qwen"},
				Ports: []corev1.ContainerPort{{Name: "http", ContainerPort: 8000}},
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceCPU: k8sresource.MustParse("4"), corev1.ResourceMemory: k8sresource.MustParse("16Gi"), gpuResource: k8sresource.MustParse("1")},
					Limits:   corev1.ResourceList{corev1.ResourceCPU: k8sresource.MustParse("4"), corev1.ResourceMemory: k8sresource.MustParse("16Gi"), gpuResource: k8sresource.MustParse("1")},
				},
				VolumeMounts:   []corev1.VolumeMount{{Name: "models", MountPath: "/models"}, {Name: "models", MountPath: "/root/.cache/huggingface"}},
				ReadinessProbe: &corev1.Probe{ProbeHandler: corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/v1/models", Port: intstr.FromInt(8000)}}},
				StartupProbe:   &corev1.Probe{ProbeHandler: corev1.ProbeHandler{HTTPGet: &corev1.HTTPGetAction{Path: "/v1/models", Port: intstr.FromInt(8000)}}},
			},
		},
		Volumes:     []corev1.Volume{{Name: "models", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "model-cache"}}}},
		Tolerations: []corev1.Toleration{{Key: "nvidia.com/gpu", Operator: corev1.TolerationOpExists, Effect: corev1.TaintEffectNoSchedule}},
	}
	app := &flyteapp.App{Metadata: &flyteapp.Meta{Id: &flyteapp.Identifier{Project: "proj", Domain: "dev", Name: "qwen"}}, Spec: &flyteapp.Spec{AppPayload: &flyteapp.Spec_Pod{Pod: &flytecoreapp.K8SPod{PodSpec: podSpecStruct(t, podSpec), PrimaryContainerName: "vllm"}}, Autoscaling: &flyteapp.AutoscalingConfig{Replicas: &flyteapp.Replicas{Min: 1, Max: 1}}}}
	require.NoError(t, client.Deploy(context.Background(), app))

	deployment := &appsv1.Deployment{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("qwen-proj-dev"), deployment))
	got := deployment.Spec.Template.Spec
	require.Len(t, got.InitContainers, 1)
	assert.Equal(t, "model-secret", got.InitContainers[0].Env[0].ValueFrom.SecretKeyRef.Name)
	assert.Equal(t, "model-cache", got.Volumes[0].PersistentVolumeClaim.ClaimName)
	assert.Equal(t, "/v1/models", got.Containers[0].ReadinessProbe.HTTPGet.Path)
	assert.Equal(t, "/v1/models", got.Containers[0].StartupProbe.HTTPGet.Path)
	requestGPU := got.Containers[0].Resources.Requests[gpuResource]
	limitGPU := got.Containers[0].Resources.Limits[gpuResource]
	assert.Equal(t, "1", requestGPU.String())
	assert.Equal(t, "1", limitGPU.String())
	assert.Equal(t, "nvidia.com/gpu", got.Tolerations[0].Key)

	service := &corev1.Service{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("qwen-proj-dev"), service))
	assert.Equal(t, int32(8000), service.Spec.Ports[0].TargetPort.IntVal)
}

func TestDeployWithResourcesDeleteRemovesOwnedAuxiliaryResourcesAndPreservesCloudStoragePVC(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "qwen", "vllm")
	id := app.Metadata.Id
	secret := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "qwen-model-secret"}, Data: map[string][]byte{"aione_params": []byte("token")}}
	pvc := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "qwen-model-cache"}, Spec: corev1.PersistentVolumeClaimSpec{AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}, Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: k8sresource.MustParse("80Gi")}}}}
	cloudStoragePVC := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "cs-models", Labels: map[string]string{"flyte.org/cloud-storage": "true"}}, Spec: corev1.PersistentVolumeClaimSpec{AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}, Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: k8sresource.MustParse("80Gi")}}}}
	require.NoError(t, client.DeployWithResources(context.Background(), app, AppAuxResources{Secrets: []*corev1.Secret{secret}, PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{pvc, cloudStoragePVC}}))
	storedSecret := &corev1.Secret{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("qwen-model-secret"), storedSecret))
	assert.Equal(t, "true", storedSecret.Labels[labelAppAuxiliary])
	assert.NotContains(t, storedSecret.Annotations, annotationSpec)
	storedCloudStoragePVC := &corev1.PersistentVolumeClaim{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("cs-models"), storedCloudStoragePVC))
	assert.Equal(t, "true", storedCloudStoragePVC.Labels[labelAppAuxiliary])
	assert.Equal(t, "true", storedCloudStoragePVC.Labels["flyte.org/cloud-storage"])

	require.NoError(t, client.Delete(context.Background(), id))
	for _, object := range []ctrlclient.Object{&appsv1.Deployment{}, &corev1.Service{}, &networkingv1.Ingress{}, &corev1.Secret{}, &corev1.PersistentVolumeClaim{}} {
		name := "qwen-proj-dev"
		if _, ok := object.(*corev1.Secret); ok {
			name = "qwen-model-secret"
		}
		if _, ok := object.(*corev1.PersistentVolumeClaim); ok {
			name = "qwen-model-cache"
		}
		assert.True(t, k8serrors.IsNotFound(client.k8sClient.Get(context.Background(), clientKey(name), object)))
	}
	assert.NoError(t, client.k8sClient.Get(context.Background(), clientKey("cs-models"), &corev1.PersistentVolumeClaim{}))
}

func TestStopScalesDeploymentToZeroAndRemovesIngress(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "myapp", "nginx")
	require.NoError(t, client.Deploy(context.Background(), app))
	require.NoError(t, client.Stop(context.Background(), app.Metadata.Id))

	deployment := &appsv1.Deployment{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), deployment))
	assert.Equal(t, int32(0), *deployment.Spec.Replicas)
	assert.Equal(t, "true", deployment.Labels[labelAppStopped])
	assert.True(t, k8serrors.IsNotFound(client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), &networkingv1.Ingress{})))

	require.NoError(t, client.Deploy(context.Background(), app))
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), deployment))
	assert.Equal(t, int32(1), *deployment.Spec.Replicas)
	assert.NotContains(t, deployment.Labels, labelAppStopped)
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), &networkingv1.Ingress{}))
}

func TestDeployUpdatePreservesServiceClusterIP(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "myapp", "nginx:v1")
	require.NoError(t, client.Deploy(context.Background(), app))

	service := &corev1.Service{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), service))
	service.Spec.ClusterIP = "10.43.0.10"
	service.Spec.ClusterIPs = []string{"10.43.0.10"}
	service.Spec.IPFamilies = []corev1.IPFamily{corev1.IPv4Protocol}
	require.NoError(t, client.k8sClient.Update(context.Background(), service))

	app.Spec.GetContainer().Image = "nginx:v2"
	require.NoError(t, client.Deploy(context.Background(), app))
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), service))
	assert.Equal(t, "10.43.0.10", service.Spec.ClusterIP)
	assert.Equal(t, []string{"10.43.0.10"}, service.Spec.ClusterIPs)
}

func TestGetRuntimePodSpecReturnsLiveDeploymentArgs(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "qwen", "vllm")
	require.NoError(t, client.Deploy(context.Background(), app))

	deployment := &appsv1.Deployment{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("qwen-proj-dev"), deployment))
	deployment.Spec.Template.Spec.Containers[0].Args = []string{
		"--served-model-name", "qwen",
		"--model", "/models/qwen",
		"--host", "0.0.0.0",
		"--port", "8000",
		"--max-num-seqs", "16",
		"--max-model-len", "8192",
		"--enforce-eager",
	}
	require.NoError(t, client.k8sClient.Update(context.Background(), deployment))

	podSpec, err := client.GetRuntimePodSpec(context.Background(), app.Metadata.Id)
	require.NoError(t, err)
	require.Len(t, podSpec.Containers, 1)
	assert.Contains(t, podSpec.Containers[0].Args, "--enforce-eager")
	assert.Contains(t, podSpec.Containers[0].Args, "--max-model-len")
}

func TestRedeployWithResourcesForcesPodReplacementAndPreservesAuxResources(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "qwen", "vllm")
	secret := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "qwen-proj-dev-model-downloader"}, Data: map[string][]byte{"aione_params": []byte("secret")}}
	pvc := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "qwen-proj-dev-model-cache"}, Spec: corev1.PersistentVolumeClaimSpec{AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}, Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: k8sresource.MustParse("80Gi")}}}}
	resources := AppAuxResources{Secrets: []*corev1.Secret{secret}, PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{pvc}}
	require.NoError(t, client.DeployWithResources(context.Background(), app, resources))

	before := &appsv1.Deployment{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("qwen-proj-dev"), before))
	assert.Empty(t, before.Spec.Template.Annotations[annotationRestartedAt])

	require.NoError(t, client.RedeployWithResources(context.Background(), app, resources))
	after := &appsv1.Deployment{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("qwen-proj-dev"), after))
	assert.NotEmpty(t, after.Spec.Template.Annotations[annotationRestartedAt])
	assert.NotEqual(t, before.ResourceVersion, after.ResourceVersion)
	assert.NoError(t, client.k8sClient.Get(context.Background(), clientKey(secret.Name), &corev1.Secret{}))
	assert.NoError(t, client.k8sClient.Get(context.Background(), clientKey(pvc.Name), &corev1.PersistentVolumeClaim{}))
}

func TestRedeployWithResourcesGrowsExistingPVCRequest(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "qwen", "vllm")
	pvc := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "qwen-proj-dev-model-cache"}, Spec: corev1.PersistentVolumeClaimSpec{AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}, Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: k8sresource.MustParse("80Gi")}}}}
	require.NoError(t, client.DeployWithResources(context.Background(), app, AppAuxResources{PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{pvc}}))

	grown := pvc.DeepCopy()
	grown.Spec.Resources.Requests[corev1.ResourceStorage] = k8sresource.MustParse("120Gi")
	require.NoError(t, client.RedeployWithResources(context.Background(), app, AppAuxResources{PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{grown}}))

	stored := &corev1.PersistentVolumeClaim{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey(pvc.Name), stored))
	storedSize := stored.Spec.Resources.Requests[corev1.ResourceStorage]
	assert.Equal(t, "120Gi", storedSize.String())
}

func TestRedeployWithResourcesRejectsPVCRequestShrink(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "qwen", "vllm")
	pvc := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "qwen-proj-dev-model-cache"}, Spec: corev1.PersistentVolumeClaimSpec{AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce}, Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: k8sresource.MustParse("120Gi")}}}}
	require.NoError(t, client.DeployWithResources(context.Background(), app, AppAuxResources{PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{pvc}}))

	shrunk := pvc.DeepCopy()
	shrunk.Spec.Resources.Requests[corev1.ResourceStorage] = k8sresource.MustParse("80Gi")
	err := client.RedeployWithResources(context.Background(), app, AppAuxResources{PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{shrunk}})
	require.Error(t, err)
	assert.ErrorContains(t, err, "cannot shrink PVC")
}

func TestGetAuxSecretReturnsOnlySecretOwnedByApp(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "qwen", "vllm")
	secret := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "qwen-proj-dev-model-downloader"}, Data: map[string][]byte{"aione_params": []byte("secret")}}
	require.NoError(t, client.DeployWithResources(context.Background(), app, AppAuxResources{Secrets: []*corev1.Secret{secret}}))

	got, err := client.GetAuxSecret(context.Background(), app.Metadata.Id, secret.Name)
	require.NoError(t, err)
	assert.Equal(t, []byte("secret"), got.Data["aione_params"])

	foreign := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "foreign", Namespace: AppNamespace}, Data: map[string][]byte{"aione_params": []byte("foreign")}}
	require.NoError(t, client.k8sClient.Create(context.Background(), foreign))
	_, err = client.GetAuxSecret(context.Background(), app.Metadata.Id, foreign.Name)
	assert.ErrorContains(t, err, "not owned by app")
}

func TestGetAppAuxPVCReturnsOnlyPVCOwnedByApp(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "qwen", "vllm")
	pvc := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "qwen-proj-dev-model-cache"}, Spec: corev1.PersistentVolumeClaimSpec{Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: k8sresource.MustParse("80Gi")}}}}
	require.NoError(t, client.DeployWithResources(context.Background(), app, AppAuxResources{PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{pvc}}))

	got, err := client.GetAppAuxPVC(context.Background(), app.Metadata.Id, pvc.Name)
	require.NoError(t, err)
	assert.Equal(t, pvc.Name, got.Name)

	foreign := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "foreign", Namespace: AppNamespace}}
	require.NoError(t, client.k8sClient.Create(context.Background(), foreign))
	_, err = client.GetAppAuxPVC(context.Background(), app.Metadata.Id, foreign.Name)
	assert.ErrorContains(t, err, "not owned by app")
}

func TestStorageClassAllowsExpansionReadsStorageClassFlag(t *testing.T) {
	allow := true
	deny := false
	client := testClient(t,
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "bj1-ebs"}, AllowVolumeExpansion: &allow},
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "local-path"}, AllowVolumeExpansion: &deny},
	)

	expandable, err := client.StorageClassAllowsExpansion(context.Background(), "bj1-ebs")
	require.NoError(t, err)
	assert.True(t, expandable)

	expandable, err = client.StorageClassAllowsExpansion(context.Background(), "local-path")
	require.NoError(t, err)
	assert.False(t, expandable)
}

func TestGetAuxPVCAuthorizesLiveAppReferenceInsteadOfMutableOwnerLabels(t *testing.T) {
	client := testClient(t)
	sharedPVC := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{
		Name: "cs-models-prod",
		Labels: map[string]string{
			labelCloudStorage:            "true",
			"flyte.org/cloud-storage-id": "Models@Prod",
		},
	}}
	nonCloudPVC := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "model-cache"}}
	unreferencedCloudPVC := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{
		Name: "cs-unreferenced",
		Labels: map[string]string{
			labelCloudStorage:            "true",
			"flyte.org/cloud-storage-id": "Unreferenced",
		},
	}}
	appWithVolumes := func(name string) *flyteapp.App {
		podSpec := corev1.PodSpec{
			Containers: []corev1.Container{{Name: "vllm", Image: "vllm"}},
			Volumes: []corev1.Volume{
				{Name: "cloud-storage-0", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: sharedPVC.Name}}},
				{Name: "cloud-storage-1", VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: nonCloudPVC.Name}}},
			},
		}
		return &flyteapp.App{
			Metadata: &flyteapp.Meta{Id: &flyteapp.Identifier{Project: "proj", Domain: "dev", Name: name}},
			Spec: &flyteapp.Spec{AppPayload: &flyteapp.Spec_Pod{Pod: &flytecoreapp.K8SPod{
				PodSpec: podSpecStruct(t, podSpec), PrimaryContainerName: "vllm",
			}}},
		}
	}
	appA := appWithVolumes("qwen-a")
	appB := appWithVolumes("qwen-b")
	require.NoError(t, client.DeployWithResources(context.Background(), appA, AppAuxResources{PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{
		sharedPVC, nonCloudPVC, unreferencedCloudPVC,
	}}))
	require.NoError(t, client.DeployWithResources(context.Background(), appB, AppAuxResources{PersistentVolumeClaims: []*corev1.PersistentVolumeClaim{sharedPVC.DeepCopy()}}))
	storedSharedPVC := &corev1.PersistentVolumeClaim{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey(sharedPVC.Name), storedSharedPVC))
	assert.Equal(t, appB.Metadata.Id.Name, storedSharedPVC.Labels[labelAppName], "the second app owns the mutable auxiliary labels")

	got, err := client.GetAuxPVC(context.Background(), appA.Metadata.Id, sharedPVC.Name)
	require.NoError(t, err)
	assert.Equal(t, "Models@Prod", got.Labels["flyte.org/cloud-storage-id"])

	_, err = client.GetAuxPVC(context.Background(), appA.Metadata.Id, unreferencedCloudPVC.Name)
	assert.ErrorContains(t, err, "not referenced by app")

	_, err = client.GetAuxPVC(context.Background(), appA.Metadata.Id, nonCloudPVC.Name)
	assert.ErrorContains(t, err, "not a cloud storage volume")
}

func TestDeployRejectsReplicaRanges(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "myapp", "nginx")
	app.Spec.Autoscaling = &flyteapp.AutoscalingConfig{Replicas: &flyteapp.Replicas{Min: 1, Max: 2}}
	assert.ErrorContains(t, client.Deploy(context.Background(), app), "min to equal max")
}

func TestGetAppReportsNativeDeploymentStatus(t *testing.T) {
	client := testClient(t)
	app := testApp("proj", "dev", "myapp", "nginx")
	require.NoError(t, client.Deploy(context.Background(), app))
	deployment := &appsv1.Deployment{}
	require.NoError(t, client.k8sClient.Get(context.Background(), clientKey("myapp-proj-dev"), deployment))
	deployment.Status.AvailableReplicas = 1
	deployment.Status.ReadyReplicas = 1
	require.NoError(t, client.k8sClient.Status().Update(context.Background(), deployment))

	got, err := client.GetApp(context.Background(), app.Metadata.Id)
	require.NoError(t, err)
	assert.Equal(t, flyteapp.Status_DEPLOYMENT_STATUS_ACTIVE, got.Status.Conditions[0].DeploymentStatus)
	assert.Equal(t, "https://myapp-proj-dev.ops.fzyun.io", got.Status.Ingress.PublicUrl)
}

func TestGetReplicasUsesNativeAppLabels(t *testing.T) {
	id := &flyteapp.Identifier{Project: "proj", Domain: "dev", Name: "myapp"}
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "myapp-abc", Namespace: AppNamespace, Labels: appSelectorLabels(id)}, Status: corev1.PodStatus{Phase: corev1.PodRunning, ContainerStatuses: []corev1.ContainerStatus{{Ready: true}}}}
	client := testClient(t, pod)
	replicas, err := client.GetReplicas(context.Background(), id)
	require.NoError(t, err)
	require.Len(t, replicas, 1)
	assert.Equal(t, "ACTIVE", replicas[0].Status.DeploymentStatus)
}

func TestAppResourceNameCapsLongNames(t *testing.T) {
	name := "this-is-a-very-long-app-name-that-exceeds-the-kubernetes-dns-label-limit"
	id := &flyteapp.Identifier{Project: "proj", Domain: "dev", Name: name}
	raw := name + "-proj-dev"
	sum := sha256.Sum256([]byte("proj/dev/" + name))
	assert.Equal(t, raw[:54]+"-"+hex.EncodeToString(sum[:4]), AppResourceName(id))
	assert.LessOrEqual(t, len(AppResourceName(id)), 63)
}

func clientKey(name string) ctrlclient.ObjectKey {
	return ctrlclient.ObjectKey{Namespace: AppNamespace, Name: name}
}

var _ = time.Second
