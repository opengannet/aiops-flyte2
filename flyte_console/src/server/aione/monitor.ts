import type { ActionDetails } from "@/gen/flyteidl2/workflow/run_definition_pb";
import {
  getAioneExternalRunDetails,
  type AioneExternalType,
  type FlyteRunIdentifier,
} from "@/server/aione/external-api";
import { statusError } from "@/server/http/response";
import {
  getHawkRunMetricSeries,
  type HawkRawMetricSeries,
  type HawkRunMetricSeriesResult,
  type HawkRunMetricsDependencies,
  type HawkRunMetricsParams,
  type HawkRunMetricsTarget,
  type MetricKey,
} from "@/server/hawk/run-metrics";

export type AioneMonitorMode = "cpu" | "memory" | "gpu";

export type AioneMonitorQuery = {
  modes: AioneMonitorMode[];
  periodSeconds: number;
};

type AioneGpuMonitorValue = {
  gpu?: number;
  vram?: number;
};

export type AioneMonitorPoint = {
  time: string;
  cpu?: number;
  memory?: number;
} & Record<string, string | number | AioneGpuMonitorValue | undefined>;

type ActionDetailsForMonitor = {
  id?: {
    name?: string;
  };
};

type AioneRunDetailsForMonitor = {
  runId: FlyteRunIdentifier;
  details?: {
    action?: ActionDetailsForMonitor;
  };
};

type HawkRunMetricSeriesForMonitor = Pick<
  HawkRunMetricSeriesResult,
  "targets" | "metrics"
>;

export type AioneMonitorDependencies = {
  nowSeconds?: () => number;
  getAioneExternalRunDetails?: (
    type: AioneExternalType,
    sourceId: string,
  ) => Promise<AioneRunDetailsForMonitor>;
  getHawkRunMetricSeries?: (
    params: HawkRunMetricsParams,
    metricKeys: MetricKey[],
    dependencies?: HawkRunMetricsDependencies,
  ) => Promise<HawkRunMetricSeriesForMonitor>;
};

const ALLOWED_MONITOR_MODES = new Set<AioneMonitorMode>([
  "cpu",
  "memory",
  "gpu",
]);
const MAX_PERIOD_SECONDS = 24 * 60 * 60;

export function parseAioneMonitorQuery(
  searchParams: URLSearchParams,
): AioneMonitorQuery {
  return {
    modes: parseMonitorModes(searchParams),
    periodSeconds: parseMonitorPeriodSeconds(searchParams),
  };
}

export async function getAioneExternalMonitor(
  type: AioneExternalType,
  sourceId: string,
  query: AioneMonitorQuery,
  dependencies: AioneMonitorDependencies = {},
): Promise<AioneMonitorPoint[]> {
  const resolveRunDetails: NonNullable<
    AioneMonitorDependencies["getAioneExternalRunDetails"]
  > = dependencies.getAioneExternalRunDetails ?? getAioneExternalRunDetails;
  const queryMetricSeries: NonNullable<
    AioneMonitorDependencies["getHawkRunMetricSeries"]
  > = dependencies.getHawkRunMetricSeries ?? getHawkRunMetricSeries;
  const nowSeconds =
    dependencies.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  const { runId, details } = await resolveRunDetails(type, sourceId);
  const action = details?.action;
  const actionId = action?.id?.name?.trim();
  if (!actionId) {
    throw statusError("run action not found", 404);
  }

  const end = nowSeconds();
  const params: HawkRunMetricsParams = {
    org: runId.org,
    project: runId.project,
    domain: runId.domain,
    runId: runId.name,
    actionId,
    start: end - query.periodSeconds,
    end,
    step: resolveMonitorStepSeconds(query.periodSeconds),
  };
  const result = await queryMetricSeries(
    params,
    metricKeysForModes(query.modes),
    {
      getActionDetails: async () =>
        action as unknown as ActionDetails | undefined,
    },
  );

  return buildMonitorPoints(result, query.modes);
}

function parseMonitorModes(searchParams: URLSearchParams) {
  const values = searchParams.getAll("mode");
  if (values.length !== 1) {
    throw invalidMonitorModeError();
  }

  const modes: AioneMonitorMode[] = [];
  for (const part of values[0].split(",")) {
    const mode = part.trim() as AioneMonitorMode;
    if (!ALLOWED_MONITOR_MODES.has(mode)) {
      throw invalidMonitorModeError();
    }
    if (!modes.includes(mode)) {
      modes.push(mode);
    }
  }
  if (modes.length === 0) {
    throw invalidMonitorModeError();
  }
  return modes;
}

function parseMonitorPeriodSeconds(searchParams: URLSearchParams) {
  const values = searchParams.getAll("period");
  if (values.length !== 1 || values[0].includes(",")) {
    throw invalidMonitorPeriodError();
  }
  const match = /^([1-9]\d*)(m|h)$/.exec(values[0].trim());
  if (!match) {
    throw invalidMonitorPeriodError();
  }

  const amount = Number(match[1]);
  const seconds = amount * (match[2] === "h" ? 60 * 60 : 60);
  if (!Number.isFinite(seconds) || seconds > MAX_PERIOD_SECONDS) {
    throw statusError("period must be no more than 24h", 400);
  }
  return seconds;
}

function invalidMonitorModeError() {
  return statusError("mode must contain only cpu, memory, or gpu", 400);
}

function invalidMonitorPeriodError() {
  return statusError("period must be a single duration like 5m or 1h", 400);
}

