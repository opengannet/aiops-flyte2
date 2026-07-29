import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statusError } from "@/server/http/response";

const getHawkRunLogsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/hawk/run-logs", () => ({
  getHawkRunLogs: getHawkRunLogsMock,
}));

describe("Hawk run logs route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHawkRunLogsMock.mockResolvedValue({
      start: 1000,
      end: 1120,
      limit: 5000,
      targets: [],
      lines: [],
    });
  });

  it("requires run identifiers before querying Hawk", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/hawk/run-logs?project=aione"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "org is required" });
    expect(getHawkRunLogsMock).not.toHaveBeenCalled();
  });

  it("passes normalized query parameters to the logs service", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-logs?org=aione&project=aione&domain=development&runId=run-a&actionId=a0&attempt=2&start=1000&end=1120&limit=200",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe(200);
    expect(getHawkRunLogsMock).toHaveBeenCalledWith({
      org: "aione",
      project: "aione",
      domain: "development",
      runId: "run-a",
      actionId: "a0",
      attempt: 2,
      start: 1000,
      end: 1120,
      limit: 200,
    });
  });

  it("rejects invalid numeric ranges and limits before querying Hawk", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-logs?org=aione&project=aione&domain=development&runId=run-a&actionId=a0&start=1120&end=1000&limit=10001",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("end must be greater than start");
    expect(getHawkRunLogsMock).not.toHaveBeenCalled();
  });

  it("rejects invalid attempt values before querying Hawk", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-logs?org=aione&project=aione&domain=development&runId=run-a&actionId=a0&attempt=-1",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("attempt must be a non-negative integer");
    expect(getHawkRunLogsMock).not.toHaveBeenCalled();
  });

  it("returns Hawk service errors without leaking secrets", async () => {
    getHawkRunLogsMock.mockRejectedValue(
      statusError("Hawk logs query failed with HTTP 502", 502),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-logs?org=aione&project=aione&domain=development&runId=run-a&actionId=a0",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      status: 502,
      message: "Hawk logs query failed with HTTP 502",
    });
    expect(JSON.stringify(body)).not.toContain("api-key");
  });
});
