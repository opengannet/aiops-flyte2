package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"

	flyteapp "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/app"
)

func TestBuildModelPodSpecSeparatesGPUResourceFromNodeLabel(t *testing.T) {
	podSpec := buildModelPodSpec(
		"vllm",
		nil,
		defaultVLLMPort,
		&flyteapp.ModelResourceDefinition{
			Gpu:                1,
			GpuKey:             "nvidia.com/gpu",
			GpuNodeLabelKey:    "nvidia.com/t4",
		},
		"model-cache",
		"model-downloader",
		false,
	)

	resources := podSpec.Containers[0].Resources
	gpuRequest := resources.Requests[corev1.ResourceName("nvidia.com/gpu")]
	assert.Equal(t, "1", gpuRequest.String())
	assert.NotContains(t, resources.Requests, corev1.ResourceName("nvidia.com/t4"))
	require.NotNil(t, podSpec.Affinity)
	terms := podSpec.Affinity.NodeAffinity.RequiredDuringSchedulingIgnoredDuringExecution.NodeSelectorTerms
	require.Len(t, terms, 1)
	require.Len(t, terms[0].MatchExpressions, 1)
	assert.Equal(t, "nvidia.com/t4", terms[0].MatchExpressions[0].Key)
	assert.Equal(t, corev1.NodeSelectorOpExists, terms[0].MatchExpressions[0].Operator)
}
