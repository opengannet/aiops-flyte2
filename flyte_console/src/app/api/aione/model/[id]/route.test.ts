/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createRunMock = vi.hoisted(() => vi.fn());
const deleteModelMock = vi.hoisted(() => vi.fn());
const getModelMock = vi.hoisted(() => vi.fn());
const updateModelMock = vi.hoisted(() => vi.fn());
const logRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/aione/external-api", () => ({
  createAioneExternalRun: createRunMock,
  deleteAioneModelApp: deleteModelMock,
  getAioneModelApp: getModelMock,
  updateAioneModelApp: updateModelMock,
}));

vi.mock("@/server/aione/debug", () => ({
  logAioneExternalApiRequest: logRequestMock,
}));

describe("aione scoped model route", () => {
  beforeEach(() => {
    process.env.EXTERNAL_API_KEYS = "valid-key";
    createRunMock.mockReset();
    deleteModelMock.mockReset();
    getModelMock.mockReset();
    updateModelMock.mockReset();
    logRequestMock.mockReset();
    createRunMock.mockResolvedValue({
      id: "model-app",
      app: { id: "model-app", type: "VLLM" },
    });
    deleteModelMock.mockResolvedValue({});
    getModelMock.mockResolvedValue({ id: "model-app", type: "VLLM" });
    updateModelMock.mockResolvedValue({ id: "model-app", type: "VLLM" });
  });

  afterEach(() => {
    delete process.env.EXTERNAL_API_KEYS;
  });

  it("keeps POST /model/run reachable despite the scoped detail route", async () => {
    const { POST } = await import("./route");
    const payload = {
      id: "model-app",
      project: "aione",
      domain: "development",
      codes: [{ id: "https://git.example/model.git", token: "secret" }],
    };
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/model/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "valid-key",
        },
        body: JSON.stringify(payload),
      }),
      { params: { id: "run" } },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 200,
      data: { id: "model-app", type: "VLLM" },
    });
    expect(createRunMock).toHaveBeenCalledWith("model", payload);
    expect(logRequestMock).toHaveBeenCalledWith({
      request: expect.any(NextRequest),
      type: "model",
      payload,
    });
  });

  it("rejects non-run POST ids", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/model/not-an-action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "valid-key",
        },
        body: "{}",
      }),
      { params: { id: "not-an-action" } },
    );
    expect(response.status).toBe(404);
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it("rejects scoped requests without an external API key", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/model/model-app?project=aione&domain=development",
      ),
      { params: { id: "model-app" } },
    );

    expect(response.status).toBe(401);
    expect(getModelMock).not.toHaveBeenCalled();
  });

  it("passes the decoded app id, project, and domain to the detail service", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/model/model%20app?project=aione&domain=development",
        { headers: { "X-API-Key": "valid-key" } },
      ),
      { params: { id: "model%20app" } },
    );

    expect(response.status).toBe(200);
    expect(getModelMock).toHaveBeenCalledWith({
      id: "model app",
      project: "aione",
      domain: "development",
    });
  });

  it("passes only the scoped runtime update payload to the update service", async () => {
    const { PUT } = await import("./route");
    const payload = {
      name: "Edited",
      image: "custom-vllm",
      param: "--max-model-len 4096",
      modelCacheSize: "120Gi",
    };
    const response = await PUT(
      new NextRequest(
        "http://localhost/v2/api/aione/model/model-app?project=aione&domain=development",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "valid-key",
          },
          body: JSON.stringify(payload),
        },
      ),
      { params: { id: "model-app" } },
    );

    expect(response.status).toBe(200);
    expect(updateModelMock).toHaveBeenCalledWith(
      { id: "model-app", project: "aione", domain: "development" },
      payload,
    );
  });

  it("deletes only the scoped model app", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest(
        "http://localhost/v2/api/aione/model/model-app?project=aione&domain=development",
        { method: "DELETE", headers: { "X-API-Key": "valid-key" } },
      ),
      { params: { id: "model-app" } },
    );

    expect(response.status).toBe(200);
    expect(deleteModelMock).toHaveBeenCalledWith({
      id: "model-app",
      project: "aione",
      domain: "development",
    });
  });
});
