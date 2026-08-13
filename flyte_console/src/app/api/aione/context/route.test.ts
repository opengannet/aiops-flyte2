import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const previousKeys = process.env.EXTERNAL_API_KEYS;
const previousOrg = process.env.EXTERNAL_API_FLYTE_ORG;

describe("AIONE context route", () => {
  beforeEach(() => {
    process.env.EXTERNAL_API_KEYS = "test-key";
    process.env.EXTERNAL_API_FLYTE_ORG = "configured-org";
  });

  afterAll(() => {
    process.env.EXTERNAL_API_KEYS = previousKeys;
    process.env.EXTERNAL_API_FLYTE_ORG = previousOrg;
  });

  it("rejects requests without a valid API key", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/context?project=aione&domain=development",
      ),
    );

    expect(response.status).toBe(401);
  });

  it("returns the configured organization without requiring a model", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/context?project=aione&domain=development",
        { headers: { "X-API-Key": "test-key" } },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 200,
      data: {
        org: "configured-org",
        project: "aione",
        domain: "development",
      },
    });
  });

  it("requires project and domain", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/context?project=aione", {
        headers: { "X-API-Key": "test-key" },
      }),
    );

    expect(response.status).toBe(400);
  });
});
