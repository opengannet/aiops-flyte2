import { NextRequest } from "next/server";
import { afterAll, describe, expect, it } from "vitest";

const previousAionePublicURL = process.env.AIONE_PUBLIC_URL;

describe("publication management redirect", () => {
  afterAll(() => {
    process.env.AIONE_PUBLIC_URL = previousAionePublicURL;
  });

  it("redirects with a non-sensitive deployment id", async () => {
    process.env.AIONE_PUBLIC_URL = "https://gateway.example.test/base/";
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/publication-link/app-a"),
      { params: { deploymentId: "app-a" } },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://gateway.example.test/models/deployments?deployment=app-a",
    );
  });

  it("returns 503 when the public URL is absent", async () => {
    delete process.env.AIONE_PUBLIC_URL;
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/publication-link/app-a"),
      { params: { deploymentId: "app-a" } },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 503,
      message: "AIONE_PUBLIC_URL is not configured",
    });
  });
});
