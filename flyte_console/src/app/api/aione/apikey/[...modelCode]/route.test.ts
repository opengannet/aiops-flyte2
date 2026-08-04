import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { statusError } from "@/server/http/response";

const createLlmApiKeyMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/llm/token", () => ({
  createLlmApiKey: createLlmApiKeyMock,
}));

describe("AIONE API key route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createLlmApiKeyMock.mockImplementation(({ model }: { model: string }) => {
      if (!model.trim()) {
        throw statusError("model is required", 400);
      }
      return Promise.resolve({
        model,
        name: "flyte-key",
        key: "sk-created",
      });
    });
  });

  it("returns the generated key string in the existing envelope shape", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/apikey/model-a", {
        method: "POST",
      }),
      { params: { modelCode: ["model-a"] } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 200, data: "sk-created" });
    expect(createLlmApiKeyMock).toHaveBeenCalledWith({ model: "model-a" });
  });

  it("restores slash-delimited model codes from catch-all path segments", async () => {
    const { POST } = await import("./route");
    await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/apikey/sakamakismile/Qwen3.6-27B-NVFP4",
        { method: "POST" },
      ),
      { params: { modelCode: ["sakamakismile", "Qwen3.6-27B-NVFP4"] } },
    );

    expect(createLlmApiKeyMock).toHaveBeenCalledWith({
      model: "sakamakismile/Qwen3.6-27B-NVFP4",
    });
  });

  it("returns a standard error envelope for empty model codes", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/apikey/%20", {
        method: "POST",
      }),
      { params: { modelCode: [" "] } },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "model is required" });
  });
});
