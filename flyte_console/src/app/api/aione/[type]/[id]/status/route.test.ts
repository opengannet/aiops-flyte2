import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Code, ConnectError } from "@connectrpc/connect";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";

const getRunDetailsMock = vi.hoisted(() => vi.fn());
const getTrainingTaskByIdMock = vi.hoisted(() => vi.fn());
const getDevelopmentInstanceByIdMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());
const getAppMock = vi.hoisted(() => vi.fn());

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
          }
        : service.typeName ===
            "flyteidl2.developmentinstance.DevelopmentInstanceService"
          ? {
              getDevelopmentInstanceById: getDevelopmentInstanceByIdMock,
            }
          : service.typeName === "flyteidl2.app.AppService"
            ? { get: getAppMock }
            : {
                getRunDetails: getRunDetailsMock,
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

describe("aione external typed status route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    getDevelopmentInstanceByIdMock.mockResolvedValue({
      developmentInstance: {
        id: { id: "ins-contract-1" },
        org: "aione",
        project: "aione",
        domain: "development",
        latestRunName: "ins-contract-1-r1",
      },
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
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.FAILED,
            durationMs: 65432n,
          },
          result: {
            case: "errorInfo",
            value: {
              message: "image pull failed",
            },
          },
        },
      },
    });
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        items: [
          {
            metadata: {
              name: "mod-test-aione-development",
              namespace: "flyte",
              creationTimestamp: "2026-08-12T01:00:00.000Z",
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
        spec: { profile: { type: "VLLM" } },
        status: {
          currentReplicas: 1,
          ingress: { publicUrl: "https://mod-test.example" },
          conditions: [
            {
              deploymentStatus: 7,
              substate: 2,
              message: "Deployment is available",
            },
          ],
        },
      },
    });
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/status",
        {
          method: "GET",
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("returns compact status for an instance external id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/status",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "instance", id: "ins-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getRunDetailsMock).toHaveBeenCalledWith({
      runId: {
        org: "aione",
        project: "aione",
        domain: "development",
        name: "ins-contract-1-r1",
      },
    });
    expect(body).toEqual({
      status: 200,
      data: {
        runId: "aione/aione/development/ins-contract-1-r1",
        phase: ActionPhase.FAILED,
        error: "image pull failed",
        durationSeconds: 65,
      },
    });
  });

  it("returns compact status for a task external id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/status",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getTrainingTaskByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-contract-1" }),
    );
    expect(getRunDetailsMock).toHaveBeenCalledWith({
      runId: {
        org: "aione",
        project: "aione",
        domain: "development",
        name: "task-contract-1-run",
      },
    });
    expect(body.data).toEqual({
      runId: "aione/aione/development/task-contract-1-run",
      phase: ActionPhase.FAILED,
      error: "image pull failed",
      durationSeconds: 65,
    });
  });

  it("returns deployment status for a model application id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/model/mod-test/status", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "model", id: "mod-test" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 200,
      data: {
        name: "mod-test",
        deploymentStatus: 7,
        substate: 2,
        message: "Deployment is available",
        currentReplicas: 1,
        url: "https://mod-test.example",
      },
    });
  });

  it("uses zero defaults when a model application has no condition", async () => {
    getAppMock.mockResolvedValue({
      app: {
        metadata: { id: { name: "mod-test" } },
        spec: { profile: { type: "VLLM" } },
        status: {
          currentReplicas: 0,
          ingress: {
            cnameUrl: "https://model-cname.example",
            vpcUrl: "http://model.internal",
          },
        },
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/model/mod-test/status", {
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "model", id: "mod-test" }) },
    );

    await expect(response.json()).resolves.toEqual({
      status: 200,
      data: {
        name: "mod-test",
        deploymentStatus: 0,
        substate: 0,
        message: "",
        currentReplicas: 0,
        url: "https://model-cname.example",
      },
    });
  });

  it("returns 404 when the matching app is not VLLM", async () => {
    getAppMock.mockResolvedValue({
      app: { spec: { profile: { type: "OTHER" } } },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/model/mod-test/status", {
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "model", id: "mod-test" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      status: 404,
      message: "model application not found",
    });
  });

  it("returns 409 when a model id resolves to multiple applications", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            metadata: {
              name: "mod-test-aione-development",
              labels: {
                "flyte.org/project": "aione",
                "flyte.org/domain": "development",
              },
            },
          },
          {
            metadata: {
              name: "mod-test-other-production",
              labels: {
                "flyte.org/project": "other",
                "flyte.org/domain": "production",
              },
            },
          },
        ],
      }),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/model/mod-test/status", {
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "model", id: "mod-test" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: 409,
      message: "model application id is ambiguous",
    });
  });

  it("maps model AppService failures to an upstream error", async () => {
    getAppMock.mockRejectedValue(
      new ConnectError("app backend unavailable", Code.Unavailable),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/model/mod-test/status", {
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "model", id: "mod-test" }) },
    );

    expect(response.status).toBe(502);
  });

  it("returns a 404 envelope when a task external id has no training task", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("training task not found", Code.NotFound),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/task/missing/status", {
        method: "GET",
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

  it("returns a 409 envelope when a task id is ambiguous", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("task id is ambiguous", Code.FailedPrecondition),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/status",
        {
          method: "GET",
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
  });

  it("rejects unsupported path types", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/note/x/status", {
        method: "GET",
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
