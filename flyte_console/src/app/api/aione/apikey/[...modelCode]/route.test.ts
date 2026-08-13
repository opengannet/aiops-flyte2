import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const previousExternalAPIKeys = process.env.EXTERNAL_API_KEYS;
const previousAionePublicURL = process.env.AIONE_PUBLIC_URL;

describe("AIONE API key compatibility route", () => {
  beforeEach(() => {
    process.env.EXTERNAL_API_KEYS = "test-key";
    process.env.AIONE_PUBLIC_URL = "https://gateway.example.test/";
  });

  afterAll(() => {
    process.env.EXTERNAL_API_KEYS = previousExternalAPIKeys;
    process.env.AIONE_PUBLIC_URL = previousAionePublicURL;
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
    },
  );

  it("returns a 410 migration response without creating a key", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/apikey/model-a", {
        method: "POST",
        headers: { "X-API-Key": "test-key" },
      }),
      { params: { modelCode: ["model-a"] } },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      status: 410,
      message:
        "model API key creation moved to https://gateway.example.test/models/deployments?model=model-a",
    });
  });

  it("encodes slash-delimited model codes in the migration URL", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/apikey/org/model-a", {
        method: "POST",
        headers: { "X-API-Key": "test-key" },
      }),
      { params: { modelCode: ["org", "model-a"] } },
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      message:
        "model API key creation moved to https://gateway.example.test/models/deployments?model=org%2Fmodel-a",
    });
  });
});
