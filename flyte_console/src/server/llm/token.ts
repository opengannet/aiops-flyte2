/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { randomUUID } from "node:crypto";
import { statusError } from "@/server/http/response";

const DEFAULT_LLM_KEYS_API_ORIGIN = "https://llm.ops.fzyun.io";
const REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = typeof fetch;

type CreateLlmApiKeyInput = {
  model: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  nameFactory?: (model: string, now: Date) => string;
  idempotencyKeyFactory?: () => string;
  timeoutMs?: number;
};

export type LlmApiKeyRequest = {
  model: string;
};

export type CreatedLlmApiKey = {
  model: string;
  name: string;
  key: string;
};

type NewApiEnvelope = {
  success?: boolean;
  data?: {
    id?: number;
    key?: string;
    name?: string;
    model_code?: string;
    created?: boolean;
  };
};

class UpstreamRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function parseLlmApiKeyRequest(value: unknown): LlmApiKeyRequest {
  if (!isRecord(value)) {
    throw statusError("request body must be a JSON object", 400);
  }
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (!model) {
    throw statusError("model is required", 400);
  }
  if (/[,\u0000-\u001f\u007f]/.test(model)) {
    throw statusError("model must be a single model identifier", 400);
  }
  return { model };
}

export function buildLlmTokenName(
  model: string,
  now = new Date(),
  random = Math.random,
) {
  const timestamp = Math.floor(now.getTime() / 1000).toString(36);
  const suffix = random().toString(36).slice(2, 8) || "0";
  return `flyte-${shortHash(model)}-${timestamp}-${suffix}`.slice(0, 50);
}

export async function createLlmApiKey({
  model,
  fetchImpl = fetch,
  now = () => new Date(),
  nameFactory = buildLlmTokenName,
  idempotencyKeyFactory = randomUUID,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: CreateLlmApiKeyInput): Promise<CreatedLlmApiKey> {
  const parsed = parseLlmApiKeyRequest({ model });
  const origin = getLlmKeysApiOrigin();
  const managementToken = getLlmKeysApiToken();
  const name = nameFactory(parsed.model, now()).trim();
  if (!name || name.length > 50) {
    throw statusError("generated API key name is invalid", 502);
  }
  const idempotencyKey = idempotencyKeyFactory().trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw statusError("generated idempotency key is invalid", 502);
  }

  const body = JSON.stringify({
    model_code: parsed.model,
    name,
    idempotency_key: idempotencyKey,
  });
  let lastError: UpstreamRequestError | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await requestPublicationKey(
        fetchImpl,
        `${origin}/api/token/flyte-publication`,
        managementToken,
        body,
        timeoutMs,
      );
      if (
        response.data?.name !== name ||
        response.data.model_code !== parsed.model
      ) {
        throw new UpstreamRequestError(
          "LLM token service returned an invalid success response",
          502,
          true,
        );
      }
      const rawKey = response.data?.key?.trim() ?? "";
      return {
        model: parsed.model,
        name,
        key: rawKey.startsWith("sk-") ? rawKey : `sk-${rawKey}`,
      };
    } catch (error) {
      if (!(error instanceof UpstreamRequestError)) {
        throw statusError("LLM token service request failed", 502);
      }
      lastError = error;
      if (!error.retryable || attempt === 1) {
        break;
      }
    }
  }
  throw statusError(
    lastError?.message ?? "LLM token service request failed",
    lastError?.status ?? 502,
  );
}

async function requestPublicationKey(
  fetchImpl: FetchLike,
  url: string,
  managementToken: string,
  body: string,
  timeoutMs: number,
): Promise<NewApiEnvelope> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${managementToken}`,
        "content-type": "application/json",
      },
      body,
      signal: controller.signal,
    });
  } catch {
    throw new UpstreamRequestError(
      "LLM token service request failed",
      502,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const status =
      response.status === 404 || response.status === 409
        ? response.status
        : 502;
    throw new UpstreamRequestError(
      response.status === 404
        ? "model publication not found"
        : response.status === 409
          ? "model publication cleanup is pending"
          : "LLM token service rejected the request",
      status,
      response.status >= 500,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new UpstreamRequestError(
      "LLM token service returned an invalid success response",
      502,
      true,
    );
  }
  let envelope: NewApiEnvelope;
  try {
    envelope = (await response.json()) as NewApiEnvelope;
  } catch {
    throw new UpstreamRequestError(
      "LLM token service returned an invalid success response",
      502,
      true,
    );
  }
  if (envelope.success !== true) {
    throw new UpstreamRequestError(
      "LLM token service rejected the request",
      502,
      false,
    );
  }
  if (
    !envelope.data ||
    typeof envelope.data.id !== "number" ||
    typeof envelope.data.key !== "string" ||
    !envelope.data.key.trim() ||
    typeof envelope.data.name !== "string" ||
    typeof envelope.data.model_code !== "string" ||
    typeof envelope.data.created !== "boolean"
  ) {
    throw new UpstreamRequestError(
      "LLM token service returned an invalid success response",
      502,
      true,
    );
  }
  return envelope;
}

function getLlmKeysApiOrigin() {
  const origin =
    process.env.LLM_KEYS_API_ORIGIN?.trim() || DEFAULT_LLM_KEYS_API_ORIGIN;
  return origin.replace(/\/+$/g, "");
}

function getLlmKeysApiToken() {
  const token = process.env.LLM_KEYS_API_TOKEN?.trim() ?? "";
  if (!token) {
    throw statusError("LLM_KEYS_API_TOKEN is not configured", 503);
  }
  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
