import { NextRequest } from "next/server";

import { parseAioneExternalType } from "@/server/aione/external-api";
import { authenticateAioneRequest } from "@/server/aione/helpers";
import {
  getAioneExternalMonitor,
  parseAioneMonitorQuery,
} from "@/server/aione/monitor";
import { errorEnvelope, okEnvelope, statusError } from "@/server/http/response";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ type: string; id: string }> | { type: string; id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (
    !authenticateAioneRequest(request.headers, process.env.EXTERNAL_API_KEYS)
  ) {
    return errorEnvelope(statusError("unauthorized", 401));
  }

  try {
    const { type, id } = await context.params;
    const result = await getAioneExternalMonitor(
      parseAioneExternalType(type ?? ""),
      decodeURIComponent(id ?? ""),
      parseAioneMonitorQuery(request.nextUrl.searchParams),
    );
    return okEnvelope(result);
  } catch (error) {
    return errorEnvelope(error);
  }
}
