import { statusError } from "@/server/http/response";

export type HawkMetricPoint = {
  timestamp: number;
  value: number;
};

export type HawkPrometheusSeries = {
  metric?: Record<string, string>;
  values?: Array<[number | string, string]>;
};

export type HawkPrometheusMatrixData = {
  resultType?: string;
  result?: HawkPrometheusSeries[];
};

export type HawkQueryRangeInput = {
  query: string;
  start: number;
  end: number;
  step: number;
  signal?: AbortSignal;
};

export async function queryHawkRange({
  query,
  start,
  end,
  step,
  signal,
}: HawkQueryRangeInput): Promise<HawkPrometheusMatrixData> {
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
    signal,
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

export function escapePrometheusLabelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

type PrometheusQueryRangeResponse = {
  status?: string;
  error?: string;
  data?: HawkPrometheusMatrixData;
};
