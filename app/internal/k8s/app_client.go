package k8s

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	k8sresource "k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	k8swatch "k8s.io/apimachinery/pkg/watch"
	toolscache "k8s.io/client-go/tools/cache"
	ctrlcache "sigs.k8s.io/controller-runtime/pkg/cache"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/flyteorg/flyte/v2/app/internal/config"
	"github.com/flyteorg/flyte/v2/flytestdlib/k8s"
	"github.com/flyteorg/flyte/v2/flytestdlib/logger"
	"github.com/flyteorg/flyte/v2/flytestdlib/utils"
	flyteapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/app"
	flytecore "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

const (
	labelAppManaged   = "flyte.org/app-managed"
	labelProject      = "flyte.org/project"
	labelDomain       = "flyte.org/domain"
	labelAppName      = "flyte.org/app-name"
	labelAppAuxiliary = "flyte.org/app-auxiliary"
	labelAppStopped   = "flyte.org/app-stopped"
	labelCloudStorage = "flyte.org/cloud-storage"

	annotationSpecSHA     = "flyte.org/spec-sha"
	annotationAppID       = "flyte.org/app-id"
	annotationAppOrg      = "flyte.org/app-org"
	annotationSpec        = "flyte.org/spec"
	annotationRestartedAt = "flyte.org/restarted-at"

	maxAppResourceNameLen = 63
	defaultOrg            = "flyte"
	defaultServicePort    = 8080
)

// AppAuxResources contains Kubernetes resources owned by an App outside of its
// Deployment, such as downloader Secrets and model cache PVCs.
type AppAuxResources struct {
	Secrets                []*corev1.Secret
	PersistentVolumeClaims []*corev1.PersistentVolumeClaim
}

// AppK8sClientInterface defines the native Kubernetes lifecycle used by Apps.
type AppK8sClientInterface interface {
	Deploy(ctx context.Context, app *flyteapp.App) error
	DeployWithResources(ctx context.Context, app *flyteapp.App, resources AppAuxResources) error
	RedeployWithResources(ctx context.Context, app *flyteapp.App, resources AppAuxResources) error
	Stop(ctx context.Context, appID *flyteapp.Identifier) error
	GetApp(ctx context.Context, appID *flyteapp.Identifier) (*flyteapp.App, error)
	GetRuntimePodSpec(ctx context.Context, appID *flyteapp.Identifier) (*corev1.PodSpec, error)
	GetAuxSecret(ctx context.Context, appID *flyteapp.Identifier, name string) (*corev1.Secret, error)
	GetAuxPVC(ctx context.Context, appID *flyteapp.Identifier, name string) (*corev1.PersistentVolumeClaim, error)
	GetAppAuxPVC(ctx context.Context, appID *flyteapp.Identifier, name string) (*corev1.PersistentVolumeClaim, error)
	StorageClassAllowsExpansion(ctx context.Context, name string) (bool, error)
	List(ctx context.Context, project, domain string, limit uint32, token string) ([]*flyteapp.App, string, error)
	Delete(ctx context.Context, appID *flyteapp.Identifier) error
	GetReplicas(ctx context.Context, appID *flyteapp.Identifier) ([]*flyteapp.Replica, error)
	DeleteReplica(ctx context.Context, replicaID *flyteapp.ReplicaIdentifier) error
	StartWatching(ctx context.Context) error
	StopWatching()
	Subscribe(appName string) chan *flyteapp.WatchResponse
	Unsubscribe(appName string, ch chan *flyteapp.WatchResponse)
	PublicIngress(id *flyteapp.Identifier) *flyteapp.Ingress
}

type AppK8sClient struct {
	k8sClient client.WithWatch
	cache     ctrlcache.Cache
	cfg       *config.InternalAppConfig

	mu          sync.RWMutex
	subscribers map[string]map[chan *flyteapp.WatchResponse]struct{}
	stopCh      chan struct{}
	watching    bool
}

func NewAppK8sClient(k8sClient client.WithWatch, cache ctrlcache.Cache, cfg *config.InternalAppConfig) *AppK8sClient {
	return &AppK8sClient{k8sClient: k8sClient, cache: cache, cfg: cfg, subscribers: make(map[string]map[chan *flyteapp.WatchResponse]struct{})}
}

// AppNamespace is the fixed Kubernetes namespace where Apps are deployed.
const AppNamespace = "flyte"

func (c *AppK8sClient) Deploy(ctx context.Context, app *flyteapp.App) error {
	return c.DeployWithResources(ctx, app, AppAuxResources{})
}

func (c *AppK8sClient) DeployWithResources(ctx context.Context, app *flyteapp.App, resources AppAuxResources) error {
	return c.deployWithResources(ctx, app, resources, false)
}

func (c *AppK8sClient) RedeployWithResources(ctx context.Context, app *flyteapp.App, resources AppAuxResources) error {
	return c.deployWithResources(ctx, app, resources, true)
}

