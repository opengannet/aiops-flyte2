/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import type { Timestamp } from "@/gen/google/protobuf/timestamp_pb";
import { timestampToMillis } from "@/lib/dateUtils";
import { useOrg } from "@/hooks/useOrg";
import { getConsoleApiPath } from "@/components/pages/DevelopmentInstances/utils";
import { TabSection } from "@/components/TabSection";
import type { RunDetailsPageParams } from "./types";
import { useSelectedActionId } from "./hooks/useSelectedItem";
import { useSelectedAttemptStore } from "./state/AttemptStore";
import type {
  HawkRunMetricSeries,
  HawkRunMetricsResult,
  HawkRunMetricsTarget,
} from "@/server/hawk/run-metrics";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type MetricKey = keyof HawkRunMetricsResult["metrics"];

type MetricCard = {
  key: MetricKey;
  label: string;
  color: string;
  unit: "cores" | "bytes" | "percent";
};

type MetricsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: HawkRunMetricsResult };

type HawkRunMetricsResponse = {
  status?: number;
  message?: string;
  error?: string;
  data?: HawkRunMetricsResult;
};

const metricCards: MetricCard[] = [
  {
    key: "cpuUsage",
    label: "CPU Usage",
    color: "#2563eb",
    unit: "cores",
  },
  {
    key: "memoryRss",
    label: "Memory Usage",
    color: "#059669",
    unit: "bytes",
  },
  {
    key: "gpuUtilization",
    label: "GPU Utilization",
    color: "#d97706",
    unit: "percent",
  },
  {
    key: "gpuMemoryUsage",
    label: "GPU Memory Usage",
    color: "#7c3aed",
    unit: "percent",
  },
];

const unsupportedMetricMessage = "当前 Hawk 未采集该指标";

export const RunMetricsTab = () => {
  const org = useOrg();
  const params = useParams<RunDetailsPageParams>();
  const selectedActionId = useSelectedActionId();
  const selectedAttempt = useSelectedAttemptStore((s) => s.selectedAttempt);
  const [state, setState] = useState<MetricsState>({ status: "idle" });

  const queryString = useMemo(() => {
    if (!selectedActionId) {
      return null;
    }
    const window = buildMetricsWindow(selectedAttempt?.phaseTransitions);
    const search = new URLSearchParams();
    search.set("org", org);
    search.set("project", params.project);
    search.set("domain", params.domain);
    search.set("runId", params.runId);
    search.set("actionId", selectedActionId);
    if (selectedAttempt?.attempt !== undefined) {
      search.set("attempt", String(selectedAttempt.attempt));
    }
    search.set("start", String(window.start));
    search.set("end", String(window.end));
    search.set("step", String(window.step));
    return search.toString();
  }, [
    org,
    params.domain,
    params.project,
    params.runId,
    selectedActionId,
    selectedAttempt?.attempt,
    selectedAttempt?.phaseTransitions,
  ]);

  useEffect(() => {
    if (!queryString) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    async function loadMetrics() {
      try {
        const response = await fetch(
          getConsoleApiPath(`/api/hawk/run-metrics?${queryString}`),
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = (await response.json()) as HawkRunMetricsResponse;
        if (!response.ok || !body.data) {
          throw new Error(
            body.message || body.error || "Failed to load Hawk metrics.",
          );
        }
        setState({ status: "success", data: body.data });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load Hawk metrics.",
        });
      }
    }

    loadMetrics();

    return () => controller.abort();
  }, [queryString]);

  if (!selectedActionId) {
    return (
      <div className="flex h-full flex-col gap-5 p-8 pt-0">
        <TabSection heading="Run Metrics">
          <EmptyPanel message="Select an action to view metrics." />
        </TabSection>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-1 gap-5 p-8 pt-0 xl:grid-cols-2">
      {metricCards.map((card) => (
        <TabSection key={card.key} heading={card.label}>
          <MetricPanel card={card} state={state} />
        </TabSection>
      ))}
      <TabSection heading="SM Active Cycles">
        <MetricFrame latest="Unavailable">
          <EmptyPanel message={unsupportedMetricMessage} />
        </MetricFrame>
      </TabSection>
      <TabSection heading="SM Occupancy">
        <MetricFrame latest="Unavailable">
          <EmptyPanel message={unsupportedMetricMessage} />
        </MetricFrame>
      </TabSection>
    </div>
  );
};

