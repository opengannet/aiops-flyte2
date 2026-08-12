import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Code, ConnectError } from "@connectrpc/connect";

const abortRunMock = vi.hoisted(() => vi.fn());
const getTrainingTaskByIdMock = vi.hoisted(() => vi.fn());
const stopTrainingTaskMock = vi.hoisted(() => vi.fn());
const stopDevelopmentInstanceMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());
const getAppMock = vi.hoisted(() => vi.fn());
const updateAppMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn((service: { typeName?: string }) =>
      service.typeName === "flyteidl2.trainingtask.TrainingTaskService"
        ? {
            getTrainingTaskById: getTrainingTaskByIdMock,
            stopTrainingTask: stopTrainingTaskMock,
          }
        : service.typeName ===
            "flyteidl2.developmentinstance.DevelopmentInstanceService"
          ? {
              stopDevelopmentInstance: stopDevelopmentInstanceMock,
            }
          : service.typeName === "flyteidl2.app.AppService"
            ? { get: getAppMock, update: updateAppMock }
            : {
                abortRun: abortRunMock,
              },
    ),
  };
});

vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: vi.fn(() => ({})),
}));

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
  requestKubernetes: requestKubernetesMock,
}));

describe("aione external typed stop route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    getTrainingTaskByIdMock.mockResolvedValue({
      trainingTask: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "task-contract-1",
        },
        name: "外部训练任务",
        latestRunName: "task-contract-1-run",
      },
    });
    abortRunMock.mockResolvedValue({});
    stopDevelopmentInstanceMock.mockResolvedValue({});
    stopTrainingTaskMock.mockResolvedValue({});
    updateAppMock.mockResolvedValue({});
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        items: [
          {
            metadata: {
              name: "mod-test-aione-development",
              namespace: "flyte",
              labels: {
                "flyte.org/project": "aione",
                "flyte.org/domain": "development",
              },
            },
          },
        ],
      }),
    });
    getAppMock.mockResolvedValue({
      app: {
        metadata: {
          id: {
            org: "aione",
            project: "aione",
            domain: "development",
            name: "mod-test",
          },
        },
        spec: {
          desiredState: 3,
          profile: { type: "VLLM" },
          clusterPool: "gpu",
        },
      },
    });
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/stop",
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("stops an instance by external instance id", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/stop",
        {
          method: "POST",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(stopDevelopmentInstanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          id: "ins-contract-1",
        }),
        reason: "Stopped from AIONE external instance API",
      }),
    );
    expect(body).toEqual({ status: 200, data: {} });
  });

  it("stops a task by external task id", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/stop",
        {
          method: "POST",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(stopTrainingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          org: "aione",
          project: "aione",
          domain: "development",
          id: "task-contract-1",
        }),
        reason: "Stopped from AIONE external task API",
      }),
    );
    expect(getTrainingTaskByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-contract-1" }),
    );
    expect(body).toEqual({ status: 200, data: {} });
  });

  it("stops a model app while preserving its existing spec", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/model/mod-test/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "model", id: "mod-test" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 200, data: {} });
    expect(updateAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "Stopped from AIONE external model API",
        app: expect.objectContaining({
          spec: expect.objectContaining({
            desiredState: 1,
            clusterPool: "gpu",
          }),
        }),
      }),
    );
  });

  it("keeps repeated model stop requests idempotent", async () => {
    getAppMock.mockResolvedValue({
      app: {
        metadata: { id: { name: "mod-test" } },
        spec: {
          desiredState: 1,
          profile: { type: "VLLM" },
          clusterPool: "gpu",
        },
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/model/mod-test/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "model", id: "mod-test" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 200, data: {} });
    expect(updateAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        app: expect.objectContaining({
          spec: expect.objectContaining({
            desiredState: 1,
            clusterPool: "gpu",
          }),
        }),
      }),
    );
  });

  it("returns a 404 envelope when a task external id has no training task", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("training task not found", Code.NotFound),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/missing/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "task", id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      message: "training task not found",
    });
  });

  it("returns 409 when a task id is ambiguous", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("task id is ambiguous", Code.FailedPrecondition),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/stop",
        {
          method: "POST",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "task id is ambiguous",
    });
    expect(stopTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported path types", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/note/x/stop", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "note", id: "x" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "type must be instance, task, or model",
    });
  });
});