func (c *AppK8sClient) deployWithResources(ctx context.Context, app *flyteapp.App, resources AppAuxResources, forceRestart bool) error {
	appID := app.GetMetadata().GetId()
	if err := k8s.EnsureNamespaceExists(ctx, c.k8sClient, AppNamespace); err != nil {
		return fmt.Errorf("failed to ensure namespace %s: %w", AppNamespace, err)
	}
	if err := c.ensureAuxResources(ctx, appID, resources); err != nil {
		return fmt.Errorf("failed to ensure auxiliary resources: %w", err)
	}
	native, err := c.buildNativeResources(app)
	if err != nil {
		return fmt.Errorf("failed to build native resources for app %s: %w", AppResourceName(appID), err)
	}
	if forceRestart {
		if native.Deployment.Spec.Template.Annotations == nil {
			native.Deployment.Spec.Template.Annotations = map[string]string{}
		}
		native.Deployment.Spec.Template.Annotations[annotationRestartedAt] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if err := c.upsertDeployment(ctx, native.Deployment); err != nil {
		return err
	}
	if err := c.upsertService(ctx, native.Service); err != nil {
		return err
	}
	if err := c.upsertIngress(ctx, native.Ingress); err != nil {
		return err
	}
	logger.Infof(ctx, "Applied native app resources for %s/%s", AppNamespace, native.Deployment.Name)
	return nil
}

func (c *AppK8sClient) Stop(ctx context.Context, appID *flyteapp.Identifier) error {
	name := AppResourceName(appID)
	deployment := &appsv1.Deployment{}
	if err := c.k8sClient.Get(ctx, client.ObjectKey{Namespace: AppNamespace, Name: name}, deployment); err != nil {
		if k8serrors.IsNotFound(err) {
			return nil
		}
		return fmt.Errorf("failed to get Deployment %s: %w", name, err)
	}
	if deployment.Labels == nil {
		deployment.Labels = map[string]string{}
	}
	deployment.Labels[labelAppStopped] = "true"
	zero := int32(0)
	deployment.Spec.Replicas = &zero
	if err := c.k8sClient.Update(ctx, deployment); err != nil {
		return fmt.Errorf("failed to scale Deployment %s to zero: %w", name, err)
	}
	ingress := &networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: AppNamespace}}
	if err := c.k8sClient.Delete(ctx, ingress); err != nil && !k8serrors.IsNotFound(err) {
		return fmt.Errorf("failed to remove Ingress for stopped app %s: %w", name, err)
	}
	logger.Infof(ctx, "Stopped native app %s/%s", AppNamespace, name)
	return nil
}

func (c *AppK8sClient) Delete(ctx context.Context, appID *flyteapp.Identifier) error {
	name := AppResourceName(appID)
	objects := []client.Object{
		&networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: AppNamespace}},
		&corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: AppNamespace}},
		&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: AppNamespace}},
	}
	for _, obj := range objects {
		if err := c.k8sClient.Delete(ctx, obj); err != nil && !k8serrors.IsNotFound(err) {
			return fmt.Errorf("failed to delete %T %s: %w", obj, name, err)
		}
	}
	if err := c.deleteAuxResources(ctx, appID); err != nil {
		return fmt.Errorf("failed to delete auxiliary resources for app %s: %w", name, err)
	}
	logger.Infof(ctx, "Deleted native app %s/%s", AppNamespace, name)
	return nil
}

type nativeAppResources struct {
	Deployment *appsv1.Deployment
	Service    *corev1.Service
	Ingress    *networkingv1.Ingress
}

