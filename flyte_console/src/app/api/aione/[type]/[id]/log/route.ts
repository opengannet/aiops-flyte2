/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import {
  getAioneExternalLogs,
  parseAioneExternalType,
} from "@/server/aione/external-api";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ type: string; id: string }> | { type: string; id: string };
};

const DEFAULT_LOG_PAGE = 1;
const DEFAULT_LOG_SIZE = 200;
const MAX_LOG_SIZE = 1000;

export async function GET(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { type, id } = await context.params;
    const externalType = parseAioneExternalType(type ?? "");
    const result = await getAioneExternalLogs(
      externalType,
      decodeURIComponent(id ?? ""),
      parseLogPagination(request.nextUrl.searchParams),
      externalType === "model" ? modelScope(request.nextUrl.searchParams) : undefined,
    );
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}

function modelScope(params: URLSearchParams) {
  const project = params.get("project")?.trim();
  const domain = params.get("domain")?.trim();
  return project && domain ? { project, domain } : undefined;
}

function parseLogPagination(searchParams: URLSearchParams) {
  const page = parsePositiveIntegerParam(
    searchParams.get("page"),
    DEFAULT_LOG_PAGE,
    "page",
  );
  const size = parsePositiveIntegerParam(
    searchParams.get("size"),
    DEFAULT_LOG_SIZE,
    "size",
  );
  if (size > MAX_LOG_SIZE) {
    throw statusError(`size must be between 1 and ${MAX_LOG_SIZE}`, 400);
  }
  return { page, size };
}

function parsePositiveIntegerParam(
  rawValue: string | null,
  fallback: number,
  field: "page" | "size",
) {
  const value = rawValue?.trim() || String(fallback);
  if (!/^\d+$/.test(value)) {
    throw statusError(`${field} must be a positive integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw statusError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}
