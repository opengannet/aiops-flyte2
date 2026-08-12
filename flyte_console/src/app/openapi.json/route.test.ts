import { describe, expect, it } from "vitest";

describe("AIONE OpenAPI route", () => {
  it("serves a valid OpenAPI 3.1 contract for every external REST route", async () => {
    const { GET } = await import("./route");
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.openapi).toBe("3.1.0");
    expect(body.paths).toEqual(
      expect.objectContaining({
        "/api/aione/{type}/run": expect.objectContaining({ post: expect.any(Object) }),
        "/api/aione/model/{id}/run": expect.objectContaining({ post: expect.any(Object) }),
        "/api/aione/{type}/{id}/status": expect.objectContaining({ get: expect.any(Object) }),
        "/api/aione/{type}/{id}/stop": expect.objectContaining({ post: expect.any(Object) }),
        "/api/aione/{type}/{id}/clear": expect.objectContaining({ delete: expect.any(Object) }),
        "/api/aione/{type}/{id}/runs": expect.objectContaining({ get: expect.any(Object) }),
        "/api/aione/{type}/{id}/log": expect.objectContaining({ get: expect.any(Object) }),
        "/api/aione/{type}/{id}/monitor": expect.objectContaining({ get: expect.any(Object) }),
        "/api/aione/gpus": expect.objectContaining({ get: expect.any(Object) }),
        "/api/aione/pvc/{id}/size": expect.objectContaining({ get: expect.any(Object) }),
        "/api/aione/apikey/{modelCode}": expect.objectContaining({ post: expect.any(Object) }),
      }),
    );
    expect(body.components.securitySchemes).toEqual(
      expect.objectContaining({ bearerAuth: expect.any(Object), apiKeyAuth: expect.any(Object) }),
    );
    expect(body.paths["/api/aione/gpus"].get.security).toEqual([
      { bearerAuth: [] },
      { apiKeyAuth: [] },
    ]);
    expect(body.paths["/api/aione/apikey/{modelCode}"].post.security).toEqual([]);
  });
});