function resolveMonitorStepSeconds(periodSeconds: number) {
  if (periodSeconds <= 60 * 60) {
    return 60;
  }
  if (periodSeconds <= 6 * 60 * 60) {
    return 300;
  }
  return 900;
}

function metricKeysForModes(modes: AioneMonitorMode[]) {
  const keys: MetricKey[] = [];
  if (modes.includes("cpu")) {
    keys.push("cpuUsage");
  }
  if (modes.includes("memory")) {
    keys.push("memoryRss");
  }
  if (modes.includes("gpu")) {
    keys.push("gpuUtilization", "gpuMemoryUsage");
  }
  return keys;
}

function buildMonitorPoints(
  result: HawkRunMetricSeriesForMonitor,
  modes: AioneMonitorMode[],
) {
  const rows = new Map<number, AioneMonitorPoint>();

  if (modes.includes("cpu")) {
    addRequestBasedPercentages({
      rows,
      field: "cpu",
      seriesList: result.metrics.cpuUsage ?? [],
      targets: result.targets,
      requestKind: "cpu",
    });
  }
  if (modes.includes("memory")) {
    addRequestBasedPercentages({
      rows,
      field: "memory",
      seriesList: result.metrics.memoryRss ?? [],
      targets: result.targets,
      requestKind: "memory",
    });
  }
  if (modes.includes("gpu")) {
    addGpuPercentages(rows, result.metrics.gpuUtilization ?? [], "gpu");
    addGpuPercentages(rows, result.metrics.gpuMemoryUsage ?? [], "vram");
  }

  return Array.from(rows.entries())
    .sort(([left], [right]) => left - right)
    .map(([, row]) => row);
}

function addRequestBasedPercentages({
  rows,
  field,
  seriesList,
  targets,
  requestKind,
}: {
  rows: Map<number, AioneMonitorPoint>;
  field: "cpu" | "memory";
  seriesList: HawkRawMetricSeries[];
  targets: HawkRunMetricsTarget[];
  requestKind: "cpu" | "memory";
}) {
  const accumulated = new Map<
    number,
    { usage: number; request: number; requestKeys: Set<string> }
  >();

  seriesList.forEach((series, index) => {
    const request = getTargetRequest(series, targets, requestKind);
    if (!request) {
      throw statusError(
        requestKind === "cpu"
          ? "CPU request is unavailable for monitor target"
          : "Memory request is unavailable for monitor target",
        502,
      );
    }
    const requestKey =
      series.metric.container_id?.trim() || `${requestKind}-series-${index}`;
    for (const point of series.points) {
      const current = accumulated.get(point.timestamp) ?? {
        usage: 0,
        request: 0,
        requestKeys: new Set<string>(),
      };
      current.usage += point.value;
      if (!current.requestKeys.has(requestKey)) {
        current.request += request;
        current.requestKeys.add(requestKey);
      }
      accumulated.set(point.timestamp, current);
    }
  });

  for (const [timestamp, value] of accumulated.entries()) {
    if (value.request <= 0) {
      continue;
    }
    getMonitorRow(rows, timestamp)[field] = roundPercent(
      (value.usage / value.request) * 100,
    );
  }
}

function getTargetRequest(
  series: HawkRawMetricSeries,
  targets: HawkRunMetricsTarget[],
  requestKind: "cpu" | "memory",
) {
  const containerId = series.metric.container_id?.trim();
  const target =
    targets.find((item) => item.containerId === containerId) ??
    (targets.length === 1 ? targets[0] : undefined);
  const request =
    requestKind === "cpu"
      ? target?.cpuRequestCores
      : target?.memoryRequestBytes;
  return Number.isFinite(request) && request !== undefined && request > 0
    ? request
    : undefined;
}

function addGpuPercentages(
  rows: Map<number, AioneMonitorPoint>,
  seriesList: HawkRawMetricSeries[],
  field: keyof AioneGpuMonitorValue,
) {
  const accumulated = new Map<
    string,
    { timestamp: number; gpuUuid: string; sum: number; count: number }
  >();

  for (const series of seriesList) {
    const gpuUuid = series.metric.gpu_uuid?.trim();
    if (!gpuUuid) {
      continue;
    }
    for (const point of series.points) {
      const key = `${point.timestamp}\t${gpuUuid}`;
      const current = accumulated.get(key) ?? {
        timestamp: point.timestamp,
        gpuUuid,
        sum: 0,
        count: 0,
      };
      current.sum += point.value;
      current.count += 1;
      accumulated.set(key, current);
    }
  }

  for (const value of accumulated.values()) {
    if (value.count === 0) {
      continue;
    }
    getGpuMonitorValue(getMonitorRow(rows, value.timestamp), value.gpuUuid)[
      field
    ] = roundPercent(value.sum / value.count);
  }
}

function getMonitorRow(
  rows: Map<number, AioneMonitorPoint>,
  timestamp: number,
) {
  const existing = rows.get(timestamp);
  if (existing) {
    return existing;
  }
  const row: AioneMonitorPoint = {
    time: new Date(timestamp * 1000).toISOString(),
  };
  rows.set(timestamp, row);
  return row;
}

function getGpuMonitorValue(row: AioneMonitorPoint, gpuUuid: string) {
  const field = gpuUuid;
  const current = row[field];
  if (isGpuMonitorValue(current)) {
    return current;
  }
  const created: AioneGpuMonitorValue = {};
  row[field] = created;
  return created;
}

function isGpuMonitorValue(value: unknown): value is AioneGpuMonitorValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundPercent(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
