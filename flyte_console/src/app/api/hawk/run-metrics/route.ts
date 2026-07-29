import { NextRequest } from "next/server";

import {
  getHawkRunMetrics,
  type HawkRunMetricsParams,
} from "@/server/hawk/run-metrics";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

const DEFAULT_WINDOW_SECONDS = 30 * 60;
const DEFAULT_STEP_SECONDS = 60;

export async function GET(request: NextRequest) {
  try {
    const result = await getHawkRunMetrics(parseRunMetricsParams(request));
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}

function parseRunMetricsParams(request: NextRequest): HawkRunMetricsParams {
  const searchParams = request.nextUrl.searchParams;
  const end =
    parseOptionalPositiveInteger(searchParams.get("end"), "end") ??
    nowSeconds();
  const start =
    parseOptionalNonNegativeInteger(searchParams.get("start"), "start") ??
    end - DEFAULT_WINDOW_SECONDS;
  const step =
    parseOptionalPositiveInteger(searchParams.get("step"), "step") ??
    DEFAULT_STEP_SECONDS;
  const attempt = parseOptionalNonNegativeInteger(
    searchParams.get("attempt"),
    "attempt",
  );
  if (end <= start) {
    throw statusError("end must be greater than start", 400);
  }

  return {
    org: requiredParam(searchParams, "org"),
    project: requiredParam(searchParams, "project"),
    domain: requiredParam(searchParams, "domain"),
    runId: requiredParam(searchParams, "runId"),
    actionId: requiredParam(searchParams, "actionId"),
    attempt,
    start,
    end,
    step,
  };
}

function requiredParam(searchParams: URLSearchParams, name: string) {
  const value = searchParams.get(name)?.trim() ?? "";
  if (!value) {
    throw statusError(`${name} is required`, 400);
  }
  return value;
}

function parseOptionalPositiveInteger(rawValue: string | null, field: string) {
  const value = rawValue?.trim();
  if (!value) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw statusError(`${field} must be a positive integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw statusError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(
  rawValue: string | null,
  field: string,
) {
  const value = rawValue?.trim();
  if (!value) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw statusError(`${field} must be a non-negative integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw statusError(`${field} must be a non-negative integer`, 400);
  }
  return parsed;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
