/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createRunMock = vi.hoisted(() => vi.fn());
const logRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/aione/external-api", () => ({
  createAioneExternalRun: createRunMock,
  deleteAioneModelApp: vi.fn(),
  getAioneModelApp: vi.fn(),
  updateAioneModelApp: vi.fn(),
}));

vi.mock("@/server/aione/debug", () => ({
  logAioneExternalApiRequest: logRequestMock,
}));

describe("aione scoped model route", () => {
  beforeEach(() => {
    process.env.EXTERNAL_API_KEYS = "valid-key";
    createRunMock.mockReset();
    logRequestMock.mockReset();
    createRunMock.mockResolvedValue({
      id: "model-app",
      app: { id: "model-app", type: "VLLM" },
    });
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
});
