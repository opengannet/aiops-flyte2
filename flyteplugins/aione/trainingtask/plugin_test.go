package trainingtask

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"

	pluginsCore "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core"
	coreMocks "github.com/flyteorg/flyte/v2/flyteplugins/go/tasks/pluginmachinery/core/mocks"
	"github.com/flyteorg/flyte/v2/gen/go/flyteidl2/core"
)

func TestPluginHandleCreatesTrainingJob(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseQueued, transition.Info().Phase())

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	assert.Equal(t, "busybox:1.36", job.Spec.Template.Spec.Containers[0].Image)
}

func TestPluginHandleReturnsSuccessWhenJobSucceeded(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	job.Status.Succeeded = 1
	require.NoError(t, k8sClient.Status().Update(ctx, &job))
	createTrainingPod(t, ctx, k8sClient, "run-abc-pod", job.Spec.Template.Labels, corev1.PodSucceeded, corev1.ContainerState{
		Terminated: &corev1.ContainerStateTerminated{ExitCode: 0},
	})

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseSuccess, transition.Info().Phase())
	assertTrainingLogContext(t, transition.Info().Info(), "run-abc-pod")
}

func TestPluginHandleReturnsRunningWithoutLogContextBeforeContainerStatusExists(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	job.Status.Active = 1
	require.NoError(t, k8sClient.Status().Update(ctx, &job))
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "run-abc-pod",
			Namespace: "flyte",
			Labels:    job.Spec.Template.Labels,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "training"}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	require.NoError(t, k8sClient.Create(ctx, pod))

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseRunning, transition.Info().Phase())
	assert.Equal(t, pluginsCore.DefaultPhaseVersion, transition.Info().Version())
	require.NotNil(t, transition.Info().Info())
	assert.Nil(t, transition.Info().Info().LogContext)
}

func TestPluginHandleReturnsRunningWithLogContextWhenContainerStatusExists(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	job.Status.Active = 1
	require.NoError(t, k8sClient.Status().Update(ctx, &job))
	createTrainingPod(t, ctx, k8sClient, "run-abc-pod", job.Spec.Template.Labels, corev1.PodRunning, corev1.ContainerState{
		Running: &corev1.ContainerStateRunning{},
	})

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhaseRunning, transition.Info().Phase())
	assert.Equal(t, pluginsCore.DefaultPhaseVersion+1, transition.Info().Version())
	assertTrainingLogContext(t, transition.Info().Info(), "run-abc-pod")
}

func TestPluginHandleReturnsFailureWithLogContextWhenJobFailed(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	job.Status.Conditions = failedJobCondition()
	require.NoError(t, k8sClient.Status().Update(ctx, &job))
	createTrainingPod(t, ctx, k8sClient, "run-abc-pod", job.Spec.Template.Labels, corev1.PodFailed, corev1.ContainerState{
		Terminated: &corev1.ContainerStateTerminated{ExitCode: 1},
	})

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	assert.Equal(t, pluginsCore.PhasePermanentFailure, transition.Info().Phase())
	assertTrainingLogContext(t, transition.Info().Info(), "run-abc-pod")
}

func TestPluginHandleFailsWhenPodImagePullBackOff(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	job.Status.Active = 1
	require.NoError(t, k8sClient.Status().Update(ctx, &job))

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "run-abc-pod",
			Namespace: "flyte",
			Labels:    job.Spec.Template.Labels,
		},
		Status: corev1.PodStatus{
			ContainerStatuses: []corev1.ContainerStatus{{
				Name: "training",
				State: corev1.ContainerState{
					Waiting: &corev1.ContainerStateWaiting{
						Reason:  "ImagePullBackOff",
						Message: `Back-off pulling image "busybox:1.36"`,
					},
				},
			}},
		},
	}
	require.NoError(t, k8sClient.Create(ctx, pod))

	transition, err := plugin.Handle(ctx, tCtx)

	require.NoError(t, err)
	require.NotNil(t, transition.Info().Err())
	assert.Equal(t, pluginsCore.PhasePermanentFailure, transition.Info().Phase())
	assert.Equal(t, "ImagePullFailed", transition.Info().Err().GetCode())
	assert.Contains(t, transition.Info().Err().GetMessage(), "镜像拉取失败")
}

func TestPluginAbortUsesBackgroundPropagation(t *testing.T) {
	ctx := context.Background()
	k8sClient := &recordingDeleteClient{Client: newFakeClient(t)}
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	require.NoError(t, plugin.Abort(ctx, tCtx))

	require.Len(t, k8sClient.jobDeletePropagationPolicies, 1)
	assert.Equal(t, metav1.DeletePropagationBackground, k8sClient.jobDeletePropagationPolicies[0])
}

func TestPluginAbortDeletesTrainingJobAndPods(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	createTrainingPod(t, ctx, k8sClient, "run-abc-pod", job.Spec.Template.Labels, corev1.PodRunning, corev1.ContainerState{
		Running: &corev1.ContainerStateRunning{},
	})
	otherLabels := cloneStringMap(job.Spec.Template.Labels)
	otherLabels[labelRunName] = "other-run"
	createTrainingPod(t, ctx, k8sClient, "other-run-pod", otherLabels, corev1.PodRunning, corev1.ContainerState{
		Running: &corev1.ContainerStateRunning{},
	})

	require.NoError(t, plugin.Abort(ctx, tCtx))

	assert.Error(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))

	var pod corev1.Pod
	assert.Error(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-pod"}, &pod))
	assert.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "other-run-pod"}, &pod))
}

