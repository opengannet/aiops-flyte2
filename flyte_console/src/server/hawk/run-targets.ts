import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

import { ActionIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import type { ActionDetails } from "@/gen/flyteidl2/workflow/run_definition_pb";
import { RunService } from "@/gen/flyteidl2/workflow/run_service_pb";
import { AIONE_RUNTIME_NAMESPACE } from "@/server/aione/helpers";
import { statusError } from "@/server/http/response";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "@/server/kubernetes/client";

const DEFAULT_FLYTE_API_ORIGIN =
  "http://flyte-binary-http.flyte.svc.cluster.local:8090";

export type HawkRunTargetParams = {
  org: string;
  project: string;
  domain: string;
  runId: string;
  actionId: string;
  attempt?: number;
};

export type HawkRunTarget = {
  namespace: string;
  podName: string;
  containerName: string;
  containerId: string;
  cpuRequestCores?: number;
  memoryRequestBytes?: number;
};

export type HawkRunTargetDependencies = {
  getActionDetails?: (
    params: HawkRunTargetParams,
  ) => Promise<ActionDetails | undefined>;
  getPod?: (input: {
    namespace: string;
    podName: string;
  }) => Promise<KubernetesPod | undefined>;
  listPods?: (input: {
    namespace: string;
    labelSelector: string;
  }) => Promise<KubernetesPod[]>;
};

type ResolveRunTargetsOptions = {
  includePodRequests?: boolean;
};

export function buildHawkContainerId(
  namespace: string,
  podName: string,
  containerName: string,
) {
  return `/k8s/${namespace}/${podName}/${containerName}`;
}

export async function resolveRunTargets(
  params: HawkRunTargetParams,
  dependencies: HawkRunTargetDependencies = {},
  options: ResolveRunTargetsOptions = {},
) {
  const deps = withDefaultDependencies(dependencies);
  const actionDetails = await deps.getActionDetails(params);
  let targets = resolveTargetsFromActionDetails(params, actionDetails);

  if (targets.length > 0) {
    return options.includePodRequests === false
      ? targets
      : enrichTargetsWithPodRequests(targets, deps.getPod);
  }

  const labelSelector = buildRunActionLabelSelector(params);
  const pods = await deps.listPods({
    namespace: AIONE_RUNTIME_NAMESPACE,
    labelSelector,
  });
  targets = targetsFromPods(pods);
  return targets;
}

export async function getRunActionDetails(params: HawkRunTargetParams) {
  const client = createClient(
    RunService,
    createConnectTransport({ baseUrl: getFlyteApiOrigin() }),
  );
  const response = await client.getActionDetails({
    actionId: create(ActionIdentifierSchema, {
      name: params.actionId,
      run: {
        org: params.org,
        project: params.project,
        domain: params.domain,
        name: params.runId,
      },
    }),
  });
  return response.details;
}

export function getSelectedAttempt(
  actionDetails: ActionDetails | undefined,
  selectedAttempt: number | undefined,
) {
  const attempts = actionDetails?.attempts ?? [];
  if (selectedAttempt !== undefined) {
    return attempts.find((attempt) => attempt.attempt === selectedAttempt);
  }
  return [...attempts].sort((a, b) => b.attempt - a.attempt)[0];
}

function withDefaultDependencies(
  dependencies: HawkRunTargetDependencies,
): Required<HawkRunTargetDependencies> {
  return {
    getActionDetails: dependencies.getActionDetails ?? getRunActionDetails,
    getPod: dependencies.getPod ?? getKubernetesPod,
    listPods: dependencies.listPods ?? listKubernetesPods,
  };
}

function resolveTargetsFromActionDetails(
  params: HawkRunTargetParams,
  actionDetails: ActionDetails | undefined,
) {
  const logContext = getSelectedAttempt(
    actionDetails,
    params.attempt,
  )?.logContext;
  if (!logContext) {
    return [];
  }
  const pod = getPrimaryPodLogContext(logContext as LogContextLike);
  if (!pod?.podName?.trim()) {
    return [];
  }
  const containerName = getPrimaryContainerName(pod);
  if (!containerName) {
    return [];
  }
  const namespace = pod.namespace?.trim() || AIONE_RUNTIME_NAMESPACE;
  const podName = pod.podName.trim();
  return [
    {
      namespace,
      podName,
      containerName,
      containerId: buildHawkContainerId(namespace, podName, containerName),
    },
  ];
}

function getPrimaryPodLogContext(logContext: LogContextLike) {
  const pods = logContext.pods ?? [];
  if (pods.length === 0) {
    return undefined;
  }
  const primaryPodName = logContext.primaryPodName?.trim() ?? "";
  if (!primaryPodName) {
    return pods[0];
  }
  return pods.find((pod) => pod.podName === primaryPodName) ?? pods[0];
}

function getPrimaryContainerName(pod: PodLogContextLike) {
  const primaryContainerName = pod.primaryContainerName?.trim() ?? "";
  if (primaryContainerName) {
    return primaryContainerName;
  }
  return (
    pod.containers?.find((container) => container.containerName?.trim())
      ?.containerName ??
    pod.initContainers?.find((container) => container.containerName?.trim())
      ?.containerName ??
    ""
  ).trim();
}

async function enrichTargetsWithPodRequests(
  targets: HawkRunTarget[],
  getPod: Required<HawkRunTargetDependencies>["getPod"],
) {
  return Promise.all(
    targets.map(async (target) => {
      const pod = await getPod({
        namespace: target.namespace,
        podName: target.podName,
      });
      const container = pod?.spec?.containers?.find(
        (item) => item.name === target.containerName,
      );
      return {
        ...target,
        cpuRequestCores: parseCpuCores(container?.resources?.requests?.cpu),
        memoryRequestBytes: parseMemoryBytes(
          container?.resources?.requests?.memory,
        ),
      };
    }),
  );
}

function targetsFromPods(pods: KubernetesPod[]) {
  return pods.flatMap((pod) => {
    const namespace = pod.metadata?.namespace || AIONE_RUNTIME_NAMESPACE;
    const podName = pod.metadata?.name ?? "";
    if (!podName) {
      return [];
    }
    return (pod.spec?.containers ?? [])
      .filter((container) => container.name)
      .map((container) => ({
        namespace,
        podName,
        containerName: container.name,
        containerId: buildHawkContainerId(namespace, podName, container.name),
        cpuRequestCores: parseCpuCores(container.resources?.requests?.cpu),
        memoryRequestBytes: parseMemoryBytes(
          container.resources?.requests?.memory,
        ),
      }));
  });
}

function buildRunActionLabelSelector({
  project,
  domain,
  runId,
  actionId,
}: HawkRunTargetParams) {
  return [
    `flyte.org/project=${project}`,
    `flyte.org/domain=${domain}`,
    `flyte.org/run-name=${runId}`,
    `flyte.org/action-name=${actionId}`,
  ].join(",");
}

async function getKubernetesPod({
  namespace,
  podName,
}: {
  namespace: string;
  podName: string;
}) {
  const { apiOrigin, token, ca } = await getKubernetesClientConfig(namespace);
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}`,
    token,
    ca,
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw statusError(response.text || "failed to read Kubernetes pod", 502);
  }
  return response.json<KubernetesPod>();
}

async function listKubernetesPods({
  namespace,
  labelSelector,
}: {
  namespace: string;
  labelSelector: string;
}) {
  const { apiOrigin, token, ca } = await getKubernetesClientConfig(namespace);
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${encodeURIComponent(labelSelector)}`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(response.text || "failed to list Kubernetes pods", 502);
  }
  return response.json<KubernetesPodList>().items ?? [];
}

