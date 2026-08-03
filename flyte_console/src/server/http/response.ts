/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { Code, ConnectError } from "@connectrpc/connect";
import { NextResponse } from "next/server";

export function okEnvelope<T>(data: T, status = 200) {
  return NextResponse.json({ status, data }, { status });
}

export function errorEnvelope(error: unknown) {
  const status = errorStatus(error);
  return NextResponse.json(
    {
      status,
      message: error instanceof Error ? error.message : String(error),
    },
    { status },
  );
}

export function statusError(message: string, status: number) {
  return new ResponseStatusError(message, status);
}

export function makeJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (typeof nested !== "bigint") {
        return nested;
      }
      const asNumber = Number(nested);
      return Number.isSafeInteger(asNumber) ? asNumber : nested.toString();
    }),
  ) as T;
}

function errorStatus(error: unknown) {
  if (error instanceof ResponseStatusError) {
    return error.status;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  if (error instanceof ConnectError) {
    if (error.code === Code.NotFound) {
      return 404;
    }
    return error.code === Code.InvalidArgument ? 400 : 502;
  }
  return 400;
}

class ResponseStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
