import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startModelMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/aione/external-api", () => ({
  startAioneModelApp: startModelMock,
}));

describe("aione scoped model start route", () => {
  beforeEach(() => {
    process.env.EXTERNAL_API_KEYS = "valid-key";
    startModelMock.mockReset();
    startModelMock.mockResolvedValue({ id: "model-app", type: "VLLM" });
  });

  afterEach(() => {
    delete process.env.EXTERNAL_API_KEYS;
  });

  it.each([undefined, "wrong-key"])(
    "rejects a missing or incorrect external API key (%s)",
    async (apiKey) => {
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest(
          "http://localhost/v2/api/aione/model/model-app/start?project=aione&domain=development",
          {
            method: "POST",
            headers: apiKey ? { "X-API-Key": apiKey } : undefined,
          },
        ),
        { params: { id: "model-app" } },
      );

      expect(response.status).toBe(401);
      expect(startModelMock).not.toHaveBeenCalled();
    },
  );

  it("starts the model app in the requested project and domain", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/model/model%20app/start?project=aione&domain=development",
        { method: "POST", headers: { "X-API-Key": "valid-key" } },
      ),
      { params: { id: "model%20app" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 200,
      data: { id: "model-app", type: "VLLM" },
    });
    expect(startModelMock).toHaveBeenCalledWith({
      id: "model app",
      project: "aione",
      domain: "development",
    });
  });
});