export function parseCpuCores(value: string | number | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const trimmed = value.trim();
  const milliMatch = /^(\d+(?:\.\d+)?)m$/.exec(trimmed);
  if (milliMatch) {
    const parsed = Number(milliMatch[1]);
    return Number.isFinite(parsed) ? parsed / 1000 : undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseMemoryBytes(value: string | number | undefined) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const trimmed = value.trim();
  const match = /^(\d+(?:\.\d+)?)(Ei|Pi|Ti|Gi|Mi|Ki|E|P|T|G|M|K)?$/.exec(
    trimmed,
  );
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const multipliers: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
  };
  return parsed * (multipliers[match[2] ?? ""] ?? 1);
}

function getFlyteApiOrigin() {
  return process.env.FLYTE_API_ORIGIN?.trim() || DEFAULT_FLYTE_API_ORIGIN;
}

type LogContextLike = {
  primaryPodName?: string;
  pods?: PodLogContextLike[];
};

type PodLogContextLike = {
  namespace?: string;
  podName?: string;
  primaryContainerName?: string;
  containers?: Array<{ containerName?: string }>;
  initContainers?: Array<{ containerName?: string }>;
};

type KubernetesPodList = {
  items?: KubernetesPod[];
};

type KubernetesPod = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    containers?: KubernetesContainer[];
  };
};

type KubernetesContainer = {
  name: string;
  resources?: {
    requests?: Record<string, string | number>;
  };
};
