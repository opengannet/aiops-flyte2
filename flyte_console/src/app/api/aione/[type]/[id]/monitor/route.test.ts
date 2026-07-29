import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getAioneExternalMonitorMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/aione/monitor", async () => {
  const actual = await vi.importActual<typeof import("@/server/aione/monitor")>(
    "@/server/aione/monitor",
  );
  return {
    ...actual,
    getAioneExternalMonitor: getAioneExternalMonitorMock,
  };
});

describe("aione external typed monitor route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    getAioneExternalMonitorMock.mockResolvedValue([
      {
        time: "2026-07-29T08:00:00.000Z",
        cpu: 26.33,
      },
    ]);
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/monitor?mode=cpu&period=5m",
        { method: "GET" },
      ),
      { params: Promise.resolve({ type: "task", id: "task-contract-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
    expect(getAioneExternalMonitorMock).not.toHaveBeenCalled();
  });

  it("passes normalized monitor query parameters to the service", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/monitor?mode=cpu,memory,gpu,cpu&period=5m",
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
      data: [{ time: "2026-07-29T08:00:00.000Z", cpu: 26.33 }],
    });
    expect(getAioneExternalMonitorMock).toHaveBeenCalledWith(
      "task",
      "task-contract-1",
      {
        modes: ["cpu", "memory", "gpu"],
        periodSeconds: 300,
      },
    );
  });

  it("rejects invalid mode values before querying monitor data", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/monitor?mode=cpu,disk&period=5m",
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
      message: "mode must contain only cpu, memory, or gpu",
    });
    expect(getAioneExternalMonitorMock).not.toHaveBeenCalled();
  });

  it("rejects missing and multi-value period values before querying monitor data", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/task/task-contract-1/monitor?mode=cpu&period=5m,1h",
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
      message: "period must be a single duration like 5m or 1h",
    });
    expect(getAioneExternalMonitorMock).not.toHaveBeenCalled();
  });
});
