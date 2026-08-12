import { NextResponse } from "next/server";
import { aioneOpenApi } from "@/lib/aione-openapi";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(aioneOpenApi, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
