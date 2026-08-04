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

describe("parseLlmApiKeyRequest", () => {
  it("requires a non-empty model", () => {
    expect(() => parseLlmApiKeyRequest({ model: "" })).toThrow(
      "model is required",
    );
  });

  it("rejects comma-separated or control-character model values", () => {
    expect(() =>
      parseLlmApiKeyRequest({ model: "model-a,model-b" }),
    ).toThrow("model must be a single model identifier");
    expect(() =>
      parseLlmApiKeyRequest({ model: "model-a\nmodel-b" }),
    ).toThrow("model must be a single model identifier");
  });

  it("trims model values", () => {
    expect(parseLlmApiKeyRequest({ model: " model-a " })).toEqual({
      model: "model-a",
    });
  });
});

describe("buildLlmTokenName", () => {
  it("builds a short deterministic token name", () => {
    const name = buildLlmTokenName(
      "sakamakismile/Qwen3.6-27B-NVFP4",
      new Date("2026-08-03T10:11:12.000Z"),
      () => 0.123456,
    );

    expect(name).toMatch(/^flyte-[a-z0-9]{8}-[a-z0-9]+-[a-z0-9]+$/);
    expect(name.length).toBeLessThanOrEqual(50);
  });

  it("adds entropy to avoid same-second token name collisions", () => {
    const now = new Date("2026-08-03T10:11:12.000Z");

    expect(buildLlmTokenName("model-a", now, () => 0.111111)).not.toBe(
      buildLlmTokenName("model-a", now, () => 0.222222),
    );
  });
});

describe("createLlmApiKey", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires the configured New API management token", async () => {
    const fetchMock = vi.fn();

    await expect(
      createLlmApiKey({
        model: "model-a",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      message: "LLM_KEYS_API_TOKEN is not configured",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates a model-limited New API token and returns the full sk key", async () => {
    vi.stubEnv("LLM_KEYS_API_TOKEN", "management-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, message: "" }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            items: [
              {
                id: 73,
                name: "flyte-abc12345-lk1d4o",
                key: "abcd**********wxyz",
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { key: "raw-created-key" } }),
      );

    const result = await createLlmApiKey({
      model: "sakamakismile/Qwen3.6-27B-NVFP4",
      fetchImpl: fetchMock,
      now: () => new Date("2026-08-03T10:11:12.000Z"),
      nameFactory: () => "flyte-abc12345-lk1d4o",
    });

    expect(result).toEqual({
      model: "sakamakismile/Qwen3.6-27B-NVFP4",
      name: "flyte-abc12345-lk1d4o",
      key: "sk-raw-created-key",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://llm.ops.fzyun.io/api/token/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer management-token",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          name: "flyte-abc12345-lk1d4o",
          expired_time: -1,
          unlimited_quota: true,
          model_limits_enabled: true,
          model_limits: "sakamakismile/Qwen3.6-27B-NVFP4",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://llm.ops.fzyun.io/api/token/search?keyword=flyte-abc12345-lk1d4o&p=1&page_size=10",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer management-token",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://llm.ops.fzyun.io/api/token/73/key",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer management-token",
        }),
      }),
    );
  });

  it("does not double-prefix keys that already include sk-", async () => {
    vi.stubEnv("LLM_KEYS_API_TOKEN", "management-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { items: [{ id: 8, name: "flyte-name" }] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { key: "sk-full-key" } }),
      );

    await expect(
      createLlmApiKey({
        model: "model-a",
        fetchImpl: fetchMock,
        nameFactory: () => "flyte-name",
      }),
    ).resolves.toMatchObject({ key: "sk-full-key" });
  });

  it("maps upstream HTML responses to a 502-safe error", async () => {
    vi.stubEnv("LLM_KEYS_API_TOKEN", "management-token");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>New API</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      createLlmApiKey({
        model: "model-a",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      message: "LLM token service returned a non-JSON response",
      status: 502,
    });
  });

  it("surfaces upstream authentication failures as 502 envelope errors", async () => {
    vi.stubEnv("LLM_KEYS_API_TOKEN", "bad-management-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, message: "未登录" }));

    await expect(
      createLlmApiKey({
        model: "model-a",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      message: "未登录",
      status: 502,
    });
  });
});
