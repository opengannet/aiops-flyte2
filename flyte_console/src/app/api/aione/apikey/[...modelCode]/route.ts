/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { createLlmApiKey } from "@/server/llm/token";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

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
  try {
    const { modelCode } = await context.params;
    const model = (modelCode ?? []).join("/");
    const result = await createLlmApiKey({ model });
    return okEnvelope(result.key);
  } catch (error) {
    return errorEnvelope(error);
  }
}
