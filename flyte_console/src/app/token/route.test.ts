import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createLlmApiKeyMock = vi.hoisted(() => vi.fn());
const parseLlmTokenRequestMock = vi.hoisted(() => vi.fn((body) => body));

vi.mock("@/server/llm/token", () => ({
  createLlmApiKey: createLlmApiKeyMock,
  parseLlmTokenRequest: parseLlmTokenRequestMock,
}));

describe("public LLM token route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    parseLlmTokenRequestMock.mockImplementation((body) => body);
    createLlmApiKeyMock.mockResolvedValue({
      model: "model-a",
      name: "flyte-key",
      key: "sk-created",
    });
  });

  it("rejects requests without the external API key", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/token", {
        method: "POST",
        body: JSON.stringify({ model: "model-a", token: "dashboard-token" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
    expect(createLlmApiKeyMock).not.toHaveBeenCalled();
  });

  it("creates a token for authenticated third-party callers", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/token", {
        method: "POST",
        headers: {
          authorization: "Bearer external-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "model-a", token: "dashboard-token" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 200,
      data: { model: "model-a", name: "flyte-key", key: "sk-created" },
    });
    expect(createLlmApiKeyMock).toHaveBeenCalledWith({
      model: "model-a",
      token: "dashboard-token",
    });
  });

  it("returns a public envelope for invalid request bodies", async () => {
    parseLlmTokenRequestMock.mockImplementation(() => {
      throw new Error("model is required");
    });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/token", {
        method: "POST",
        headers: {
          "x-api-key": "external-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "", token: "dashboard-token" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "model is required" });
    expect(createLlmApiKeyMock).not.toHaveBeenCalled();
  });
});
