import { LogLineOriginator } from "@/gen/flyteidl2/logs/dataplane/payload_pb";
import type { ActionAttempt } from "@/gen/flyteidl2/workflow/run_definition_pb";
import { isAttemptTerminal } from "@/lib/attemptUtils";
import { statusError } from "@/server/http/response";
import {
  getRunActionDetails,
  getSelectedAttempt,
  resolveRunTargets,
  type HawkRunTarget,
  type HawkRunTargetDependencies,
  type HawkRunTargetParams,
} from "@/server/hawk/run-targets";

const DEFAULT_LOG_WINDOW_SECONDS = 30 * 60;
const LOG_WINDOW_PADDING_SECONDS = 30;
const DEFAULT_LOG_LIMIT = 5000;

export type HawkRunLogsParams = HawkRunTargetParams & {
  start?: number;
  end?: number;
  limit?: number;
};

export type HawkRunLogLine = {
  timestamp?: {
    seconds: number;
    nanos: number;
  };
  message: string;
  originator: LogLineOriginator;
};

export type HawkRunLogsResult = {
  start: number;
  end: number;
  limit: number;
  targets: HawkRunTarget[];
  lines: HawkRunLogLine[];
};

export type HawkRunLogsDependencies = HawkRunTargetDependencies & {
  queryHawkLogs?: (input: {
    containerIds: string[];
    start: number;
    end: number;
    limit: number;
  }) => Promise<HawkApiLogsResponse>;
};

export async function getHawkRunLogs(
  params: HawkRunLogsParams,
  dependencies: HawkRunLogsDependencies = {},
): Promise<HawkRunLogsResult> {
  const getActionDetails = dependencies.getActionDetails ?? getRunActionDetails;
  const actionDetails = await getActionDetails(params);
  const selectedAttempt = getSelectedAttempt(actionDetails, params.attempt);
  const window = buildLogsWindow(params, selectedAttempt);
  const targets = await resolveRunTargets(
    params,
    {
      getActionDetails: async () => actionDetails,
      listPods: dependencies.listPods,
      getPod: dependencies.getPod,
    },
    { includePodRequests: false },
  );
  const limit = params.limit ?? DEFAULT_LOG_LIMIT;

  if (targets.length === 0) {
    return { ...window, limit, targets, lines: [] };
  }

  const queryHawkLogs = dependencies.queryHawkLogs ?? queryHawkApiLogs;
  const response = await queryHawkLogs({
    containerIds: targets.map((target) => target.containerId),
    start: window.start,
    end: window.end,
    limit,
  });

  return {
    ...window,
    limit: response.limit || limit,
    targets,
    lines: entriesToLogLines(response.entries ?? []),
  };
}

function buildLogsWindow(
  params: HawkRunLogsParams,
  attempt: ActionAttempt | undefined,
) {
  if (params.start !== undefined && params.end !== undefined) {
    return { start: params.start, end: params.end };
  }

  const derived = deriveAttemptWindow(attempt);
  const now = nowSeconds();
  const shouldUseLiveEnd = shouldUseLiveLogEnd(attempt, derived.end);
  const rawEnd =
    params.end ??
    (shouldUseLiveEnd ? now : undefined) ??
    derived.end ??
    now;
  const rawStart =
    params.start ?? derived.start ?? rawEnd - DEFAULT_LOG_WINDOW_SECONDS;

  const shouldPadStart = params.start === undefined;
  const shouldPadEnd =
    params.end === undefined && !shouldUseLiveEnd && derived.end !== undefined;
  const start = Math.max(
    0,
    rawStart - (shouldPadStart ? LOG_WINDOW_PADDING_SECONDS : 0),
  );
  const end = Math.max(
    start + 1,
    rawEnd + (shouldPadEnd ? LOG_WINDOW_PADDING_SECONDS : 0),
  );
  return { start, end };
}

function shouldUseLiveLogEnd(
  attempt: ActionAttempt | undefined,
  derivedEnd: number | undefined,
) {
  if (!attempt || isAttemptTerminal(attempt) || attempt.endTime) {
    return false;
  }
  return derivedEnd === undefined || hasOpenPhaseTransition(attempt);
}

