import { NextRequest } from "next/server";

import { getHawkRunLogs, type HawkRunLogsParams } from "@/server/hawk/run-logs";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

const MAX_LOG_LIMIT = 10000;

export async function GET(request: NextRequest) {
  try {
    const result = await getHawkRunLogs(parseRunLogsParams(request));
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}

function parseRunLogsParams(request: NextRequest): HawkRunLogsParams {
  const searchParams = request.nextUrl.searchParams;
  const start = parseOptionalNonNegativeInteger(
    searchParams.get("start"),
    "start",
  );
  const end = parseOptionalPositiveInteger(searchParams.get("end"), "end");
  const attempt = parseOptionalNonNegativeInteger(
    searchParams.get("attempt"),
    "attempt",
  );
  if (start !== undefined && end !== undefined && end <= start) {
    throw statusError("end must be greater than start", 400);
  }
  const limit = parseOptionalBoundedInteger(
    searchParams.get("limit"),
    "limit",
    MAX_LOG_LIMIT,
  );

  return {
    org: requiredParam(searchParams, "org"),
    project: requiredParam(searchParams, "project"),
    domain: requiredParam(searchParams, "domain"),
    runId: requiredParam(searchParams, "runId"),
    actionId: requiredParam(searchParams, "actionId"),
    attempt,
    start,
    end,
    limit,
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

function parseOptionalBoundedInteger(
  rawValue: string | null,
  field: string,
  max: number,
) {
  const value = rawValue?.trim();
  if (!value) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw statusError(`${field} must be between 1 and ${max}`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw statusError(`${field} must be between 1 and ${max}`, 400);
  }
  return parsed;
}
