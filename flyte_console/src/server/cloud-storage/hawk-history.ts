import {
  escapePrometheusLabelValue,
  queryHawkRange,
  type HawkPrometheusMatrixData,
  type HawkQueryRangeInput,
} from "@/server/hawk/client";

const DEFAULT_HISTORY_DAYS = 30;
const MAX_HISTORY_DAYS = 90;
const WINDOW_SECONDS = 7 * 24 * 60 * 60;
const QUERY_STEP_SECONDS = 60;
const MAX_SAMPLE_SKEW_SECONDS = 120;
const DEFAULT_TIMEOUT_MS = 10_000;

export type HawkPvcHistory = {
  filesystemCapacityBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
  statsTime: string;
};

export type HawkPvcHistoryQuery = (
  input: HawkQueryRangeInput,
) => Promise<HawkPrometheusMatrixData>;

export async function loadHawkPvcHistory({
  volumeName,
  nowSeconds = Math.floor(Date.now() / 1000),
  historyDays = getHawkPvcHistoryDays(
    process.env.HAWK_PVC_HISTORY_DAYS,
  ),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  queryRange = queryHawkRange,
}: {
  volumeName: string;
  nowSeconds?: number;
  historyDays?: number;
  timeoutMs?: number;
  queryRange?: HawkPvcHistoryQuery;
}): Promise<HawkPvcHistory | null> {
  const normalizedVolumeName = volumeName.trim();
  if (!normalizedVolumeName) {
    return null;
  }

  const totalSeconds = historyDays * 24 * 60 * 60;
  const cutoff = nowSeconds - totalSeconds;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const query = buildPvcHistoryQuery(normalizedVolumeName);

  try {
    for (
      let offset = 0;
      offset < totalSeconds;
      offset += WINDOW_SECONDS
    ) {
      const start = Math.max(
        cutoff,
        nowSeconds - offset - WINDOW_SECONDS,
      );
      const end = Math.min(
        nowSeconds,
        nowSeconds -
          offset +
          (offset > 0 ? QUERY_STEP_SECONDS : 0),
      );
      const matrix = await queryRange({
        query,
        start,
        end,
        step: QUERY_STEP_SECONDS,
        signal: controller.signal,
      });
      const sample = findLatestCompleteSample(
        matrix,
        normalizedVolumeName,
      );
      if (sample) {
        return sample;
      }
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function getHawkPvcHistoryDays(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    return DEFAULT_HISTORY_DAYS;
  }
  const days = Number(value);
  return days >= 1 && days <= MAX_HISTORY_DAYS
    ? days
    : DEFAULT_HISTORY_DAYS;
}

function buildPvcHistoryQuery(volumeName: string) {
  return `{__name__=~"container_resources_disk_(size|used)_bytes",volume="${escapePrometheusLabelValue(volumeName)}"}`;
}

function findLatestCompleteSample(
  matrix: HawkPrometheusMatrixData,
  volumeName: string,
) {
  let latestSize: LatestValue | undefined;
  let latestUsed: LatestValue | undefined;

  for (const series of matrix.result ?? []) {
    if (series.metric?.volume !== volumeName) {
      continue;
    }
    const metricName = series.metric.__name__;
    if (
      metricName !== "container_resources_disk_size_bytes" &&
      metricName !== "container_resources_disk_used_bytes"
    ) {
      continue;
    }
    for (const [rawTimestamp, rawValue] of series.values ?? []) {
      const timestamp = Number(rawTimestamp);
      const value = Number(rawValue);
      if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
        continue;
      }
      if (metricName === "container_resources_disk_size_bytes") {
        latestSize = selectLatestValue(latestSize, { timestamp, value });
      } else {
        latestUsed = selectLatestValue(latestUsed, { timestamp, value });
      }
    }
  }

  if (
    !latestSize ||
    !latestUsed ||
    latestSize.value <= 0 ||
    latestUsed.value < 0 ||
    Math.abs(latestSize.timestamp - latestUsed.timestamp) >
      MAX_SAMPLE_SKEW_SECONDS
  ) {
    return null;
  }

  const availableBytes = Math.max(
    latestSize.value - latestUsed.value,
    0,
  );
  return {
    filesystemCapacityBytes: latestSize.value,
    usedBytes: latestUsed.value,
    availableBytes,
    usagePercent: roundPercent(
      (latestUsed.value / latestSize.value) * 100,
    ),
    statsTime: new Date(
      Math.min(latestSize.timestamp, latestUsed.timestamp) * 1000,
    ).toISOString(),
  };
}

function selectLatestValue(
  current: LatestValue | undefined,
  candidate: LatestValue,
) {
  if (
    !current ||
    candidate.timestamp > current.timestamp ||
    (candidate.timestamp === current.timestamp &&
      candidate.value > current.value)
  ) {
    return candidate;
  }
  return current;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

type LatestValue = {
  timestamp: number;
  value: number;
};
