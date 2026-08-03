import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLlmTokenName,
  createLlmApiKey,
  parseLlmTokenRequest,
} from "./token";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseLlmTokenRequest", () => {
  it("requires a non-empty model and token", () => {
    expect(() => parseLlmTokenRequest({ model: "", token: "pat" })).toThrow(
      "model is required",
    );
    expect(() => parseLlmTokenRequest({ model: "model", token: "" })).toThrow(
      "token is required",
    );
  });

  it("rejects comma-separated or control-character model values", () => {
    expect(() =>
      parseLlmTokenRequest({ model: "model-a,model-b", token: "pat" }),
    ).toThrow("model must be a single model identifier");
    expect(() =>
      parseLlmTokenRequest({ model: "model-a\nmodel-b", token: "pat" }),
    ).toThrow("model must be a single model identifier");
  });

  it("trims model and token values", () => {
    expect(
      parseLlmTokenRequest({ model: " model-a ", token: " pat-token " }),
    ).toEqual({
      model: "model-a",
      token: "pat-token",
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

  it("creates a model-limited New API token and returns the full sk key", async () => {
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
      token: "dashboard-token",
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
          authorization: "Bearer dashboard-token",
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
          authorization: "Bearer dashboard-token",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://llm.ops.fzyun.io/api/token/73/key",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer dashboard-token",
        }),
      }),
    );
  });

  it("does not double-prefix keys that already include sk-", async () => {
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
        token: "dashboard-token",
        fetchImpl: fetchMock,
        nameFactory: () => "flyte-name",
      }),
    ).resolves.toMatchObject({ key: "sk-full-key" });
  });

  it("maps upstream HTML responses to a 502-safe error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>New API</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(
      createLlmApiKey({
        model: "model-a",
        token: "dashboard-token",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      message: "LLM token service returned a non-JSON response",
      status: 502,
    });
  });

  it("surfaces upstream authentication failures as 502 envelope errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: false, message: "未登录" }));

    await expect(
      createLlmApiKey({
        model: "model-a",
        token: "bad-dashboard-token",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({
      message: "未登录",
      status: 502,
    });
  });
});
