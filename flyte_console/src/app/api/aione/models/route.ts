/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { listAioneModelApps } from "@/server/aione/external-api";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)) {
    return errorEnvelope(statusError("unauthorized", 401));
  }
  try {
    const params = request.nextUrl.searchParams;
    return okEnvelope(
      await listAioneModelApps({
        project: params.get("project") ?? "",
        domain: params.get("domain") ?? "",
        page: integerParam(params.get("p"), 1, "p"),
        pageSize: integerParam(params.get("page_size"), 20, "page_size"),
        keyword: params.get("keyword") ?? params.get("search") ?? "",
        status: params.get("status") ?? "",
      }),
    );
  } catch (error) {
    return errorEnvelope(error);
  }
}

function integerParam(value: string | null, fallback: number, field: string) {
  const raw = value?.trim() || String(fallback);
  if (!/^\d+$/.test(raw)) {
    throw statusError(`${field} must be a positive integer`, 400);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw statusError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}
