/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import { getAioneExternalContext } from "@/server/aione/external-api";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }
  try {
    const params = request.nextUrl.searchParams;
    return okEnvelope(
      getAioneExternalContext(
        params.get("project") ?? "",
        params.get("domain") ?? "",
      ),
    );
  } catch (error) {
    return errorEnvelope(error);
  }
}
