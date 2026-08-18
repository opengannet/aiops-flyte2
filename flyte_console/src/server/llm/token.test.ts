import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLlmTokenName,
  createLlmApiKey,
  parseLlmApiKeyRequest,
} from "./token";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successfulKey(key = "raw-created-key") {
  return jsonResponse({
    success: true,
    message: "",
    data: {
      id: 73,
      key,
      name: "flyte-fixed",
      model_code: "org/model-a",
      created: true,
    },
  });
}

describe("parseLlmApiKeyRequest", () => {
  it("validates and trims model codes", () => {
    expect(parseLlmApiKeyRequest({ model: " org/model-a " })).toEqual({
      model: "org/model-a",
    });
    expect(() => parseLlmApiKeyRequest({ model: "" })).toThrow(
      "model is required",
    );
    expect(() => parseLlmApiKeyRequest({ model: "a,b" })).toThrow(
      "model must be a single model identifier",
    );
    expect(() => parseLlmApiKeyRequest({ model: "a\nb" })).toThrow(
      "model must be a single model identifier",
    );
  });
});

describe("buildLlmTokenName", () => {
  it("generates a flyte-prefixed name no longer than 50 characters", () => {
    const name = buildLlmTokenName(
      "sakamakismile/Qwen3.6-27B-NVFP4",
      new Date("2026-08-03T10:11:12.000Z"),
      () => 0.123456,
    );

    expect(name).toMatch(/^flyte-[a-z0-9]{8}-[a-z0-9]+-[a-z0-9]+$/);
    expect(name.length).toBeLessThanOrEqual(50);
  });
});

describe("createLlmApiKey", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("LLM_KEYS_API_TOKEN", "management-token");
  });

  it("requires a configured management PAT", async () => {
    vi.stubEnv("LLM_KEYS_API_TOKEN", "");
    const fetchMock = vi.fn();

    await expect(
      createLlmApiKey({ model: "model-a", fetchImpl: fetchMock }),
    ).rejects.toMatchObject({
      message: "LLM_KEYS_API_TOKEN is not configured",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses one atomic request and normalizes the returned key prefix", async () => {
    vi.stubEnv("LLM_KEYS_API_ORIGIN", "https://gateway.example.test/base/");
    const fetchMock = vi.fn().mockResolvedValue(successfulKey());

    const result = await createLlmApiKey({
      model: "org/model-a",
      fetchImpl: fetchMock,
      nameFactory: () => "flyte-fixed",
      idempotencyKeyFactory: () => "fixed-idempotency-key",
    });

    expect(result).toEqual({
      model: "org/model-a",
      name: "flyte-fixed",
      key: "sk-raw-created-key",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.example.test/base/api/token/flyte-publication",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer management-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model_code: "org/model-a",
          name: "flyte-fixed",
          idempotency_key: "fixed-idempotency-key",
        }),
      }),
    );
  });

  it("does not double-prefix a key that already starts with sk-", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulKey("sk-full-key"));

    await expect(
      createLlmApiKey({
        model: "org/model-a",
        fetchImpl: fetchMock,
        nameFactory: () => "flyte-fixed",
        idempotencyKeyFactory: () => "fixed-idempotency-key",
      }),
    ).resolves.toMatchObject({ key: "sk-full-key" });
  });

  it.each([
    [
      "network failure",
      () => Promise.reject(new Error("secret transport detail")),
    ],
    [
      "HTTP 5xx",
      () => Promise.resolve(jsonResponse({ secret: "raw body" }, 503)),
    ],
    [
      "non-JSON success",
      () => Promise.resolve(new Response("secret raw body")),
    ],
    [
      "malformed JSON success",
      () =>
        Promise.resolve(
          new Response("{", {
            headers: { "content-type": "application/json" },
          }),
        ),
    ],
  ])(
    "retries %s once with the same name and idempotency key",
    async (_label, firstResponse) => {
      const fetchMock = vi
        .fn()
        .mockImplementationOnce(firstResponse)
        .mockResolvedValueOnce(successfulKey());

      await expect(
        createLlmApiKey({
          model: "org/model-a",
          fetchImpl: fetchMock,
          nameFactory: () => "flyte-fixed",
          idempotencyKeyFactory: () => "fixed-idempotency-key",
        }),
      ).resolves.toMatchObject({ key: "sk-raw-created-key" });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
        fetchMock.mock.calls[1]?.[1]?.body,
      );
    },
  );

  it.each([400, 401, 403, 404, 409])(
    "does not retry upstream HTTP %i",
    async (upstreamStatus) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ message: "raw upstream detail" }, upstreamStatus),
        );

      await expect(
        createLlmApiKey({
          model: "org/model-a",
          fetchImpl: fetchMock,
          nameFactory: () => "flyte-fixed",
          idempotencyKeyFactory: () => "fixed-idempotency-key",
        }),
      ).rejects.toMatchObject({
        status:
          upstreamStatus === 404 || upstreamStatus === 409
            ? upstreamStatus
            : 502,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not expose the management PAT or upstream response body in errors", async () => {
    vi.stubEnv("LLM_KEYS_API_TOKEN", "sensitive-management-pat");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: "sensitive raw upstream message" }, 403),
      );

    let thrown: unknown;
    try {
      await createLlmApiKey({
        model: "org/model-a",
        fetchImpl: fetchMock,
        nameFactory: () => "flyte-fixed",
        idempotencyKeyFactory: () => "fixed-idempotency-key",
      });
    } catch (error) {
      thrown = error;
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).not.toContain("sensitive-management-pat");
    expect(message).not.toContain("sensitive raw upstream message");
  });
});
