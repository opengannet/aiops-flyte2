/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";
import { createLlmApiKey } from "@/server/llm/token";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ modelCode?: string[] }> | { modelCode?: string[] };
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    if (
      !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
    ) {
      throw statusError("unauthorized", 401);
    }
    const { modelCode } = await context.params;
    const model = (modelCode ?? []).join("/");
    const result = await createLlmApiKey({ model });
    return okEnvelope(result.key);
  } catch (error) {
    return errorEnvelope(error);
  }
}