function deriveAttemptWindow(attempt: ActionAttempt | undefined) {
  const start =
    timestampToSeconds(attempt?.startTime) ??
    minDefined(
      attempt?.phaseTransitions?.flatMap((transition) => [
        timestampToSeconds(transition.startTime),
        timestampToSeconds(transition.endTime),
      ]) ?? [],
    );
  const end =
    timestampToSeconds(attempt?.endTime) ??
    maxDefined(
      attempt?.phaseTransitions?.flatMap((transition) => [
        timestampToSeconds(transition.startTime),
        timestampToSeconds(transition.endTime),
      ]) ?? [],
    );
  return { start, end };
}

function hasOpenPhaseTransition(attempt: ActionAttempt) {
  return (
    attempt.phaseTransitions?.some(
      (transition) =>
        timestampToSeconds(transition.startTime) !== undefined &&
        timestampToSeconds(transition.endTime) === undefined,
    ) ?? false
  );
}

function entriesToLogLines(entries: HawkApiLogEntry[]) {
  const deduped = new Map<string, HawkRunLogLine>();
  for (const entry of entries) {
    const line = {
      timestamp: millisToTimestamp(entry.timestamp),
      message: entry.message ?? "",
      originator: LogLineOriginator.USER,
    };
    deduped.set(logLineKey(line), line);
  }
  return Array.from(deduped.values()).sort(
    (a, b) => timestampMillis(a.timestamp) - timestampMillis(b.timestamp),
  );
}

function millisToTimestamp(milliseconds: number | undefined) {
  if (!Number.isFinite(milliseconds)) {
    return undefined;
  }
  const millis = Number(milliseconds);
  return {
    seconds: Math.floor(millis / 1000),
    nanos: (millis % 1000) * 1_000_000,
  };
}

function timestampMillis(timestamp: HawkRunLogLine["timestamp"]) {
  if (!timestamp) {
    return 0;
  }
  return timestamp.seconds * 1000 + Math.floor(timestamp.nanos / 1_000_000);
}

function logLineKey(line: HawkRunLogLine) {
  return `${timestampMillis(line.timestamp)}\u0000${line.originator}\u0000${line.message}`;
}

function timestampToSeconds(timestamp?: {
  seconds?: bigint | number;
  nanos?: number;
}) {
  if (timestamp?.seconds === undefined) {
    return undefined;
  }
  const seconds = Number(timestamp.seconds);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }
  return Math.floor(seconds + (timestamp.nanos ?? 0) / 1_000_000_000);
}

function minDefined(values: Array<number | undefined>) {
  const defined = values.filter(
    (value): value is number => value !== undefined,
  );
  return defined.length ? Math.min(...defined) : undefined;
}

function maxDefined(values: Array<number | undefined>) {
  const defined = values.filter(
    (value): value is number => value !== undefined,
  );
  return defined.length ? Math.max(...defined) : undefined;
}

async function queryHawkApiLogs({
  containerIds,
  start,
  end,
  limit,
}: {
  containerIds: string[];
  start: number;
  end: number;
  limit: number;
}): Promise<HawkApiLogsResponse> {
  const hawkUrl = process.env.HAWK_API_URL?.trim();
  const apiKey = process.env.HAWK_API_KEY?.trim();
  if (!hawkUrl) {
    throw statusError("HAWK_API_URL is not configured", 503);
  }
  if (!apiKey) {
    throw statusError("HAWK_API_KEY is not configured", 503);
  }

  const url = new URL("/api/v1/logs", trimTrailingSlash(hawkUrl));
  for (const containerId of containerIds) {
    url.searchParams.append("container_id", containerId);
  }
  url.searchParams.set("from", String(start * 1000));
  url.searchParams.set("to", String(end * 1000));
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) {
    throw statusError(
      `Hawk logs query failed with HTTP ${response.status}`,
      502,
    );
  }
  return (await response.json()) as HawkApiLogsResponse;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

type HawkApiLogsResponse = {
  entries?: HawkApiLogEntry[];
  limit?: number;
};

type HawkApiLogEntry = {
  timestamp?: number;
  message?: string;
  severity?: string;
  attributes?: Record<string, string>;
  trace_id?: string;
  cluster?: string;
};
