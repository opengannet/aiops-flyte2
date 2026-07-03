package trainingtask

import (
	"context"
	"fmt"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/flyteorg/flyte/v2/flyteplugins/aione/k8slogs"
	"github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery"
	pluginsCore "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core"
)

type Plugin struct {
	kubeClient client.Client
}

func NewPlugin(kubeClient client.Client) *Plugin {
	return &Plugin{kubeClient: kubeClient}
}

func (p *Plugin) GetID() string {
	return TaskType
}

func (p *Plugin) GetProperties() pluginsCore.PluginProperties {
	return pluginsCore.PluginProperties{DisableNodeLevelCaching: true}
}

func (p *Plugin) Handle(ctx context.Context, tCtx pluginsCore.TaskExecutionContext) (pluginsCore.Transition, error) {
	taskTemplate, err := tCtx.TaskReader().Read(ctx)
	if err != nil {
		return pluginsCore.UnknownTransition, err
	}
	cfg, err := ParseConfig(taskTemplate)
	if err != nil {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoFailure("BadTaskSpecification", err.Error(), nil)), nil
	}

	identity := trainingIdentityFromMetadata(tCtx.TaskExecutionMetadata())
	resources, err := BuildResources(identity, cfg)
	if err != nil {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoFailure("BadTaskSpecification", err.Error(), nil)), nil
	}

	for _, secret := range []*corev1.Secret{resources.CodeRepositorySecret, resources.CodeDownloaderSecret, resources.DatasetDownloaderSecret} {
		if secret == nil {
			continue
		}
		if _, err := p.ensureSecret(ctx, secret); err != nil {
			return pluginsCore.UnknownTransition, err
		}
	}
	if _, err := p.ensurePVCs(ctx, resources.CloudStoragePVCs); err != nil {
		return pluginsCore.UnknownTransition, err
	}
	created, err := p.ensureJob(ctx, resources.Job)
	if err != nil {
		return pluginsCore.UnknownTransition, err
	}
	if created {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoQueued(time.Now(), pluginsCore.DefaultPhaseVersion, "training task submitted to Kubernetes")), nil
	}

	var job batchv1.Job
	if err := p.kubeClient.Get(ctx, client.ObjectKeyFromObject(resources.Job), &job); err != nil {
		if apierrors.IsNotFound(err) {
			return pluginsCore.DoTransition(pluginsCore.PhaseInfoSystemRetryableFailure("TrainingJobMissing", "training Job was deleted", nil)), nil
		}
		return pluginsCore.UnknownTransition, err
	}
	pods, err := p.trainingPods(ctx, &job)
	if err != nil {
		return pluginsCore.UnknownTransition, err
	}
	taskInfo := taskInfoForPods(pods.Items)

	if job.Status.Succeeded > 0 {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoSuccess(taskInfo)), nil
	}
	if condition := failedCondition(job.Status.Conditions); condition != nil {
		return pluginsCore.DoTransition(pluginsCore.PhaseInfoFailure(condition.Reason, condition.Message, taskInfo)), nil
	}
	if job.Status.Active > 0 {
		if imagePullFailure := imagePullFailureFromPods(pods.Items); imagePullFailure != "" {
			return pluginsCore.DoTransition(pluginsCore.PhaseInfoFailure("ImagePullFailed", imagePullFailure, taskInfo)), nil
		}
		version := pluginsCore.DefaultPhaseVersion
		if taskInfo != nil && taskInfo.LogContext != nil {
			version++
		}
		info := pluginsCore.PhaseInfoRunning(version, taskInfo)
		info.WithReason("training task is running")
		return pluginsCore.DoTransition(info), nil
	}

	return pluginsCore.DoTransition(pluginsCore.PhaseInfoInitializing(time.Now(), pluginsCore.DefaultPhaseVersion, "waiting for training task pod", taskInfo)), nil
}

func (p *Plugin) Abort(ctx context.Context, tCtx pluginsCore.TaskExecutionContext) error {
	taskTemplate, err := tCtx.TaskReader().Read(ctx)
	if err != nil {
		return err
	}
	cfg, err := ParseConfig(taskTemplate)
	if err != nil {
		return nil
	}
	identity := trainingIdentityFromMetadata(tCtx.TaskExecutionMetadata())
	resources, err := BuildResources(identity, cfg)
	if err != nil {
		return nil
	}
	for _, secret := range []*corev1.Secret{resources.CodeRepositorySecret, resources.CodeDownloaderSecret, resources.DatasetDownloaderSecret} {
		if secret == nil {
			continue
		}
		if err := ignoreNotFound(p.kubeClient.Delete(ctx, secret)); err != nil {
			return err
		}
	}
	if err := p.deleteTrainingJob(ctx, resources.Job); err != nil {
		return err
	}
	return p.deleteTrainingPods(ctx, resources.Job.Namespace, resources.Job.Spec.Template.Labels)
}

func (p *Plugin) Finalize(context.Context, pluginsCore.TaskExecutionContext) error {
	return nil
}

func (p *Plugin) trainingPods(ctx context.Context, job *batchv1.Job) (*corev1.PodList, error) {
	pods := &corev1.PodList{}
	if job == nil {
		return pods, nil
	}
	if err := p.kubeClient.List(ctx, pods, client.InNamespace(job.Namespace), client.MatchingLabels(job.Spec.Template.Labels)); err != nil {
		return nil, err
	}
	return pods, nil
}