func (c *AppK8sClient) buildNativeResources(app *flyteapp.App) (*nativeAppResources, error) {
	appID := app.GetMetadata().GetId()
	spec := app.GetSpec()
	name := AppResourceName(appID)
	specBytes, err := marshalSpec(spec)
	if err != nil {
		return nil, err
	}
	podSpec, err := buildPodSpec(spec)
	if err != nil {
		return nil, err
	}
	if sa := spec.GetSecurityContext().GetRunAs().GetK8SServiceAccount(); sa != "" {
		podSpec.ServiceAccountName = sa
	} else if c.cfg.DefaultServiceAccount != "" {
		podSpec.ServiceAccountName = c.cfg.DefaultServiceAccount
	}
	if len(c.cfg.DefaultEnvVars) > 0 && len(podSpec.Containers) > 0 {
		defaults := make([]corev1.EnvVar, 0, len(c.cfg.DefaultEnvVars))
		for k, v := range c.cfg.DefaultEnvVars {
			defaults = append(defaults, corev1.EnvVar{Name: k, Value: v})
		}
		podSpec.Containers[0].Env = append(defaults, podSpec.Containers[0].Env...)
	}
	if len(podSpec.Containers) > 0 {
		suffix := renderNamespacedSuffix(c.cfg.NamespacedNameSuffixTemplate, appID.GetProject(), appID.GetDomain())
		podSpec.Containers[0].Env = append(podSpec.Containers[0].Env, corev1.EnvVar{
			Name:  "INTERNAL_APP_ENDPOINT_PATTERN",
			Value: fmt.Sprintf("http://{app_fqdn}-%s.%s.svc.cluster.local", suffix, AppNamespace),
		})
	}
	replicas, err := desiredReplicas(spec)
	if err != nil {
		return nil, err
	}
	labels := appLabels(appID)
	annotations := map[string]string{
		annotationSpecSHA: specSHA(specBytes),
		annotationAppID:   fmt.Sprintf("%s/%s/%s", appID.GetProject(), appID.GetDomain(), appID.GetName()),
		annotationAppOrg:  appID.GetOrg(),
		annotationSpec:    base64.StdEncoding.EncodeToString(specBytes),
	}
	if replicas == 0 {
		labels[labelAppStopped] = "true"
	}
	selector := appSelectorLabels(appID)
	port := primaryContainerPort(spec, podSpec)
	pathType := networkingv1.PathTypePrefix
	className := c.cfg.IngressClassName
	if className == "" {
		className = "traefik"
	}
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: AppNamespace, Labels: labels, Annotations: annotations},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: selector},
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RecreateDeploymentStrategyType},
			Template: corev1.PodTemplateSpec{ObjectMeta: metav1.ObjectMeta{Labels: selector}, Spec: podSpec},
		},
	}
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: AppNamespace, Labels: labels},
		Spec: corev1.ServiceSpec{
			Type:     corev1.ServiceTypeClusterIP,
			Selector: selector,
			Ports:    []corev1.ServicePort{{Name: "http", Protocol: corev1.ProtocolTCP, Port: 80, TargetPort: intstr.FromInt(int(port))}},
		},
	}
	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: AppNamespace, Labels: labels},
		Spec: networkingv1.IngressSpec{
			IngressClassName: &className,
			Rules: []networkingv1.IngressRule{{
				Host: AppHost(appID, c.cfg.BaseDomain),
				IngressRuleValue: networkingv1.IngressRuleValue{HTTP: &networkingv1.HTTPIngressRuleValue{Paths: []networkingv1.HTTPIngressPath{{
					Path: "/", PathType: &pathType,
					Backend: networkingv1.IngressBackend{Service: &networkingv1.IngressServiceBackend{Name: name, Port: networkingv1.ServiceBackendPort{Name: "http"}}},
				}}}},
			}},
		},
	}
	return &nativeAppResources{Deployment: deployment, Service: service, Ingress: ingress}, nil
}

func desiredReplicas(spec *flyteapp.Spec) (int32, error) {
	if spec.GetDesiredState() == flyteapp.Spec_DESIRED_STATE_STOPPED {
		return 0, nil
	}
	replicas := spec.GetAutoscaling().GetReplicas()
	if replicas == nil {
		return 1, nil
	}
	if replicas.GetMin() != replicas.GetMax() {
		return 0, fmt.Errorf("native Apps require autoscaling.replicas.min to equal max")
	}
	return int32(replicas.GetMin()), nil
}

func primaryContainerPort(spec *flyteapp.Spec, podSpec corev1.PodSpec) int32 {
	primary := ""
	if pod := spec.GetPod(); pod != nil {
		primary = pod.GetPrimaryContainerName()
	}
	for _, container := range podSpec.Containers {
		if primary != "" && container.Name != primary {
			continue
		}
		for _, port := range container.Ports {
			if port.ContainerPort > 0 {
				return port.ContainerPort
			}
		}
	}
	return defaultServicePort
}

func appLabels(id *flyteapp.Identifier) map[string]string {
	return map[string]string{labelAppManaged: "true", labelProject: id.GetProject(), labelDomain: id.GetDomain(), labelAppName: id.GetName()}
}

func appSelectorLabels(id *flyteapp.Identifier) map[string]string {
	return map[string]string{labelAppManaged: "true", labelProject: id.GetProject(), labelDomain: id.GetDomain(), labelAppName: id.GetName()}
}

