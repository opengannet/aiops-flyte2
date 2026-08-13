/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { startAioneModelApp } from "@/server/aione/external-api";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)) {
    return errorEnvelope(statusError("unauthorized", 401));
  }
  try {
    const { id } = await context.params;
    return okEnvelope(
      await startAioneModelApp({
        id: decodeURIComponent(id ?? ""),
        project: request.nextUrl.searchParams.get("project") ?? "",
        domain: request.nextUrl.searchParams.get("domain") ?? "",
      }),
    );
  } catch (error) {
    return errorEnvelope(error);
  }
}