func TestPluginAbortDeletesOrphanedTrainingPodsWhenJobIsGone(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	tCtx := trainingTaskContext(t, validTrainingTemplate(t), "run-abc")

	_, err := plugin.Handle(ctx, tCtx)
	require.NoError(t, err)

	var job batchv1.Job
	require.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc"}, &job))
	createTrainingPod(t, ctx, k8sClient, "run-abc-pod", job.Spec.Template.Labels, corev1.PodRunning, corev1.ContainerState{
		Running: &corev1.ContainerStateRunning{},
	})
	require.NoError(t, k8sClient.Delete(ctx, &job))

	require.NoError(t, plugin.Abort(ctx, tCtx))

	var pod corev1.Pod
	assert.Error(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-pod"}, &pod))
}

func TestDeleteTrainingPodsRequiresSpecificTrainingLabels(t *testing.T) {
	ctx := context.Background()
	k8sClient := newFakeClient(t)
	plugin := NewPlugin(k8sClient)
	labels := map[string]string{
		labelRunName: "run-abc",
		labelProject: "flytesnacks",
	}
	createTrainingPod(t, ctx, k8sClient, "run-abc-pod", labels, corev1.PodRunning, corev1.ContainerState{
		Running: &corev1.ContainerStateRunning{},
	})

	err := plugin.deleteTrainingPods(ctx, "flyte", labels)

	require.Error(t, err)
	var pod corev1.Pod
	assert.NoError(t, k8sClient.Get(ctx, types.NamespacedName{Namespace: "flyte", Name: "run-abc-pod"}, &pod))
}

func validTrainingTemplate(t *testing.T) *core.TaskTemplate {
	return taskTemplateWithCustom(t, map[string]any{
		"image":           "busybox:1.36",
		"command":         "echo hello",
		"cpu":             "1",
		"memory":          "128Mi",
		"maxRuntimeHours": float64(1),
	})
}

func trainingTaskContext(t *testing.T, tmpl *core.TaskTemplate, generatedName string) pluginsCore.TaskExecutionContext {
	t.Helper()
	taskReader := &coreMocks.TaskReader{}
	taskReader.EXPECT().Read(mock.Anything).Return(tmpl, nil)

	taskID := &coreMocks.TaskExecutionID{}
	taskID.EXPECT().GetGeneratedName().Return(generatedName)
	taskID.EXPECT().GetID().Return(&core.TaskExecutionIdentifier{
		NodeExecutionId: &core.NodeExecutionIdentifier{
			NodeId: "main",
			ExecutionId: &core.WorkflowExecutionIdentifier{
				Project: "flytesnacks",
				Domain:  "development",
				Name:    generatedName,
				Org:     "testorg",
			},
		},
	})

	meta := &coreMocks.TaskExecutionMetadata{}
	meta.EXPECT().GetNamespace().Return("flyte")
	meta.EXPECT().GetTaskExecutionID().Return(taskID)

	tCtx := &coreMocks.TaskExecutionContext{}
	tCtx.EXPECT().TaskReader().Return(taskReader)
	tCtx.EXPECT().TaskExecutionMetadata().Return(meta)
	return tCtx
}

func newFakeClient(t *testing.T) client.Client {
	t.Helper()
	scheme := runtime.NewScheme()
	require.NoError(t, corev1.AddToScheme(scheme))
	require.NoError(t, batchv1.AddToScheme(scheme))
	return fake.NewClientBuilder().WithScheme(scheme).Build()
}

type recordingDeleteClient struct {
	client.Client
	jobDeletePropagationPolicies []metav1.DeletionPropagation
}

func (c *recordingDeleteClient) Delete(ctx context.Context, obj client.Object, opts ...client.DeleteOption) error {
	if _, ok := obj.(*batchv1.Job); ok {
		options := (&client.DeleteOptions{}).ApplyOptions(opts)
		if options.PropagationPolicy != nil {
			c.jobDeletePropagationPolicies = append(c.jobDeletePropagationPolicies, *options.PropagationPolicy)
		}
	}
	return c.Client.Delete(ctx, obj, opts...)
}

func createTrainingPod(
	t *testing.T,
	ctx context.Context,
	k8sClient client.Client,
	name string,
	labels map[string]string,
	phase corev1.PodPhase,
	state corev1.ContainerState,
) {
	t.Helper()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: "flyte",
			Labels:    labels,
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "training"}},
		},
		Status: corev1.PodStatus{
			Phase: phase,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:  "training",
				State: state,
			}},
		},
	}
	require.NoError(t, k8sClient.Create(ctx, pod))
}

func cloneStringMap(input map[string]string) map[string]string {
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func assertTrainingLogContext(t *testing.T, info *pluginsCore.TaskInfo, podName string) {
	t.Helper()
	require.NotNil(t, info)
	require.NotNil(t, info.LogContext)
	assert.Equal(t, podName, info.LogContext.GetPrimaryPodName())
	require.Len(t, info.LogContext.GetPods(), 1)
	podContext := info.LogContext.GetPods()[0]
	assert.Equal(t, podName, podContext.GetPodName())
	assert.Equal(t, "training", podContext.GetPrimaryContainerName())
	require.Len(t, podContext.GetContainers(), 1)
	assert.Equal(t, "training", podContext.GetContainers()[0].GetContainerName())
}

func failedJobCondition() []batchv1.JobCondition {
	return []batchv1.JobCondition{{
		Type:          batchv1.JobFailed,
		Status:        corev1.ConditionTrue,
		Reason:        "BackoffLimitExceeded",
		Message:       "failed",
		LastProbeTime: metav1.Now(),
	}}
}
