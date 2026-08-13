/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import {
  parseAioneExternalType,
  stopAioneExternalRun,
} from "@/server/aione/external-api";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ type: string; id: string }> | { type: string; id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { type, id } = await context.params;
    const externalType = parseAioneExternalType(type ?? "");
    const project = request.nextUrl.searchParams.get("project")?.trim();
    const domain = request.nextUrl.searchParams.get("domain")?.trim();
    const result = await stopAioneExternalRun(
      externalType,
      decodeURIComponent(id ?? ""),
      externalType === "model" && project && domain
        ? { project, domain }
        : undefined,
    );
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}