function MetricPanel({
  card,
  state,
}: {
  card: MetricCard;
  state: MetricsState;
}) {
  if (state.status === "loading") {
    return (
      <MetricFrame latest="Loading">
        <EmptyPanel message="Loading Hawk metrics..." />
      </MetricFrame>
    );
  }

  if (state.status === "error") {
    return (
      <MetricFrame latest="Error">
        <EmptyPanel message={state.message} />
      </MetricFrame>
    );
  }

  if (state.status !== "success") {
    return (
      <MetricFrame latest="Waiting">
        <EmptyPanel message="Metrics are not ready yet." />
      </MetricFrame>
    );
  }

  const metric = state.data.metrics[card.key];
  const points = metric.points;
  const latestPoint = points.at(-1);
  const referenceValue = getReferenceValue(card.key, state.data.targets);

  if (!points.length || !latestPoint) {
    return (
      <MetricFrame latest="No samples">
        <EmptyPanel message={metric.emptyReason || "No samples available."} />
      </MetricFrame>
    );
  }

  const chartData = points.map((point) => ({
    time: point.timestamp,
    value: point.value,
  }));

  return (
    <MetricFrame
      latest={formatMetricValue(latestPoint.value, card.unit)}
      reference={
        referenceValue === undefined
          ? undefined
          : `Request ${formatMetricValue(referenceValue, card.unit)}`
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 12, right: 18, bottom: 4, left: 0 }}
        >
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            tickFormatter={formatTickTime}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(value) => formatAxisValue(Number(value), card.unit)}
            tickLine={false}
            axisLine={false}
            width={70}
          />
          <Tooltip
            formatter={(value) => [
              formatMetricValue(Number(value), card.unit),
              metric.label,
            ]}
            labelFormatter={(value) => formatTickTime(Number(value))}
          />
          {referenceValue !== undefined && (
            <ReferenceLine
              y={referenceValue}
              stroke="#94a3b8"
              strokeDasharray="4 4"
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={card.color}
            strokeWidth={2}
            dot={points.length <= 1 ? { r: 2 } : false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </MetricFrame>
  );
}

function MetricFrame({
  children,
  latest,
  reference,
}: {
  children: ReactNode;
  latest: string;
  reference?: string;
}) {
  return (
    <div
      className="flex flex-col gap-3 bg-white p-4 text-gray-900"
      style={{ minHeight: 230 }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase text-gray-500">
            Latest
          </div>
          <div className="text-lg font-semibold leading-6">{latest}</div>
        </div>
        {reference ? (
          <div className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
            {reference}
          </div>
        ) : null}
      </div>
      <div className="min-h-0" style={{ height: 150 }}>
        {children}
      </div>
    </div>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div
      className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500"
      style={{ minHeight: 150 }}
    >
      {message}
    </div>
  );
}

function buildMetricsWindow(
  phaseTransitions:
    { startTime?: Timestamp; endTime?: Timestamp }[] | undefined,
) {
  const timestamps =
    phaseTransitions
      ?.flatMap((transition) => [
        timestampToSeconds(transition.startTime),
        timestampToSeconds(transition.endTime),
      ])
      .filter((value): value is number => value !== undefined) ?? [];

  if (!timestamps.length) {
    const end = Math.floor(Date.now() / 1000);
    return { start: end - 30 * 60, end, step: 60 };
  }

  const start = Math.max(0, Math.min(...timestamps) - 30);
  const end = Math.max(...timestamps) + 30;
  return {
    start,
    end: end > start ? end : start + 60,
    step: pickStep(end - start),
  };
}

function timestampToSeconds(timestamp?: Timestamp) {
  const millis = timestampToMillis(timestamp);
  return millis === undefined ? undefined : Math.floor(millis / 1000);
}

function pickStep(durationSeconds: number) {
  if (durationSeconds <= 2 * 60 * 60) {
    return 60;
  }
  if (durationSeconds <= 12 * 60 * 60) {
    return 300;
  }
  return 600;
}

function getReferenceValue(key: MetricKey, targets: HawkRunMetricsTarget[]) {
  if (key === "cpuUsage") {
    const values = targets
      .map((target) => target.cpuRequestCores)
      .filter((value): value is number => value !== undefined);
    return values.length ? sum(values) : undefined;
  }
  if (key === "memoryRss") {
    const values = targets
      .map((target) => target.memoryRequestBytes)
      .filter((value): value is number => value !== undefined);
    return values.length ? sum(values) : undefined;
  }
  return undefined;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function formatMetricValue(value: number, unit: MetricCard["unit"]) {
  if (unit === "bytes") {
    return formatBytes(value);
  }
  if (unit === "percent") {
    return `${value.toFixed(2)}%`;
  }
  return `${value.toFixed(2)} cores`;
}

function formatAxisValue(value: number, unit: MetricCard["unit"]) {
  if (unit === "bytes") {
    return formatCompactBytes(value);
  }
  if (unit === "percent") {
    return `${value.toFixed(0)}%`;
  }
  return value.toFixed(value < 10 ? 1 : 0);
}

function formatBytes(value: number) {
  const mib = value / 1024 / 1024;
  if (mib < 1024) {
    return `${mib.toFixed(2)} MiB`;
  }
  return `${(mib / 1024).toFixed(2)} GiB`;
}

function formatCompactBytes(value: number) {
  const mib = value / 1024 / 1024;
  if (mib < 1024) {
    return `${mib.toFixed(0)} MiB`;
  }
  return `${(mib / 1024).toFixed(1)} GiB`;
}

function formatTickTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
