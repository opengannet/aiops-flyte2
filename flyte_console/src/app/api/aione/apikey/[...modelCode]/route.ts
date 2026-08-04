/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { createLlmApiKey } from "@/server/llm/token";
import { errorEnvelope, okEnvelope } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params:
    | Promise<{ modelCode?: string[] }>
    | { modelCode?: string[] };
};

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { modelCode } = await context.params;
    const model = (modelCode ?? []).join("/");
    const result = await createLlmApiKey({ model });
    return okEnvelope(result.key);
  } catch (error) {
    return errorEnvelope(error);
  }
}
