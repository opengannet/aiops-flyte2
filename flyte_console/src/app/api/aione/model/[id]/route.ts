/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import {
  createAioneExternalRun,
  deleteAioneModelApp,
  getAioneModelApp,
  updateAioneModelApp,
} from "@/server/aione/external-api";
import { logAioneExternalApiRequest } from "@/server/aione/debug";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context, (scope) => getAioneModelApp(scope));
}

// Next.js resolves /api/aione/model/run to this static `model/[id]` route
// before the legacy `[type]/run` route. Keep the existing public creation
// contract reachable by handling the reserved `run` id here as well.
export async function POST(request: NextRequest, context: RouteContext) {
  if (!authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)) {
    return errorEnvelope(statusError("unauthorized", 401));
  }
  try {
    const { id } = await context.params;
    if (decodeURIComponent(id ?? "") !== "run") {
      throw statusError("model action not found", 404);
    }
    const payload = await request.json();
    logAioneExternalApiRequest({ request, type: "model", payload });
    const result = await createAioneExternalRun("model", payload);
    return okEnvelope((result as { app?: unknown }).app ?? {});
  } catch (error) {
    return errorEnvelope(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return handle(request, context, async (scope) =>
    updateAioneModelApp(scope, await request.json()),
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context, (scope) => deleteAioneModelApp(scope));
}

async function handle(
  request: NextRequest,
  context: RouteContext,
  action: (scope: { id: string; project: string; domain: string }) => Promise<unknown>,
) {
  if (!authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)) {
    return errorEnvelope(statusError("unauthorized", 401));
  }
  try {
    const { id } = await context.params;
    return okEnvelope(
      await action({
        id: decodeURIComponent(id ?? ""),
        project: request.nextUrl.searchParams.get("project") ?? "",
        domain: request.nextUrl.searchParams.get("domain") ?? "",
      }),
    );
  } catch (error) {
    return errorEnvelope(error);
  }
}