func (c *AppK8sClient) upsertDeployment(ctx context.Context, desired *appsv1.Deployment) error {
	existing := &appsv1.Deployment{}
	err := c.k8sClient.Get(ctx, client.ObjectKeyFromObject(desired), existing)
	if k8serrors.IsNotFound(err) {
		if err := c.k8sClient.Create(ctx, desired); err != nil {
			return fmt.Errorf("failed to create Deployment %s: %w", desired.Name, err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to get Deployment %s: %w", desired.Name, err)
	}
	stopped := existing.Labels[labelAppStopped] == "true"
	forceRestart := desired.Spec.Template.Annotations[annotationRestartedAt] != ""
	if !stopped && !forceRestart && existing.Annotations[annotationSpecSHA] == desired.Annotations[annotationSpecSHA] {
		return nil
	}
	existing.Spec = desired.Spec
	mergeObjectMeta(existing, desired)
	delete(existing.Labels, labelAppStopped)
	if desired.Labels[labelAppStopped] == "true" {
		existing.Labels[labelAppStopped] = "true"
	}
	if err := c.k8sClient.Update(ctx, existing); err != nil {
		return fmt.Errorf("failed to update Deployment %s: %w", desired.Name, err)
	}
	return nil
}

func (c *AppK8sClient) upsertService(ctx context.Context, desired *corev1.Service) error {
	existing := &corev1.Service{}
	err := c.k8sClient.Get(ctx, client.ObjectKeyFromObject(desired), existing)
	if k8serrors.IsNotFound(err) {
		if err := c.k8sClient.Create(ctx, desired); err != nil {
			return fmt.Errorf("failed to create Service %s: %w", desired.Name, err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to get Service %s: %w", desired.Name, err)
	}
	clusterIP := existing.Spec.ClusterIP
	clusterIPs := existing.Spec.ClusterIPs
	ipFamilies := existing.Spec.IPFamilies
	ipFamilyPolicy := existing.Spec.IPFamilyPolicy
	existing.Spec = desired.Spec
	existing.Spec.ClusterIP = clusterIP
	existing.Spec.ClusterIPs = clusterIPs
	existing.Spec.IPFamilies = ipFamilies
	existing.Spec.IPFamilyPolicy = ipFamilyPolicy
	mergeObjectMeta(existing, desired)
	if err := c.k8sClient.Update(ctx, existing); err != nil {
		return fmt.Errorf("failed to update Service %s: %w", desired.Name, err)
	}
	return nil
}

func (c *AppK8sClient) upsertIngress(ctx context.Context, desired *networkingv1.Ingress) error {
	existing := &networkingv1.Ingress{}
	err := c.k8sClient.Get(ctx, client.ObjectKeyFromObject(desired), existing)
	if k8serrors.IsNotFound(err) {
		if err := c.k8sClient.Create(ctx, desired); err != nil {
			return fmt.Errorf("failed to create Ingress %s: %w", desired.Name, err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to get Ingress %s: %w", desired.Name, err)
	}
	existing.Spec = desired.Spec
	mergeObjectMeta(existing, desired)
	if err := c.k8sClient.Update(ctx, existing); err != nil {
		return fmt.Errorf("failed to update Ingress %s: %w", desired.Name, err)
	}
	return nil
}

func (c *AppK8sClient) ensureAuxResources(ctx context.Context, appID *flyteapp.Identifier, resources AppAuxResources) error {
	for _, secret := range resources.Secrets {
		if secret != nil {
			if err := c.upsertSecret(ctx, appID, secret); err != nil {
				return err
			}
		}
	}
	for _, pvc := range resources.PersistentVolumeClaims {
		if pvc != nil {
			if err := c.upsertPVC(ctx, appID, pvc); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *AppK8sClient) upsertSecret(ctx context.Context, appID *flyteapp.Identifier, desired *corev1.Secret) error {
	applyAuxLabels(appID, desired)
	existing := &corev1.Secret{}
	err := c.k8sClient.Get(ctx, client.ObjectKey{Name: desired.Name, Namespace: desired.Namespace}, existing)
	if k8serrors.IsNotFound(err) {
		if err := c.k8sClient.Create(ctx, desired); err != nil {
			return fmt.Errorf("failed to create Secret %s: %w", desired.Name, err)
		}
		return nil
	}
	if err != nil {
		return err
	}
	existing.Type, existing.Data, existing.StringData = desired.Type, desired.Data, desired.StringData
	mergeObjectMeta(existing, desired)
	return c.k8sClient.Update(ctx, existing)
}

func (c *AppK8sClient) upsertPVC(ctx context.Context, appID *flyteapp.Identifier, desired *corev1.PersistentVolumeClaim) error {
	applyAuxLabels(appID, desired)
	existing := &corev1.PersistentVolumeClaim{}
	err := c.k8sClient.Get(ctx, client.ObjectKey{Name: desired.Name, Namespace: desired.Namespace}, existing)
	if k8serrors.IsNotFound(err) {
		if err := c.k8sClient.Create(ctx, desired); err != nil {
			return fmt.Errorf("failed to create PVC %s: %w", desired.Name, err)
		}
		return nil
	}
	if err != nil {
		return err
	}
	mergeObjectMeta(existing, desired)
	if desired.Spec.Resources.Requests != nil {
		desiredStorage, ok := desired.Spec.Resources.Requests[corev1.ResourceStorage]
		if ok {
			if existing.Spec.Resources.Requests == nil {
				existing.Spec.Resources.Requests = corev1.ResourceList{}
			}
			existingStorage, exists := existing.Spec.Resources.Requests[corev1.ResourceStorage]
			if exists && desiredStorage.Cmp(existingStorage) < 0 {
				return fmt.Errorf("cannot shrink PVC %s storage request from %s to %s", desired.Name, existingStorage.String(), desiredStorage.String())
			}
			if !exists || desiredStorage.Cmp(existingStorage) > 0 {
				existing.Spec.Resources.Requests[corev1.ResourceStorage] = desiredStorage
			}
		}
	}
	return c.k8sClient.Update(ctx, existing)
}

func (c *AppK8sClient) deleteAuxResources(ctx context.Context, appID *flyteapp.Identifier) error {
	labels := appAuxLabels(appID)
	secrets := &corev1.SecretList{}
	if err := c.k8sClient.List(ctx, secrets, client.InNamespace(AppNamespace), client.MatchingLabels(labels)); err != nil {
		return err
	}
	for i := range secrets.Items {
		if err := c.k8sClient.Delete(ctx, &secrets.Items[i]); err != nil && !k8serrors.IsNotFound(err) {
			return err
		}
	}
	pvcs := &corev1.PersistentVolumeClaimList{}
	if err := c.k8sClient.List(ctx, pvcs, client.InNamespace(AppNamespace), client.MatchingLabels(labels)); err != nil {
		return err
	}
	for i := range pvcs.Items {
		if pvcs.Items[i].Labels[labelCloudStorage] == "true" {
			continue
		}
		if err := c.k8sClient.Delete(ctx, &pvcs.Items[i]); err != nil && !k8serrors.IsNotFound(err) {
			return err
		}
	}
	return nil
}

func appAuxLabels(id *flyteapp.Identifier) map[string]string {
	labels := appSelectorLabels(id)
	labels[labelAppAuxiliary] = "true"
	return labels
}

func applyAuxLabels(id *flyteapp.Identifier, obj client.Object) {
	obj.SetNamespace(AppNamespace)
	labels := obj.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	for k, v := range appAuxLabels(id) {
		labels[k] = v
	}
	obj.SetLabels(labels)
}

func mergeObjectMeta(existing, desired client.Object) {
	labels := existing.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	for k, v := range desired.GetLabels() {
		labels[k] = v
	}
	existing.SetLabels(labels)
	annotations := existing.GetAnnotations()
	if annotations == nil {
		annotations = map[string]string{}
	}
	for k, v := range desired.GetAnnotations() {
		annotations[k] = v
	}
	existing.SetAnnotations(annotations)
}

func (c *AppK8sClient) StartWatching(ctx context.Context) error {
	c.mu.Lock()
	if c.watching {
		c.mu.Unlock()
		return nil
	}
	c.watching, c.stopCh = true, make(chan struct{})
	c.mu.Unlock()
	if c.cache == nil {
		return fmt.Errorf("shared cache is required for Deployment informer")
	}
	informer, err := c.cache.GetInformer(ctx, &appsv1.Deployment{})
	if err != nil {
		return fmt.Errorf("failed to get Deployment informer: %w", err)
	}
	_, err = informer.AddEventHandler(toolscache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			if deployment, ok := obj.(*appsv1.Deployment); ok && isManagedDeployment(deployment) {
				c.handleDeploymentEvent(ctx, deployment, k8swatch.Added)
			}
		},
		UpdateFunc: func(_, obj interface{}) {
			if deployment, ok := obj.(*appsv1.Deployment); ok && isManagedDeployment(deployment) {
				c.handleDeploymentEvent(ctx, deployment, k8swatch.Modified)
			}
		},
		DeleteFunc: func(obj interface{}) {
			if tombstone, ok := obj.(toolscache.DeletedFinalStateUnknown); ok {
				obj = tombstone.Obj
			}
			if deployment, ok := obj.(*appsv1.Deployment); ok {
				c.handleDeploymentEvent(ctx, deployment, k8swatch.Deleted)
			}
		},
	})
	return err
}

func (c *AppK8sClient) StopWatching() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.watching && c.stopCh != nil {
		close(c.stopCh)
		c.watching = false
	}
}
func (c *AppK8sClient) Subscribe(appName string) chan *flyteapp.WatchResponse {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan *flyteapp.WatchResponse, c.cfg.WatchBufferSize)
	if c.subscribers[appName] == nil {
		c.subscribers[appName] = map[chan *flyteapp.WatchResponse]struct{}{}
	}
	c.subscribers[appName][ch] = struct{}{}
	return ch
}
func (c *AppK8sClient) Unsubscribe(appName string, ch chan *flyteapp.WatchResponse) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if channels := c.subscribers[appName]; channels != nil {
		delete(channels, ch)
		close(ch)
		if len(channels) == 0 {
			delete(c.subscribers, appName)
		}
	}
}
func isManagedDeployment(deployment *appsv1.Deployment) bool {
	return deployment.Labels[labelAppManaged] == "true"
}

func (c *AppK8sClient) handleDeploymentEvent(ctx context.Context, deployment *appsv1.Deployment, eventType k8swatch.EventType) {
	app, err := c.deploymentToApp(deployment)
	if err != nil {
		return
	}
	var response *flyteapp.WatchResponse
	switch eventType {
	case k8swatch.Added:
		response = &flyteapp.WatchResponse{Event: &flyteapp.WatchResponse_CreateEvent{CreateEvent: &flyteapp.CreateEvent{App: app}}}
	case k8swatch.Modified:
		response = &flyteapp.WatchResponse{Event: &flyteapp.WatchResponse_UpdateEvent{UpdateEvent: &flyteapp.UpdateEvent{UpdatedApp: app}}}
	case k8swatch.Deleted:
		response = &flyteapp.WatchResponse{Event: &flyteapp.WatchResponse_DeleteEvent{DeleteEvent: &flyteapp.DeleteEvent{App: app}}}
	default:
		return
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	for ch := range c.subscribers[app.GetMetadata().GetId().GetName()] {
		select {
		case ch <- response:
		default:
			logger.Warnf(ctx, "subscriber channel full, dropping update for app: %s", app.GetMetadata().GetId().GetName())
		}
	}
}

func (c *AppK8sClient) GetApp(ctx context.Context, appID *flyteapp.Identifier) (*flyteapp.App, error) {
	deployment := &appsv1.Deployment{}
	if err := c.k8sClient.Get(ctx, client.ObjectKey{Namespace: AppNamespace, Name: AppResourceName(appID)}, deployment); err != nil {
		return nil, err
	}
	return c.deploymentToApp(deployment)
}

func (c *AppK8sClient) GetRuntimePodSpec(ctx context.Context, appID *flyteapp.Identifier) (*corev1.PodSpec, error) {
	deployment := &appsv1.Deployment{}
	if err := c.k8sClient.Get(ctx, client.ObjectKey{Namespace: AppNamespace, Name: AppResourceName(appID)}, deployment); err != nil {
		return nil, err
	}
	return deployment.Spec.Template.Spec.DeepCopy(), nil
}

func (c *AppK8sClient) GetAuxSecret(ctx context.Context, appID *flyteapp.Identifier, name string) (*corev1.Secret, error) {
	secret := &corev1.Secret{}
	if err := c.k8sClient.Get(ctx, client.ObjectKey{Namespace: AppNamespace, Name: name}, secret); err != nil {
		return nil, err
	}
	for key, value := range appAuxLabels(appID) {
		if secret.Labels[key] != value {
			return nil, fmt.Errorf("Secret %s is not owned by app %s", name, appID.GetName())
		}
	}
	return secret, nil
}

func (c *AppK8sClient) GetAuxPVC(ctx context.Context, appID *flyteapp.Identifier, name string) (*corev1.PersistentVolumeClaim, error) {
	deployment := &appsv1.Deployment{}
	if err := c.k8sClient.Get(ctx, client.ObjectKey{Namespace: AppNamespace, Name: AppResourceName(appID)}, deployment); err != nil {
		return nil, err
	}
	referenced := false
	for _, volume := range deployment.Spec.Template.Spec.Volumes {
		claim := volume.PersistentVolumeClaim
		if strings.HasPrefix(volume.Name, "cloud-storage-") && claim != nil && claim.ClaimName == name {
			referenced = true
			break
		}
	}
	if !referenced {
		return nil, fmt.Errorf("PersistentVolumeClaim %s is not referenced by app %s", name, appID.GetName())
	}

	pvc := &corev1.PersistentVolumeClaim{}
	if err := c.k8sClient.Get(ctx, client.ObjectKey{Namespace: AppNamespace, Name: name}, pvc); err != nil {
		return nil, err
	}
	if pvc.Labels[labelCloudStorage] != "true" {
		return nil, fmt.Errorf("PersistentVolumeClaim %s is not a cloud storage volume", name)
	}
	return pvc, nil
}

func (c *AppK8sClient) GetAppAuxPVC(ctx context.Context, appID *flyteapp.Identifier, name string) (*corev1.PersistentVolumeClaim, error) {
	pvc := &corev1.PersistentVolumeClaim{}
	if err := c.k8sClient.Get(ctx, client.ObjectKey{Namespace: AppNamespace, Name: name}, pvc); err != nil {
		return nil, err
	}
	for key, value := range appAuxLabels(appID) {
		if pvc.Labels[key] != value {
			return nil, fmt.Errorf("PersistentVolumeClaim %s is not owned by app %s", name, appID.GetName())
		}
	}
	return pvc, nil
}

func (c *AppK8sClient) StorageClassAllowsExpansion(ctx context.Context, name string) (bool, error) {
	if strings.TrimSpace(name) == "" {
		return false, nil
	}
	storageClass := &storagev1.StorageClass{}
	if err := c.k8sClient.Get(ctx, client.ObjectKey{Name: name}, storageClass); err != nil {
		return false, err
	}
	return storageClass.AllowVolumeExpansion != nil && *storageClass.AllowVolumeExpansion, nil
}

func (c *AppK8sClient) List(ctx context.Context, project, domain string, limit uint32, token string) ([]*flyteapp.App, string, error) {
	match := map[string]string{labelAppManaged: "true"}
	if project != "" {
		match[labelProject] = project
	}
	if domain != "" {
		match[labelDomain] = domain
	}
	opts := []client.ListOption{client.InNamespace(AppNamespace), client.MatchingLabels(match)}
	if limit > 0 {
		opts = append(opts, client.Limit(int64(limit)))
	}
	if token != "" {
		opts = append(opts, client.Continue(token))
	}
	list := &appsv1.DeploymentList{}
	if err := c.k8sClient.List(ctx, list, opts...); err != nil {
		return nil, "", err
	}
	apps := make([]*flyteapp.App, 0, len(list.Items))
	for i := range list.Items {
		app, err := c.deploymentToApp(&list.Items[i])
		if err == nil {
			apps = append(apps, app)
		}
	}
	return apps, list.Continue, nil
}

func (c *AppK8sClient) PublicIngress(id *flyteapp.Identifier) *flyteapp.Ingress {
	if c.cfg.BaseDomain == "" {
		return nil
	}
	scheme := c.cfg.Scheme
	if scheme == "" {
		scheme = "https"
	}
	url := scheme + "://" + AppHost(id, c.cfg.BaseDomain)
	if c.cfg.IngressAppsPort != 0 {
		url += fmt.Sprintf(":%d", c.cfg.IngressAppsPort)
	}
	return &flyteapp.Ingress{PublicUrl: url}
}

func AppHost(id *flyteapp.Identifier, baseDomain string) string {
	return strings.ToLower(fmt.Sprintf("%s.%s", AppResourceName(id), strings.Trim(baseDomain, ".")))
}
func AppResourceName(id *flyteapp.Identifier) string {
	raw := strings.ToLower(fmt.Sprintf("%s-%s-%s", id.GetName(), id.GetProject(), id.GetDomain()))
	if len(raw) <= maxAppResourceNameLen {
		return raw
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s/%s/%s", id.GetProject(), id.GetDomain(), id.GetName())))
	prefix := raw[:maxAppResourceNameLen-9]
	return strings.TrimRight(prefix, "-") + "-" + hex.EncodeToString(sum[:4])
}

func renderNamespacedSuffix(tmpl, project, domain string) string {
	return strings.NewReplacer(
		"{{ project }}", strings.ToLower(project),
		"{{ domain }}", strings.ToLower(domain),
	).Replace(tmpl)
}

func marshalSpec(spec *flyteapp.Spec) ([]byte, error) { return proto.Marshal(spec) }
func specSHA(specBytes []byte) string {
	sum := sha256.Sum256(specBytes)
	return hex.EncodeToString(sum[:8])
}

func buildPodSpec(spec *flyteapp.Spec) (corev1.PodSpec, error) {
	switch payload := spec.GetAppPayload().(type) {
	case *flyteapp.Spec_Container:
		container := payload.Container
		podContainer := corev1.Container{Name: "app", Image: container.GetImage(), Command: container.GetCommand(), Args: container.GetArgs(), Resources: buildResourceRequirements(container.GetResources())}
		for _, env := range container.GetEnv() {
			podContainer.Env = append(podContainer.Env, corev1.EnvVar{Name: env.GetKey(), Value: env.GetValue()})
		}
		for _, port := range container.GetPorts() {
			podContainer.Ports = append(podContainer.Ports, corev1.ContainerPort{Name: port.GetName(), ContainerPort: int32(port.GetContainerPort())})
		}
		return corev1.PodSpec{Containers: []corev1.Container{podContainer}, EnableServiceLinks: boolPtr(false)}, nil
	case *flyteapp.Spec_Pod:
		if payload.Pod == nil || payload.Pod.GetPodSpec() == nil {
			return corev1.PodSpec{}, fmt.Errorf("K8sPod app payload must include pod_spec")
		}
		podSpec := corev1.PodSpec{}
		if err := utils.UnmarshalStructToObj(payload.Pod.GetPodSpec(), &podSpec); err != nil {
			return corev1.PodSpec{}, fmt.Errorf("failed to unmarshal K8sPod pod_spec: %w", err)
		}
		if len(podSpec.Containers) == 0 {
			return corev1.PodSpec{}, fmt.Errorf("K8sPod pod_spec must include at least one container")
		}
		if podSpec.EnableServiceLinks == nil {
			podSpec.EnableServiceLinks = boolPtr(false)
		}
		return podSpec, nil
	default:
		return corev1.PodSpec{}, fmt.Errorf("app spec has no payload (container or pod required)")
	}
}

func buildResourceRequirements(res *flytecore.Resources) corev1.ResourceRequirements {
	if res == nil {
		return corev1.ResourceRequirements{}
	}
	out := corev1.ResourceRequirements{}
	if len(res.GetRequests()) > 0 {
		out.Requests = corev1.ResourceList{}
		for _, entry := range res.GetRequests() {
			if name, ok := protoResourceName(entry.GetName()); ok {
				out.Requests[name] = k8sresource.MustParse(entry.GetValue())
			}
		}
	}
	if len(res.GetLimits()) > 0 {
		out.Limits = corev1.ResourceList{}
		for _, entry := range res.GetLimits() {
			if name, ok := protoResourceName(entry.GetName()); ok {
				out.Limits[name] = k8sresource.MustParse(entry.GetValue())
			}
		}
	}
	return out
}

func protoResourceName(name flytecore.Resources_ResourceName) (corev1.ResourceName, bool) {
	switch name {
	case flytecore.Resources_CPU:
		return corev1.ResourceCPU, true
	case flytecore.Resources_MEMORY:
		return corev1.ResourceMemory, true
	case flytecore.Resources_STORAGE:
		return corev1.ResourceStorage, true
	case flytecore.Resources_EPHEMERAL_STORAGE:
		return corev1.ResourceEphemeralStorage, true
	case flytecore.Resources_GPU:
		return corev1.ResourceName("nvidia.com/gpu"), true
	default:
		return "", false
	}
}
func boolPtr(value bool) *bool { return &value }

func (c *AppK8sClient) deploymentToApp(deployment *appsv1.Deployment) (*flyteapp.App, error) {
	parts := strings.SplitN(deployment.Annotations[annotationAppID], "/", 3)
	if len(parts) != 3 {
		return nil, fmt.Errorf("Deployment %s missing or has malformed %s", deployment.Name, annotationAppID)
	}
	org := deployment.Annotations[annotationAppOrg]
	if org == "" {
		org = defaultOrg
	}
	id := &flyteapp.Identifier{Org: org, Project: parts[0], Domain: parts[1], Name: parts[2]}
	spec := specFromAnnotations(deployment.Annotations)
	if spec != nil && deployment.Labels[labelAppStopped] == "true" {
		spec.DesiredState = flyteapp.Spec_DESIRED_STATE_STOPPED
	}
	return &flyteapp.App{Metadata: &flyteapp.Meta{Id: id}, Spec: spec, Status: c.deploymentToStatus(deployment, id)}, nil
}

func specFromAnnotations(annotations map[string]string) *flyteapp.Spec {
	b64 := annotations[annotationSpec]
	if b64 == "" {
		return nil
	}
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil
	}
	spec := &flyteapp.Spec{}
	if proto.Unmarshal(raw, spec) != nil {
		return nil
	}
	return spec
}

func (c *AppK8sClient) deploymentToStatus(deployment *appsv1.Deployment, id *flyteapp.Identifier) *flyteapp.Status {
	status := &flyteapp.Status{CurrentReplicas: uint32(deployment.Status.ReadyReplicas), Ingress: c.PublicIngress(id), K8SMetadata: &flyteapp.K8SMetadata{Namespace: deployment.Namespace}}
	if !deployment.CreationTimestamp.IsZero() {
		status.CreatedAt = timestamppb.New(deployment.CreationTimestamp.Time)
	}
	phase, message := deploymentStatus(deployment)
	status.Conditions = []*flyteapp.Condition{{DeploymentStatus: phase, Message: message, LastTransitionTime: timestamppb.Now()}}
	return status
}

func deploymentStatus(deployment *appsv1.Deployment) (flyteapp.Status_DeploymentStatus, string) {
	if deployment.Labels[labelAppStopped] == "true" || deployment.Spec.Replicas == nil || *deployment.Spec.Replicas == 0 {
		return flyteapp.Status_DEPLOYMENT_STATUS_STOPPED, "App scaled to zero"
	}
	desired := *deployment.Spec.Replicas
	for _, condition := range deployment.Status.Conditions {
		if condition.Type == appsv1.DeploymentProgressing && condition.Status == corev1.ConditionFalse {
			return flyteapp.Status_DEPLOYMENT_STATUS_FAILED, fmt.Sprintf("%s: %s", condition.Reason, condition.Message)
		}
	}
	if deployment.Status.AvailableReplicas >= desired {
		return flyteapp.Status_DEPLOYMENT_STATUS_ACTIVE, "Deployment is available"
	}
	if deployment.Status.UpdatedReplicas < desired {
		return flyteapp.Status_DEPLOYMENT_STATUS_DEPLOYING, "Deployment rollout in progress"
	}
	return flyteapp.Status_DEPLOYMENT_STATUS_SCALING_UP, "Waiting for ready replicas"
}

func (c *AppK8sClient) GetReplicas(ctx context.Context, appID *flyteapp.Identifier) ([]*flyteapp.Replica, error) {
	pods := &corev1.PodList{}
	if err := c.k8sClient.List(ctx, pods, client.InNamespace(AppNamespace), client.MatchingLabels(appSelectorLabels(appID))); err != nil {
		return nil, err
	}
	result := make([]*flyteapp.Replica, 0, len(pods.Items))
	for i := range pods.Items {
		result = append(result, podToReplica(appID, &pods.Items[i]))
	}
	return result, nil
}

func (c *AppK8sClient) DeleteReplica(ctx context.Context, replicaID *flyteapp.ReplicaIdentifier) error {
	pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: replicaID.GetName(), Namespace: AppNamespace}}
	if err := c.k8sClient.Delete(ctx, pod); err != nil && !k8serrors.IsNotFound(err) {
		return err
	}
	return nil
}

func podToReplica(appID *flyteapp.Identifier, pod *corev1.Pod) *flyteapp.Replica {
	status, reason := podDeploymentStatus(pod)
	return &flyteapp.Replica{Metadata: &flyteapp.ReplicaMeta{Id: &flyteapp.ReplicaIdentifier{AppId: appID, Name: pod.Name}}, Status: &flyteapp.ReplicaStatus{DeploymentStatus: status, Reason: reason}}
}
func podDeploymentStatus(pod *corev1.Pod) (string, string) {
	switch pod.Status.Phase {
	case corev1.PodRunning:
		for _, container := range pod.Status.ContainerStatuses {
			if !container.Ready {
				if container.State.Waiting != nil {
					return "DEPLOYING", container.State.Waiting.Reason
				}
				return "DEPLOYING", "container not ready"
			}
		}
		return "ACTIVE", ""
	case corev1.PodPending:
		for _, container := range pod.Status.ContainerStatuses {
			if container.State.Waiting != nil && container.State.Waiting.Reason != "" {
				return "PENDING", container.State.Waiting.Reason
			}
		}
		return "PENDING", string(pod.Status.Phase)
	case corev1.PodFailed:
		if pod.Status.Reason != "" {
			return "FAILED", pod.Status.Reason
		}
		return "FAILED", "pod failed"
	case corev1.PodSucceeded:
		return "STOPPED", "pod completed"
	default:
		return "PENDING", string(pod.Status.Phase)
	}
}
