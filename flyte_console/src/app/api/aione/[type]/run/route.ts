/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import {
  createAioneExternalRun,
  parseAioneExternalRunType,
} from "@/server/aione/external-api";
import { logAioneExternalApiRequest } from "@/server/aione/debug";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ type: string }> | { type: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { type } = await context.params;
    const externalType = parseAioneExternalRunType(type ?? "");
    const payload = await request.json();
    logAioneExternalApiRequest({
      request,
      type: externalType,
      payload,
    });
    const result = await createAioneExternalRun(externalType, payload);
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}
