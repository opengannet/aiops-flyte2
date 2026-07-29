import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { statusError } from "@/server/http/response";

const getHawkRunMetricsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/hawk/run-metrics", () => ({
  getHawkRunMetrics: getHawkRunMetricsMock,
}));

describe("Hawk run metrics route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getHawkRunMetricsMock.mockResolvedValue({
      start: 1000,
      end: 1120,
      step: 60,
      targets: [],
      metrics: {},
    });
  });

  it("requires business identifiers instead of PromQL", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-metrics?query=up&project=aione",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "org is required" });
    expect(getHawkRunMetricsMock).not.toHaveBeenCalled();
  });

  it("passes normalized query parameters to the metrics service", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-metrics?org=aione&project=aione&domain=development&runId=run-a&actionId=a0&attempt=2&start=1000&end=1120&step=60&query=up",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe(200);
    expect(getHawkRunMetricsMock).toHaveBeenCalledWith({
      org: "aione",
      project: "aione",
      domain: "development",
      runId: "run-a",
      actionId: "a0",
      attempt: 2,
      start: 1000,
      end: 1120,
      step: 60,
    });
  });

  it("rejects invalid numeric ranges before querying Hawk", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-metrics?org=aione&project=aione&domain=development&runId=run-a&actionId=a0&attempt=0&start=1120&end=1000",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("end must be greater than start");
    expect(getHawkRunMetricsMock).not.toHaveBeenCalled();
  });

  it("rejects invalid attempt values before querying Hawk", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-metrics?org=aione&project=aione&domain=development&runId=run-a&actionId=a0&attempt=-1",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("attempt must be a non-negative integer");
    expect(getHawkRunMetricsMock).not.toHaveBeenCalled();
  });

  it("returns Hawk service errors without leaking secrets", async () => {
    getHawkRunMetricsMock.mockRejectedValue(
      statusError("Hawk query failed with HTTP 502", 502),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/hawk/run-metrics?org=aione&project=aione&domain=development&runId=run-a&actionId=a0",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      status: 502,
      message: "Hawk query failed with HTTP 502",
    });
    expect(JSON.stringify(body)).not.toContain("api-key");
  });
});
