/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { statusError } from "@/server/http/response";

const DEFAULT_LLM_KEYS_API_ORIGIN = "https://llm.ops.fzyun.io";

type FetchLike = typeof fetch;

type CreateLlmApiKeyInput = {
  model: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  nameFactory?: (model: string, now: Date) => string;
};

export type LlmApiKeyRequest = {
  model: string;
};

export type CreatedLlmApiKey = {
  model: string;
  name: string;
  key: string;
};

type NewApiEnvelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type NewApiToken = {
  id?: number;
  name?: string;
};

type NewApiSearchData = {
  items?: NewApiToken[];
};

type NewApiTokenKeyData = {
  key?: string;
};

export function parseLlmApiKeyRequest(value: unknown): LlmApiKeyRequest {
  if (!isRecord(value)) {
    throw new Error("request body must be a JSON object");
  }
  const model = stringField(value.model, "model");
  return { model };
}

export function buildLlmTokenName(
  model: string,
  now = new Date(),
  random = Math.random,
) {
  const timestamp = Math.floor(now.getTime() / 1000).toString(36);
  const suffix = random().toString(36).slice(2, 8) || "0";
  return `flyte-${shortHash(model)}-${timestamp}-${suffix}`;
}

export async function createLlmApiKey({
  model,
  fetchImpl = fetch,
  now = () => new Date(),
  nameFactory = buildLlmTokenName,
}: CreateLlmApiKeyInput): Promise<CreatedLlmApiKey> {
  const parsed = parseLlmApiKeyRequest({ model });
  const origin = getLlmKeysApiOrigin();
  const token = getLlmKeysApiToken();
  const name = nameFactory(parsed.model, now());
  const authHeaders = {
    authorization: `Bearer ${token}`,
  };

  await requestNewApi<unknown>(fetchImpl, `${origin}/api/token/`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name,
      expired_time: -1,
      unlimited_quota: true,
      model_limits_enabled: true,
      model_limits: parsed.model,
    }),
  });

  const params = new URLSearchParams({
    keyword: name,
    p: "1",
    page_size: "10",
  });
  const search = await requestNewApi<NewApiSearchData>(
    fetchImpl,
    `${origin}/api/token/search?${params.toString()}`,
    {
      method: "GET",
      headers: authHeaders,
    },
  );
  const tokenRecord = (search.data?.items ?? []).find(
    (item) => item.name === name && typeof item.id === "number",
  );
  if (!tokenRecord?.id) {
    throw statusError("created LLM token could not be found", 502);
  }

  const keyResponse = await requestNewApi<NewApiTokenKeyData>(
    fetchImpl,
    `${origin}/api/token/${tokenRecord.id}/key`,
    {
      method: "POST",
      headers: authHeaders,
    },
  );
  const key = keyResponse.data?.key?.trim() ?? "";
  if (!key) {
    throw statusError("LLM token service did not return a key", 502);
  }

  return {
    model: parsed.model,
    name,
    key: key.startsWith("sk-") ? key : `sk-${key}`,
  };
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

async function requestNewApi<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<NewApiEnvelope<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw statusError(
      error instanceof Error ? error.message : "LLM token service request failed",
      502,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    throw statusError("LLM token service returned a non-JSON response", 502);
  }

  let body: NewApiEnvelope<T>;
  try {
    body = JSON.parse(text) as NewApiEnvelope<T>;
  } catch {
    throw statusError("LLM token service returned invalid JSON", 502);
  }

  if (!response.ok) {
    throw statusError(
      body.message || `LLM token service returned HTTP ${response.status}`,
      502,
    );
  }
  if (body.success === false) {
    throw statusError(body.message || "LLM token service rejected the request", 502);
  }
  return body;
}

function stringField(value: unknown, field: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  if (field === "model" && /[,\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("model must be a single model identifier");
  }
  return trimmed;
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
