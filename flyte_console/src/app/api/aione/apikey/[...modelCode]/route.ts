/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { errorEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ modelCode?: string[] }> | { modelCode?: string[] };
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }
  const { modelCode } = await context.params;
  const model = (modelCode ?? []).join("/").trim();
  const publicURL =
    process.env.AIONE_PUBLIC_URL?.trim().replace(/\/$/, "") ?? "";
  const migrationURL = publicURL
    ? `${publicURL}/models/deployments${model ? `?model=${encodeURIComponent(model)}` : ""}`
    : "/models/deployments";
  return errorEnvelope(
    statusError(`model API key creation moved to ${migrationURL}`, 410),
  );
}
