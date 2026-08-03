/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { createLlmApiKey, parseLlmTokenRequest } from "@/server/llm/token";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const parsed = parseLlmTokenRequest(await readJson(request));
    return okEnvelope(await createLlmApiKey(parsed));
  } catch (error) {
    return errorEnvelope(error);
  }
}

async function readJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw statusError("request body must be valid JSON", 400);
  }
}
