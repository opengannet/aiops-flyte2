import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Code, ConnectError } from "@connectrpc/connect";

const getRunDetailsMock = vi.hoisted(() => vi.fn());
const getTrainingTaskByIdMock = vi.hoisted(() => vi.fn());
const getDevelopmentInstanceByIdMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());
const getHawkRunLogsMock = vi.hoisted(() => vi.fn());

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

vi.mock("@/server/hawk/run-logs", () => ({
  getHawkRunLogs: getHawkRunLogsMock,
}));

const latestLogContext = {
  primaryPodName: "task-contract-1-run-a0-0-latest",
  pods: [
    {
      namespace: "flyte",
      podName: "task-contract-1-run-a0-0-latest",
      primaryContainerName: "main",
      containers: [{ containerName: "main" }],
      initContainers: [],
    },
  ],
};

describe("aione external typed log route", () => {
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
          id: {
            name: "a0",
          },
          attempts: [
            {
              attempt: 1,
              logContext: {
                primaryPodName: "old-pod",
                pods: [
                  {
                    namespace: "flyte",
                    podName: "old-pod",
                    primaryContainerName: "main",
                    containers: [{ containerName: "main" }],
                    initContainers: [],
                  },
                ],
              },
            },
            {
              attempt: 3,
              logContext: latestLogContext,
            },
          ],
        },
      },
    });
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: "line 1\nline 2\nline 3\nline 4\n",
      json: () => ({}),
    });
    getHawkRunLogsMock.mockResolvedValue({
      start: 100,
      end: 200,
      limit: 10000,
      targets: [],
      lines: [
        { timestamp: { seconds: 100, nanos: 0 }, message: "line 1" },
        { timestamp: { seconds: 200, nanos: 0 }, message: "line 2" },
        { timestamp: { seconds: 300, nanos: 0 }, message: "line 3" },
        { timestamp: { seconds: 400, nanos: 0 }, message: "line 4" },
      ],
    });
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
        {
          method: "GET",
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("returns paged Hawk logs for an instance external id using the latest attempt context", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/instance/ins-contract-1/log?page=2&size=2",
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
    expect(getHawkRunLogsMock).toHaveBeenCalledWith(
      {
        org: "aione",
        project: "aione",
        domain: "development",
        runId: "ins-contract-1-r1",
        actionId: "a0",
        attempt: 3,
        limit: 10000,
      },
      expect.objectContaining({ getActionDetails: expect.any(Function) }),
    );
    expect(requestKubernetesMock).not.toHaveBeenCalled();
    expect(body).toEqual({
      status: 200,
      data: {
        total: 4,
        logs: [
          { time: "1970-01-01T00:03:20.000Z", log: "line 2" },
          { time: "1970-01-01T00:01:40.000Z", log: "line 1" },
        ],
      },
    });
  });

  it("returns default first page logs for a task external id", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
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
    expect(body.data).toEqual({
      total: 4,
      logs: [
        { time: "1970-01-01T00:06:40.000Z", log: "line 4" },
        { time: "1970-01-01T00:05:00.000Z", log: "line 3" },
        { time: "1970-01-01T00:03:20.000Z", log: "line 2" },
        { time: "1970-01-01T00:01:40.000Z", log: "line 1" },
      ],
    });
    expect(requestKubernetesMock).not.toHaveBeenCalled();
  });

  it("returns the latest page first when ordering external Hawk logs", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log?page=1&size=2",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 200,
      data: {
        total: 4,
        logs: [
          { time: "1970-01-01T00:06:40.000Z", log: "line 4" },
          { time: "1970-01-01T00:05:00.000Z", log: "line 3" },
        ],
      },
    });
  });

  it("returns Hawk historical logs when the pod has already been cleaned up", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: "pods not found",
      json: () => ({}),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requestKubernetesMock).not.toHaveBeenCalled();
    expect(body).toEqual({
      status: 200,
      data: {
        total: 4,
        logs: [
          { time: "1970-01-01T00:06:40.000Z", log: "line 4" },
          { time: "1970-01-01T00:05:00.000Z", log: "line 3" },
          { time: "1970-01-01T00:03:20.000Z", log: "line 2" },
          { time: "1970-01-01T00:01:40.000Z", log: "line 1" },
        ],
      },
    });
  });

  it("splits multiline Hawk messages and keeps the source timestamp on each external log line", async () => {
    getHawkRunLogsMock.mockResolvedValue({
      start: 100,
      end: 200,
      limit: 10000,
      targets: [],
      lines: [
        {
          timestamp: { seconds: 100, nanos: 123000000 },
          message: "first\nsecond\n",
        },
        { timestamp: { seconds: 200, nanos: 0 }, message: "third" },
      ],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 200,
      data: {
        total: 3,
        logs: [
          { time: "1970-01-01T00:03:20.000Z", log: "third" },
          { time: "1970-01-01T00:01:40.123Z", log: "first" },
          { time: "1970-01-01T00:01:40.123Z", log: "second" },
        ],
      },
    });
  });

  it("returns an empty time string when a Hawk log has no timestamp", async () => {
    getHawkRunLogsMock.mockResolvedValue({
      start: 100,
      end: 200,
      limit: 10000,
      targets: [],
      lines: [{ message: "untimed" }],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: 200,
      data: { total: 1, logs: [{ time: "", log: "untimed" }] },
    });
  });

  it("returns an empty log page when log context is unavailable", async () => {
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          attempts: [{ attempt: 1 }],
        },
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requestKubernetesMock).not.toHaveBeenCalled();
    expect(getHawkRunLogsMock).not.toHaveBeenCalled();
    expect(body).toEqual({ status: 200, data: { total: 0, logs: [] } });
  });

  it("returns an empty log page when the action id is unavailable", async () => {
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          attempts: [{ attempt: 1, logContext: latestLogContext }],
        },
      },
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getHawkRunLogsMock).not.toHaveBeenCalled();
    expect(body).toEqual({ status: 200, data: { total: 0, logs: [] } });
  });

  it("rejects invalid page and size values", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log?page=0&size=200",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "page must be a positive integer",
    });
  });

  it("returns 409 when the task id is ambiguous", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("task id is ambiguous", Code.FailedPrecondition),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
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

  it("returns a 502 envelope without leaking Hawk secrets when Hawk log reading fails", async () => {
    getHawkRunLogsMock.mockRejectedValue(
      new Error("HAWK_API_KEY is not configured"),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/log",
        {
          method: "GET",
          headers: { authorization: "Bearer external-key" },
        },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      status: 502,
      message: "failed to read Hawk logs",
    });
    expect(body.message).not.toContain("HAWK_API_KEY");
  });

  it("rejects unsupported path types", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/note/x/log", {
        method: "GET",
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "note", id: "x" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "type must be instance or task",
    });
  });
});
