import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunMetricsTab } from "./RunMetricsTab";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  selectedActionId: "a0",
  selectedAttempt: {
    attempt: 2,
    phase: 5,
    phaseTransitions: [
      {
        startTime: { seconds: 1000n, nanos: 0 },
        endTime: { seconds: 1120n, nanos: 0 },
      },
    ],
  },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({
    project: "aione",
    domain: "development",
    runId: "run-a",
  }),
}));

vi.mock("@/hooks/useOrg", () => ({
  useOrg: () => "aione",
}));

vi.mock("@/components/pages/RunDetails/hooks/useSelectedItem", () => ({
  useSelectedActionId: () => mocks.selectedActionId,
}));

vi.mock("@/components/pages/RunDetails/state/AttemptStore", () => ({
  useSelectedAttemptStore: (selector: (state: unknown) => unknown) =>
    selector({ selectedAttempt: mocks.selectedAttempt }),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  CartesianGrid: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Line: () => <div />,
  ReferenceLine: () => <div />,
}));

describe("RunMetricsTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useRealTimers();
    mocks.fetch.mockReset();
    mocks.selectedActionId = "a0";
    mocks.selectedAttempt = {
      attempt: 2,
      phase: 5,
      phaseTransitions: [
        {
          startTime: { seconds: 1000n, nanos: 0 },
          endTime: { seconds: 1120n, nanos: 0 },
        },
      ],
    };
    vi.stubGlobal("fetch", mocks.fetch);
    window.history.pushState(
      {},
      "",
      "/v2/domain/development/project/aione/runs/run-a?i=a0",
    );
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 200,
        data: {
          start: 1000,
          end: 1120,
          step: 60,
          targets: [
            {
              namespace: "flyte",
              podName: "run-a-a0-0-0",
              containerName: "ssh",
              containerId: "/k8s/flyte/run-a-a0-0-0/ssh",
              cpuRequestCores: 2,
              memoryRequestBytes: 536870912,
            },
          ],
          metrics: {
            cpuUsage: {
              label: "CPU Usage",
              unit: "cores",
              points: [
                { timestamp: 1000, value: 1 },
                { timestamp: 1060, value: 1.5 },
              ],
            },
            memoryRss: {
              label: "Memory Usage",
              unit: "bytes",
              points: [{ timestamp: 1060, value: 134217728 }],
            },
            gpuUtilization: {
              label: "GPU Utilization",
              unit: "percent",
              points: [],
              emptyReason: "Hawk has no samples for this metric.",
            },
            gpuMemoryUsage: {
              label: "GPU Memory Usage",
              unit: "percent",
              points: [],
              emptyReason: "Hawk has no samples for this metric.",
            },
          },
        },
      }),
    });
  });

  it("loads Hawk metrics for the selected action attempt", async () => {
    render(<RunMetricsTab />);

    expect(await screen.findByText("CPU Usage")).toBeVisible();
    expect(screen.getByText("Memory Usage")).toBeVisible();
    expect(screen.getByText("GPU Utilization")).toBeVisible();
    expect(screen.getByText("GPU Memory Usage")).toBeVisible();
    expect(screen.getAllByText("当前 Hawk 未采集该指标")[0]).toBeVisible();
    expect(screen.getByText("1.50 cores")).toBeVisible();
    expect(screen.getByText("128.00 MiB")).toBeVisible();
    expect(
      screen.getAllByText("Hawk has no samples for this metric.")[0],
    ).toBeVisible();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/v2/api/hawk/run-metrics?org=aione&project=aione&domain=development&runId=run-a&actionId=a0&attempt=2&start=970&end=1150&step=60",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("extends the metrics window to now for a running action attempt", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2000 * 1000);
    mocks.selectedAttempt = {
      attempt: 2,
      phase: 4,
      phaseTransitions: [
        {
          startTime: { seconds: 1000n, nanos: 0 },
          endTime: { seconds: 1120n, nanos: 0 },
        },
      ],
    };

    render(<RunMetricsTab />);

    expect(await screen.findByText("CPU Usage")).toBeVisible();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "/v2/api/hawk/run-metrics?org=aione&project=aione&domain=development&runId=run-a&actionId=a0&attempt=2&start=970&end=2000&step=60",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("shows loading state while Hawk metrics are loading", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    mocks.fetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<RunMetricsTab />);

    expect(await screen.findAllByText("Loading Hawk metrics...")).toHaveLength(
      4,
    );
    resolveFetch({
      ok: true,
      json: async () => ({
        status: 200,
        data: {
          start: 1000,
          end: 1120,
          step: 60,
          targets: [],
          metrics: {
            cpuUsage: { label: "CPU Usage", unit: "cores", points: [] },
            memoryRss: { label: "Memory Usage", unit: "bytes", points: [] },
            gpuUtilization: {
              label: "GPU Utilization",
              unit: "percent",
              points: [],
            },
            gpuMemoryUsage: {
              label: "GPU Memory Usage",
              unit: "percent",
              points: [],
            },
          },
        },
      }),
    });
  });

  it("shows Hawk API errors", async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      json: async () => ({
        status: 502,
        message: "Hawk query failed with HTTP 502",
      }),
    });

    render(<RunMetricsTab />);

    expect(
      (await screen.findAllByText("Hawk query failed with HTTP 502"))[0],
    ).toBeVisible();
  });

  it("shows an empty state when no runtime pod is found", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 200,
        data: {
          start: 1000,
          end: 1120,
          step: 60,
          targets: [],
          metrics: {
            cpuUsage: {
              label: "CPU Usage",
              unit: "cores",
              points: [],
              emptyReason:
                "No runtime pod target was found for this action attempt.",
            },
            memoryRss: {
              label: "Memory Usage",
              unit: "bytes",
              points: [],
              emptyReason:
                "No runtime pod target was found for this action attempt.",
            },
            gpuUtilization: {
              label: "GPU Utilization",
              unit: "percent",
              points: [],
              emptyReason:
                "No runtime pod target was found for this action attempt.",
            },
            gpuMemoryUsage: {
              label: "GPU Memory Usage",
              unit: "percent",
              points: [],
              emptyReason:
                "No runtime pod target was found for this action attempt.",
            },
          },
        },
      }),
    });

    render(<RunMetricsTab />);

    expect(
      (
        await screen.findAllByText(
          "No runtime pod target was found for this action attempt.",
        )
      )[0],
    ).toBeVisible();
  });

  it("does not call the metrics API until an action is selected", async () => {
    mocks.selectedActionId = null as unknown as string;

    render(<RunMetricsTab />);

    expect(screen.getByText("Select an action to view metrics.")).toBeVisible();
    await waitFor(() => expect(mocks.fetch).not.toHaveBeenCalled());
  });
});
