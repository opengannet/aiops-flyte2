/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { createAioneExternalRun } from "@/server/aione/external-api";
import { logAioneExternalApiRequest } from "@/server/aione/debug";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }> | { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { id } = await context.params;
    const modelID = id.trim();
    if (!modelID) {
      throw statusError("model id is required", 400);
    }

    const payload = await request.json();
    const modelPayload = withModelRouteID(payload, modelID);
    logAioneExternalApiRequest({
      request,
      type: "model",
      payload: modelPayload,
    });
    return okEnvelope(
      modelRunResponse(await createAioneExternalRun("model", modelPayload)),
    );
  } catch (error) {
    return errorEnvelope(error);
  }
}

function withModelRouteID(payload: unknown, modelID: string) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw statusError("request body must be an object", 400);
  }

  const bodyID = (payload as { id?: unknown }).id;
  if (bodyID != null && typeof bodyID !== "string") {
    throw statusError("id must be a string", 400);
  }
  if (
    typeof bodyID === "string" &&
    bodyID.trim() &&
    bodyID.trim() !== modelID
  ) {
    throw statusError("model id must match the URL", 400);
  }

  return { ...payload, id: modelID };
}

function modelRunResponse(result: unknown) {
  const app = (result as {
    app?: { name?: string; code?: string; profile?: string; url?: string };
  }).app;
  return {
    name: app?.name ?? "",
    code: app?.code ?? "",
    profile: app?.profile ?? "",
    url: app?.url ?? "",
  };
}
