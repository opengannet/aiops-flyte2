import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statusError } from "@/server/http/response";

const createLlmApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/llm/token", () => ({
  createLlmApiKey: createLlmApiKeyMock,
}));

describe("AIONE API key compatibility route", () => {
  beforeEach(() => {
    process.env.EXTERNAL_API_KEYS = "test-key";
    createLlmApiKeyMock.mockReset();
    createLlmApiKeyMock.mockResolvedValue({
      model: "model-a",
      name: "flyte-test",
      key: "sk-created-key",
    });
  });

  afterEach(() => {
    delete process.env.EXTERNAL_API_KEYS;
  });

  it.each([undefined, "wrong-key"])(
    "rejects a missing or incorrect external API key (%s)",
    async (apiKey) => {
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/v2/api/aione/apikey/model-a", {
          method: "POST",
          headers: apiKey ? { "X-API-Key": apiKey } : undefined,
        }),
        { params: { modelCode: ["model-a"] } },
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        status: 401,
        message: "unauthorized",
      });
      expect(createLlmApiKeyMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["X-API-Key", "test-key"],
    ["Authorization", "Bearer test-key"],
  ])("creates a key using %s authentication", async (header, value) => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/apikey/model-a", {
        method: "POST",
        headers: { [header]: value },
      }),
      { params: Promise.resolve({ modelCode: ["model-a"] }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 200,
      data: "sk-created-key",
    });
    expect(createLlmApiKeyMock).toHaveBeenCalledWith({ model: "model-a" });
  });

  it("preserves slash-delimited model codes", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/apikey/org/model-a", {
        method: "POST",
        headers: { "X-API-Key": "test-key" },
      }),
      { params: { modelCode: ["org", "model-a"] } },
    );

    expect(response.status).toBe(200);
    expect(createLlmApiKeyMock).toHaveBeenCalledWith({ model: "org/model-a" });
  });

  it.each([404, 409, 502, 503])(
    "preserves mapped error status %i",
    async (status) => {
      createLlmApiKeyMock.mockRejectedValue(statusError("safe error", status));
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/v2/api/aione/apikey/model-a", {
          method: "POST",
          headers: { "X-API-Key": "test-key" },
        }),
        { params: { modelCode: ["model-a"] } },
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        status,
        message: "safe error",
      });
    },
  );
});