func (p *Plugin) deleteTrainingJob(ctx context.Context, job *batchv1.Job) error {
	return ignoreNotFound(p.kubeClient.Delete(ctx, job, client.PropagationPolicy(metav1.DeletePropagationBackground)))
}

func (p *Plugin) deleteTrainingPods(ctx context.Context, namespace string, labels map[string]string) error {
	if err := validateTrainingPodDeleteLabels(labels); err != nil {
		return err
	}
	pods := &corev1.PodList{}
	if err := p.kubeClient.List(ctx, pods, client.InNamespace(namespace), client.MatchingLabels(labels)); err != nil {
		return err
	}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if err := ignoreNotFound(p.kubeClient.Delete(ctx, pod)); err != nil {
			return err
		}
	}
	return nil
}

func validateTrainingPodDeleteLabels(labels map[string]string) error {
	requiredLabels := []string{labelRunName, labelProject, labelDomain, labelActionName, labelTrainingTaskName}
	for _, key := range requiredLabels {
		if strings.TrimSpace(labels[key]) == "" {
			return fmt.Errorf("refusing to delete training pods with incomplete selector: missing %s", key)
		}
	}
	return nil
}

func imagePullFailureFromPods(pods []corev1.Pod) string {
	for i := range pods {
		for _, status := range pods[i].Status.ContainerStatuses {
			waiting := status.State.Waiting
			if waiting == nil || !isImagePullFailureReason(waiting.Reason) {
				continue
			}
			message := strings.TrimSpace(waiting.Message)
			if message == "" {
				message = waiting.Reason
			}
			return "镜像拉取失败: " + message
		}
	}
	return ""
}

func taskInfoForPods(pods []corev1.Pod) *pluginsCore.TaskInfo {
	logContext := k8slogs.LogContextFromPods(pods)
	if logContext == nil {
		return nil
	}
	return &pluginsCore.TaskInfo{LogContext: logContext}
}

func isImagePullFailureReason(reason string) bool {
	return reason == "ImagePullBackOff" || reason == "ErrImagePull"
}

func (p *Plugin) ensureJob(ctx context.Context, job *batchv1.Job) (bool, error) {
	var existing batchv1.Job
	if err := p.kubeClient.Get(ctx, client.ObjectKeyFromObject(job), &existing); err == nil {
		return false, nil
	} else if !apierrors.IsNotFound(err) {
		return false, err
	}
	if err := p.kubeClient.Create(ctx, job); err != nil {
		if apierrors.IsAlreadyExists(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (p *Plugin) ensurePVCs(ctx context.Context, pvcs []*corev1.PersistentVolumeClaim) (bool, error) {
	created := false
	for _, pvc := range pvcs {
		var existing corev1.PersistentVolumeClaim
		if err := p.kubeClient.Get(ctx, client.ObjectKeyFromObject(pvc), &existing); err == nil {
			continue
		} else if !apierrors.IsNotFound(err) {
			return false, err
		}
		if err := p.kubeClient.Create(ctx, pvc); err != nil {
			if apierrors.IsAlreadyExists(err) {
				continue
			}
			return false, err
		}
		created = true
	}
	return created, nil
}

func (p *Plugin) ensureSecret(ctx context.Context, secret *corev1.Secret) (bool, error) {
	var existing corev1.Secret
	if err := p.kubeClient.Get(ctx, client.ObjectKeyFromObject(secret), &existing); err == nil {
		return false, nil
	} else if !apierrors.IsNotFound(err) {
		return false, err
	}
	if err := p.kubeClient.Create(ctx, secret); err != nil {
		if apierrors.IsAlreadyExists(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func trainingIdentityFromMetadata(metadata pluginsCore.TaskExecutionMetadata) TrainingIdentity {
	taskExecutionID := metadata.GetTaskExecutionID()
	generatedName := taskExecutionID.GetGeneratedName()
	identity := TrainingIdentity{
		Namespace: metadata.GetNamespace(),
		Name:      generatedName,
		RunName:   generatedName,
	}
	if id := taskExecutionID.GetID(); id != nil {
		if nodeID := id.GetNodeExecutionId(); nodeID != nil {
			identity.ActionName = nodeID.GetNodeId()
			if executionID := nodeID.GetExecutionId(); executionID != nil {
				identity.Project = executionID.GetProject()
				identity.Domain = executionID.GetDomain()
				identity.RunName = executionID.GetName()
				identity.Org = executionID.GetOrg()
			}
		}
	}
	return identity
}

func failedCondition(conditions []batchv1.JobCondition) *batchv1.JobCondition {
	for i := range conditions {
		if conditions[i].Type == batchv1.JobFailed && conditions[i].Status == "True" {
			return &conditions[i]
		}
	}
	return nil
}

func ignoreNotFound(err error) error {
	if err == nil || apierrors.IsNotFound(err) {
		return nil
	}
	return err
}

func init() {
	pluginmachinery.PluginRegistry().RegisterCorePlugin(pluginsCore.PluginEntry{
		ID:                  TaskType,
		RegisteredTaskTypes: []pluginsCore.TaskType{TaskType},
		LoadPlugin: func(ctx context.Context, iCtx pluginsCore.SetupContext) (pluginsCore.Plugin, error) {
			if iCtx.KubeClient() == nil {
				return nil, fmt.Errorf("training task plugin requires a Kubernetes client")
			}
			return NewPlugin(iCtx.KubeClient().GetClient()), nil
		},
		IsDefault: false,
	})
}
