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

const METRIC_DEFINITIONS = {
  cpuUsage: {
    label: "CPU Usage",
    unit: "cores",
    aggregation: "sum",
    query: (containerId: string) =>
      `rate(container_resources_cpu_usage_seconds_total{container_id="${containerId}"}[2m])`,
  },
  memoryRss: {
    label: "Memory Usage",
    unit: "bytes",
    aggregation: "sum",
    query: (containerId: string) =>
      `container_resources_memory_rss_bytes{container_id="${containerId}"}`,
  },
  gpuUtilization: {
    label: "GPU Utilization",
    unit: "percent",
    aggregation: "avg",
    query: (containerId: string) =>
      `container_resources_gpu_usage_percent{container_id="${containerId}"}`,
  },
  gpuMemoryUsage: {
    label: "GPU Memory Usage",
    unit: "percent",
    aggregation: "avg",
    query: (containerId: string) =>
      `container_resources_gpu_memory_usage_percent{container_id="${containerId}"}`,
  },
} as const;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;

export type HawkRunMetricsParams = {
  org: string;
  project: string;
  domain: string;
  runId: string;
  actionId: string;
  attempt?: number;
  start: number;
  end: number;
  step: number;
};

export type HawkRunMetricPoint = {
  timestamp: number;
  value: number;
};

export type HawkRunMetricSeries = {
  label: string;
  unit: string;
  points: HawkRunMetricPoint[];
  emptyReason?: string;
};

export type HawkRawMetricSeries = {
  metric: Record<string, string>;
  points: HawkRunMetricPoint[];
};

export type HawkRunMetricsTarget = {
  namespace: string;
  podName: string;
  containerName: string;
  containerId: string;
  cpuRequestCores?: number;
  memoryRequestBytes?: number;
};

export type HawkRunMetricsResult = {
  start: number;
  end: number;
  step: number;
  targets: HawkRunMetricsTarget[];
  metrics: Record<MetricKey, HawkRunMetricSeries>;
};

export type HawkRunMetricSeriesResult = {
  start: number;
  end: number;
  step: number;
  targets: HawkRunMetricsTarget[];
  metrics: Partial<Record<MetricKey, HawkRawMetricSeries[]>>;
};

export type HawkRunMetricsDependencies = {
  getActionDetails?: (
    params: HawkRunMetricsParams,
  ) => Promise<ActionDetails | undefined>;
  getPod?: (input: {
    namespace: string;
    podName: string;
  }) => Promise<KubernetesPod | undefined>;
  listPods?: (input: {
    namespace: string;
    labelSelector: string;
  }) => Promise<KubernetesPod[]>;
  queryHawkRange?: (input: {
    query: string;
    start: number;
    end: number;
    step: number;
  }) => Promise<PrometheusMatrixData>;
};

export function buildHawkContainerId(
  namespace: string,
  podName: string,
  containerName: string,
) {
  return `/k8s/${namespace}/${podName}/${containerName}`;
}

export async function getHawkRunMetrics(
  params: HawkRunMetricsParams,
  dependencies: HawkRunMetricsDependencies = {},
): Promise<HawkRunMetricsResult> {
  const deps = withDefaultDependencies(dependencies);
  const targets = await resolveRunMetricTargets(params, deps);

  const metrics = Object.fromEntries(
    await Promise.all(
      (Object.keys(METRIC_DEFINITIONS) as MetricKey[]).map(async (key) => [
        key,
        await queryMetric(key, targets, params, deps.queryHawkRange),
      ]),
    ),
  ) as Record<MetricKey, HawkRunMetricSeries>;

  return {
    start: params.start,
    end: params.end,
    step: params.step,
    targets,
    metrics,
  };
}

export async function getHawkRunMetricSeries(
  params: HawkRunMetricsParams,
  metricKeys: MetricKey[],
  dependencies: HawkRunMetricsDependencies = {},
): Promise<HawkRunMetricSeriesResult> {
  const deps = withDefaultDependencies(dependencies);
  const targets = await resolveRunMetricTargets(params, deps);
  const requestedMetricKeys = Array.from(new Set(metricKeys));

  const metrics = Object.fromEntries(
    await Promise.all(
      requestedMetricKeys.map(async (key) => [
        key,
        await queryMetricSeries(key, targets, params, deps.queryHawkRange),
      ]),
    ),
  ) as Partial<Record<MetricKey, HawkRawMetricSeries[]>>;

  return {
    start: params.start,
    end: params.end,
    step: params.step,
    targets,
    metrics,
  };
}

function withDefaultDependencies(
  dependencies: HawkRunMetricsDependencies,
): Required<HawkRunMetricsDependencies> {
  return {
    getActionDetails: dependencies.getActionDetails ?? getActionDetails,
    getPod: dependencies.getPod ?? getKubernetesPod,
    listPods: dependencies.listPods ?? listKubernetesPods,
    queryHawkRange: dependencies.queryHawkRange ?? queryHawkRange,
  };
}

