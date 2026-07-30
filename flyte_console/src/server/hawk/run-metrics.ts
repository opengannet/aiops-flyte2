import { statusError } from "@/server/http/response";
import {
  buildHawkContainerId,
  resolveRunTargets,
  type HawkRunTarget,
  type HawkRunTargetDependencies,
  type HawkRunTargetParams,
} from "@/server/hawk/run-targets";

export { buildHawkContainerId };

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
    query: (gpuUuid: string) =>
      `node_resources_gpu_utilization_percent_avg{gpu_uuid="${gpuUuid}"}`,
  },
  gpuMemoryUsage: {
    label: "GPU Memory Usage",
    unit: "percent",
    aggregation: "avg",
    query: (gpuUuid: string) =>
      `node_resources_gpu_memory_utilization_percent_avg{gpu_uuid="${gpuUuid}"}`,
  },
} as const;

export type MetricKey = keyof typeof METRIC_DEFINITIONS;

export type HawkRunMetricsParams = HawkRunTargetParams & {
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

export type HawkRunMetricsTarget = HawkRunTarget;

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

export type HawkRunMetricsDependencies = HawkRunTargetDependencies & {
  queryHawkRange?: (input: {
    query: string;
    start: number;
    end: number;
    step: number;
  }) => Promise<PrometheusMatrixData>;
};

const GPU_UUID_DISCOVERY_QUERY = (containerId: string) =>
  `container_resources_gpu_usage_percent{container_id="${containerId}"}`;

type HawkRunMetricsResolvedDependencies = HawkRunTargetDependencies & {
  queryHawkRange: NonNullable<HawkRunMetricsDependencies["queryHawkRange"]>;
};

export async function getHawkRunMetrics(
  params: HawkRunMetricsParams,
  dependencies: HawkRunMetricsDependencies = {},
): Promise<HawkRunMetricsResult> {
  const deps = withDefaultDependencies(dependencies);
  const targets = await resolveRunTargets(params, deps);

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
  const targets = await resolveRunTargets(params, deps);
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
): HawkRunMetricsResolvedDependencies {
  return {
    getActionDetails: dependencies.getActionDetails,
    getPod: dependencies.getPod,
    listPods: dependencies.listPods,
    queryHawkRange: dependencies.queryHawkRange ?? queryHawkRange,
  };
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

  const matrices = await queryMatricesForMetric(
    key,
    targets,
    params,
    queryRange,
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

  const matrices = await queryMatricesForMetric(
    key,
    targets,
    params,
    queryRange,
  );
  return matrices.flatMap(matrixToRawSeries);
}

async function queryMatricesForMetric(
  key: MetricKey,
  targets: HawkRunMetricsTarget[],
  params: HawkRunMetricsParams,
  queryRange: Required<HawkRunMetricsDependencies>["queryHawkRange"],
) {
  const definition = METRIC_DEFINITIONS[key];
  if (isGpuMetricKey(key)) {
    const gpuUuids = await discoverGpuUuids(targets, params, queryRange);
    return Promise.all(
      gpuUuids.map((gpuUuid) =>
        queryRange({
          query: definition.query(escapePrometheusLabelValue(gpuUuid)),
          start: params.start,
          end: params.end,
          step: params.step,
        }),
      ),
    );
  }

  return Promise.all(
    targets.map((target) =>
      queryRange({
        query: definition.query(escapePrometheusLabelValue(target.containerId)),
        start: params.start,
        end: params.end,
        step: params.step,
      }),
    ),
  );
}

async function discoverGpuUuids(
  targets: HawkRunMetricsTarget[],
  params: HawkRunMetricsParams,
  queryRange: Required<HawkRunMetricsDependencies>["queryHawkRange"],
) {
  const matrices = await Promise.all(
    targets.map((target) =>
      queryRange({
        query: GPU_UUID_DISCOVERY_QUERY(
          escapePrometheusLabelValue(target.containerId),
        ),
        start: params.start,
        end: params.end,
        step: params.step,
      }),
    ),
  );
  const seen = new Set<string>();
  for (const matrix of matrices) {
    for (const series of matrix.result ?? []) {
      const gpuUuid = series.metric?.gpu_uuid?.trim();
      if (gpuUuid) {
        seen.add(gpuUuid);
      }
    }
  }
  return Array.from(seen);
}

function isGpuMetricKey(
  key: MetricKey,
): key is "gpuUtilization" | "gpuMemoryUsage" {
  return key === "gpuUtilization" || key === "gpuMemoryUsage";
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

function escapePrometheusLabelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

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
