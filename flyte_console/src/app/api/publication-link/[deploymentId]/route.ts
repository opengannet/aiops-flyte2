/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest, NextResponse } from "next/server";
import { errorEnvelope, statusError } from "@/server/http/response";

type RouteContext = {
  params: Promise<{ deploymentId: string }> | { deploymentId: string };
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const publicURL = process.env.AIONE_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (!publicURL) {
    return errorEnvelope(
      statusError("AIONE_PUBLIC_URL is not configured", 503),
    );
  }
  const { deploymentId } = await context.params;
  const target = new URL("/models/deployments", publicURL);
  target.searchParams.set("deployment", deploymentId.trim());
  return NextResponse.redirect(target);
}