async function getActionDetails(params: HawkRunMetricsParams) {
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

async function resolveRunMetricTargets(
  params: HawkRunMetricsParams,
  deps: Required<HawkRunMetricsDependencies>,
) {
  const actionDetails = await deps.getActionDetails(params);
  let targets = await resolveTargetsFromActionDetails(params, actionDetails);

  if (targets.length > 0) {
    return enrichTargetsWithPodRequests(targets, deps.getPod);
  }

  const labelSelector = buildRunActionLabelSelector(params);
  const pods = await deps.listPods({
    namespace: AIONE_RUNTIME_NAMESPACE,
    labelSelector,
  });
  targets = targetsFromPods(pods);
  return targets;
}

async function resolveTargetsFromActionDetails(
  params: HawkRunMetricsParams,
  actionDetails: ActionDetails | undefined,
) {
  const logContext = getSelectedAttemptLogContext(
    actionDetails,
    params.attempt,
  );
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

function getSelectedAttemptLogContext(
  actionDetails: ActionDetails | undefined,
  selectedAttempt: number | undefined,
) {
  const attempts = actionDetails?.attempts ?? [];
  if (selectedAttempt !== undefined) {
    return attempts.find((attempt) => attempt.attempt === selectedAttempt)
      ?.logContext;
  }
  return attempts
    .filter((attempt) => attempt.logContext)
    .sort((a, b) => b.attempt - a.attempt)[0]?.logContext;
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
  targets: HawkRunMetricsTarget[],
  getPod: Required<HawkRunMetricsDependencies>["getPod"],
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
}: HawkRunMetricsParams) {
  return [
    `flyte.org/project=${project}`,
    `flyte.org/domain=${domain}`,
    `flyte.org/run-name=${runId}`,
    `flyte.org/action-name=${actionId}`,
  ].join(",");
}

async function queryMetric(
  key: MetricKey,
  targets: HawkRunMetricsTarget[],
  params: HawkRunMetricsParams,
  queryRange: Required<HawkRunMetricsDependencies>["queryHawkRange"],
): Promise<HawkRunMetricSeries> {
  const definition = METRIC_DEFINITIONS[key];
  if (targets.length === 0) {
    return {
      label: definition.label,
      unit: definition.unit,
      points: [],
      emptyReason: "No runtime pod target was found for this action attempt.",
    };
  }

  const matrices = await Promise.all(
    targets.map((target) =>
      queryRange({
        query: definition.query(escapePrometheusLabelValue(target.containerId)),
        start: params.start,
        end: params.end,
        step: params.step,
      }),
    ),
  );
  const points = aggregateMatrices(
    matrices,
    definition.aggregation as "sum" | "avg",
  );
  return {
    label: definition.label,
    unit: definition.unit,
    points,
    emptyReason:
      points.length === 0 ? "Hawk has no samples for this metric." : undefined,
  };
}

async function queryMetricSeries(
  key: MetricKey,
  targets: HawkRunMetricsTarget[],
  params: HawkRunMetricsParams,
  queryRange: Required<HawkRunMetricsDependencies>["queryHawkRange"],
): Promise<HawkRawMetricSeries[]> {
  const definition = METRIC_DEFINITIONS[key];
  if (targets.length === 0) {
    return [];
  }

  const matrices = await Promise.all(
    targets.map((target) =>
      queryRange({
        query: definition.query(escapePrometheusLabelValue(target.containerId)),
        start: params.start,
        end: params.end,
        step: params.step,
      }),
    ),
  );
  return matrices.flatMap(matrixToRawSeries);
}

function aggregateMatrices(
  matrices: PrometheusMatrixData[],
  aggregation: "sum" | "avg",
) {
  const grouped = new Map<number, { sum: number; count: number }>();
  for (const matrix of matrices) {
    for (const series of matrix.result ?? []) {
      for (const [rawTimestamp, rawValue] of series.values ?? []) {
        const timestamp = Number(rawTimestamp);
        const value = Number(rawValue);
        if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
          continue;
        }
        const current = grouped.get(timestamp) ?? { sum: 0, count: 0 };
        current.sum += value;
        current.count += 1;
        grouped.set(timestamp, current);
      }
    }
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, values]) => ({
      timestamp,
      value: aggregation === "avg" ? values.sum / values.count : values.sum,
    }));
}

function matrixToRawSeries(matrix: PrometheusMatrixData) {
  return (matrix.result ?? []).flatMap((series) => {
    const points = parseMetricPoints(series.values ?? []);
    if (points.length === 0) {
      return [];
    }
    return [
      {
        metric: { ...(series.metric ?? {}) },
        points,
      },
    ];
  });
}

function parseMetricPoints(values: Array<[number | string, string]>) {
  return values
    .flatMap(([rawTimestamp, rawValue]) => {
      const timestamp = Number(rawTimestamp);
      const value = Number(rawValue);
      if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
        return [];
      }
      return [{ timestamp, value }];
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function queryHawkRange({
  query,
  start,
  end,
  step,
}: {
  query: string;
  start: number;
  end: number;
  step: number;
}): Promise<PrometheusMatrixData> {
  const hawkUrl = process.env.HAWK_API_URL?.trim();
  const apiKey = process.env.HAWK_API_KEY?.trim();
  if (!hawkUrl) {
    throw statusError("HAWK_API_URL is not configured", 503);
  }
  if (!apiKey) {
    throw statusError("HAWK_API_KEY is not configured", 503);
  }

  const url = new URL("/api/v1/query_range", trimTrailingSlash(hawkUrl));
  url.searchParams.set("query", query);
  url.searchParams.set("start", String(start));
  url.searchParams.set("end", String(end));
  url.searchParams.set("step", String(step));

  const response = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) {
    throw statusError(`Hawk query failed with HTTP ${response.status}`, 502);
  }
  const body = (await response.json()) as PrometheusQueryRangeResponse;
  if (body.status !== "success") {
    throw statusError(body.error || "Hawk query failed", 502);
  }
  return body.data ?? { resultType: "matrix", result: [] };
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

function parseCpuCores(value: string | number | undefined) {
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

function parseMemoryBytes(value: string | number | undefined) {
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

function escapePrometheusLabelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
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

type PrometheusQueryRangeResponse = {
  status?: string;
  error?: string;
  data?: PrometheusMatrixData;
};

type PrometheusMatrixData = {
  resultType?: string;
  result?: Array<{
    metric?: Record<string, string>;
    values?: Array<[number | string, string]>;
  }>;
};
