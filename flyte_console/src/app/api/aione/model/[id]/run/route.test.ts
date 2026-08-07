/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createAioneExternalRunMock = vi.hoisted(() => vi.fn());
const logAioneExternalApiRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/aione/external-api", () => ({
  createAioneExternalRun: createAioneExternalRunMock,
}));

vi.mock("@/server/aione/debug", () => ({
  logAioneExternalApiRequest: logAioneExternalApiRequestMock,
}));

describe("external model run route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
  });

  it("starts the model identified by the URL", async () => {
    createAioneExternalRunMock.mockResolvedValue({
      id: "mod-epc8fd1hzpadso7k6lw20w3312",
      app: {
        name: "mod-epc8fd1hzpadso7k6lw20w3312",
        code: "deepseek4.0",
        profile: "VLLM",
        url: "http://mod-epc8fd1hzpadso7k6lw20w3312-aione-development.example.com",
      },
    });
    const { POST } = await import("./route");
    const payload = {
      project: "aione",
      domain: "development",
      name: "deepseek v4",
      code: "deepseek4.0",
      image: "vllm",
      param: "--model\nxxxx\n--port\n9090",
      codes: [
        {
          id: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
          branch: "master",
          token: "Founder123",
        },
      ],
      resourceDefinition: {
        cpu: "2",
        memory: "4Gi",
        gpu: 1,
        gpu_key: "nvidia.com/gpu",
      },
    };

    const response = await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/model/mod-epc8fd1hzpadso7k6lw20w3312/run",
        {
          method: "POST",
          headers: { authorization: "Bearer external-key" },
          body: JSON.stringify(payload),
        },
      ),
      { params: Promise.resolve({ id: "mod-epc8fd1hzpadso7k6lw20w3312" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 200,
      data: {
        name: "mod-epc8fd1hzpadso7k6lw20w3312",
        code: "deepseek4.0",
        profile: "VLLM",
        url: "http://mod-epc8fd1hzpadso7k6lw20w3312-aione-development.example.com",
      },
    });
    expect(createAioneExternalRunMock).toHaveBeenCalledWith("model", {
      ...payload,
      id: "mod-epc8fd1hzpadso7k6lw20w3312",
    });
  });

  it("rejects unauthenticated requests", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/model/mod-epc8fd1hzpadso7k6lw20w3312/run",
        { method: "POST", body: "{}" },
      ),
      { params: { id: "mod-epc8fd1hzpadso7k6lw20w3312" } },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      status: 401,
      message: "unauthorized",
    });
  });

  it("rejects a body id that differs from the URL", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/model/mod-epc8fd1hzpadso7k6lw20w3312/run",
        {
          method: "POST",
          headers: { authorization: "Bearer external-key" },
          body: JSON.stringify({ id: "mod-other" }),
        },
      ),
      { params: { id: "mod-epc8fd1hzpadso7k6lw20w3312" } },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: 400,
      message: "model id must match the URL",
    });
  });
});
