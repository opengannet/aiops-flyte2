import { describe, expect, it, vi } from "vitest";

import {
  getAioneExternalMonitor,
  type AioneMonitorDependencies,
} from "@/server/aione/monitor";

type HawkMetricSeriesQuery = NonNullable<
  AioneMonitorDependencies["getHawkRunMetricSeries"]
>;

const runId = {
  org: "aione",
  project: "aione",
  domain: "development",
  name: "run-a",
};

function getRunDetailsForMonitor() {
  return {
    runId,
    resourceSpec: {
      cpu: "2",
      memory: "1Gi",
    },
    details: {
      action: {
        id: {
          name: "a0",
          run: runId,
        },
      },
    },
  };
}

describe("AIONE monitor service", () => {
  it("returns requested CPU, memory, and per-GPU percentage metrics", async () => {
    const getHawkRunMetricSeries = vi.fn(async () => ({
      targets: [
        {
          namespace: "flyte",
          podName: "run-a-a0-0-0",
          containerName: "main",
          containerId: "/k8s/flyte/run-a-a0-0-0/main",
          cpuRequestCores: 2,
          memoryRequestBytes: 1024 * 1024 * 1024,
        },
      ],
      metrics: {
        cpuUsage: [
          {
            metric: { container_id: "/k8s/flyte/run-a-a0-0-0/main" },
            points: [{ timestamp: 1000, value: 1 }],
          },
        ],
        memoryRss: [
          {
            metric: { container_id: "/k8s/flyte/run-a-a0-0-0/main" },
            points: [{ timestamp: 1000, value: 512 * 1024 * 1024 }],
          },
        ],
        gpuUtilization: [
          {
            metric: {
              gpu_uuid: "GPU-aaaa",
            },
            points: [{ timestamp: 1000, value: 70.123 }],
          },
          {
            metric: {
              gpu_uuid: "GPU-bbbb",
            },
            points: [{ timestamp: 1000, value: 80 }],
          },
        ],
        gpuMemoryUsage: [
          {
            metric: {
              gpu_uuid: "GPU-aaaa",
            },
            points: [{ timestamp: 1000, value: 35.456 }],
          },
          {
            metric: {
              gpu_uuid: "GPU-bbbb",
            },
            points: [{ timestamp: 1000, value: 20 }],
          },
        ],
      },
    }));
    const deps: AioneMonitorDependencies = {
      nowSeconds: () => 1300,
      getAioneExternalRunDetails: async () => ({
        runId,
        resourceSpec: {
          cpu: "2",
          memory: "1Gi",
        },
        details: {
          action: {
            id: {
              name: "a0",
              run: runId,
            },
          },
        },
      }),
      getHawkRunMetricSeries,
    };

    const result = await getAioneExternalMonitor(
      "task",
      "task-contract-1",
      {
        modes: ["cpu", "memory", "gpu"],
        periodSeconds: 300,
      },
      deps,
    );

    expect(getHawkRunMetricSeries).toHaveBeenCalledWith(
      {
        org: "aione",
        project: "aione",
        domain: "development",
        runId: "run-a",
        actionId: "a0",
        start: 960,
        end: 1260,
        step: 60,
      },
      ["cpuUsage", "memoryRss", "gpuUtilization", "gpuMemoryUsage"],
      expect.objectContaining({ getActionDetails: expect.any(Function) }),
    );
    expect(result).toEqual([
      {
        time: "1970-01-01T00:16:40.000Z",
        cpu: 50,
        memory: 50,
        "GPU-aaaa": {
          gpu: 70.12,
          vram: 35.46,
        },
        "GPU-bbbb": {
          gpu: 80,
          vram: 20,
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("vram-amount");
    expect(JSON.stringify(result)).not.toContain("vram-rate");
  });

  it("keeps repeated requests within the same step on the same query grid", async () => {
    const getHawkRunMetricSeries = vi.fn<HawkMetricSeriesQuery>(async () => ({
      targets: [],
      metrics: {},
    }));
    const nowSeconds = vi
      .fn()
      .mockReturnValueOnce(1300)
      .mockReturnValueOnce(1319)
      .mockReturnValueOnce(1320);
    const deps: AioneMonitorDependencies = {
      nowSeconds,
      getAioneExternalRunDetails: async () => getRunDetailsForMonitor(),
      getHawkRunMetricSeries,
    };

    for (let i = 0; i < 3; i += 1) {
      await getAioneExternalMonitor(
        "task",
        "task-contract-1",
        { modes: ["gpu"], periodSeconds: 300 },
        deps,
      );
    }

    expect(
      getHawkRunMetricSeries.mock.calls.map(([params]) => ({
        start: params.start,
        end: params.end,
        step: params.step,
      })),
    ).toEqual([
      { start: 960, end: 1260, step: 60 },
      { start: 960, end: 1260, step: 60 },
      { start: 1020, end: 1320, step: 60 },
    ]);
  });

  it.each([
    {
      periodSeconds: 60 * 60,
      now: 3701,
      expected: { start: 60, end: 3660, step: 60 },
    },
    {
      periodSeconds: 60 * 60 + 60,
      now: 4001,
      expected: { start: 240, end: 3900, step: 300 },
    },
    {
      periodSeconds: 6 * 60 * 60,
      now: 22001,
      expected: { start: 300, end: 21900, step: 300 },
    },
    {
      periodSeconds: 6 * 60 * 60 + 60,
      now: 23001,
      expected: { start: 840, end: 22500, step: 900 },
    },
  ])(
    "aligns query range using the existing step for period $periodSeconds",
    async ({ periodSeconds, now, expected }) => {
      const getHawkRunMetricSeries = vi.fn<HawkMetricSeriesQuery>(
        async () => ({
          targets: [],
          metrics: {},
        }),
      );
      const deps: AioneMonitorDependencies = {
        nowSeconds: () => now,
        getAioneExternalRunDetails: async () => getRunDetailsForMonitor(),
        getHawkRunMetricSeries,
      };

      await getAioneExternalMonitor(
        "task",
        "task-contract-1",
        { modes: ["gpu"], periodSeconds },
        deps,
      );

      const [params] = getHawkRunMetricSeries.mock.calls[0];
      expect({
        start: params.start,
        end: params.end,
        step: params.step,
      }).toEqual(expected);
    },
  );

  it("uses persisted resource specs for CPU and memory percentages without pod requests", async () => {
    const deps: AioneMonitorDependencies = {
      nowSeconds: () => 1300,
      getAioneExternalRunDetails: async () =>
        ({
          runId,
          resourceSpec: {
            cpu: "8",
            memory: "16Gi",
          },
          details: {
            action: { id: { name: "a0", run: runId } },
          },
        }) as any,
      getHawkRunMetricSeries: async () => ({
        targets: [
          {
            namespace: "flyte",
            podName: "run-a-a0-0-0",
            containerName: "main",
            containerId: "/k8s/flyte/run-a-a0-0-0/main",
          },
        ],
        metrics: {
          cpuUsage: [
            {
              metric: { container_id: "/k8s/flyte/run-a-a0-0-0/main" },
              points: [{ timestamp: 1000, value: 1 }],
            },
          ],
          memoryRss: [
            {
              metric: { container_id: "/k8s/flyte/run-a-a0-0-0/main" },
              points: [{ timestamp: 1000, value: 4 * 1024 * 1024 * 1024 }],
            },
          ],
        },
      }),
    };

    const result = await getAioneExternalMonitor(
      "instance",
      "ins-contract-1",
      { modes: ["cpu", "memory"], periodSeconds: 300 },
      deps,
    );

    expect(result).toEqual([
      {
        time: "1970-01-01T00:16:40.000Z",
        cpu: 12.5,
        memory: 25,
      },
    ]);
  });

  it("ignores pod request values when persisted resource specs differ", async () => {
    const deps: AioneMonitorDependencies = {
      nowSeconds: () => 1300,
      getAioneExternalRunDetails: async () =>
        ({
          runId,
          resourceSpec: {
            cpu: "8",
            memory: "16Gi",
          },
          details: {
            action: { id: { name: "a0", run: runId } },
          },
        }) as any,
      getHawkRunMetricSeries: async () => ({
        targets: [
          {
            namespace: "flyte",
            podName: "run-a-a0-0-0",
            containerName: "main",
            containerId: "/k8s/flyte/run-a-a0-0-0/main",
            cpuRequestCores: 2,
            memoryRequestBytes: 4 * 1024 * 1024 * 1024,
          },
        ],
        metrics: {
          cpuUsage: [
            {
              metric: { container_id: "/k8s/flyte/run-a-a0-0-0/main" },
              points: [{ timestamp: 1000, value: 1 }],
            },
          ],
          memoryRss: [
            {
              metric: { container_id: "/k8s/flyte/run-a-a0-0-0/main" },
              points: [{ timestamp: 1000, value: 4 * 1024 * 1024 * 1024 }],
            },
          ],
        },
      }),
    };

    const result = await getAioneExternalMonitor(
      "instance",
      "ins-contract-1",
      { modes: ["cpu", "memory"], periodSeconds: 300 },
      deps,
    );

    expect(result).toEqual([
      {
        time: "1970-01-01T00:16:40.000Z",
        cpu: 12.5,
        memory: 25,
      },
    ]);
  });

  it("rejects CPU percentages when the persisted CPU resource spec is unavailable", async () => {
    const deps: AioneMonitorDependencies = {
      nowSeconds: () => 1300,
      getAioneExternalRunDetails: async () => ({
        runId,
        details: {
          action: { id: { name: "a0", run: runId } },
        },
      }),
      getHawkRunMetricSeries: async () => ({
        targets: [
          {
            namespace: "flyte",
            podName: "run-a-a0-0-0",
            containerName: "main",
            containerId: "/k8s/flyte/run-a-a0-0-0/main",
          },
        ],
        metrics: {
          cpuUsage: [
            {
              metric: { container_id: "/k8s/flyte/run-a-a0-0-0/main" },
              points: [{ timestamp: 1000, value: 1 }],
            },
          ],
        },
      }),
    };

    await expect(
      getAioneExternalMonitor(
        "instance",
        "ins-contract-1",
        { modes: ["cpu"], periodSeconds: 300 },
        deps,
      ),
    ).rejects.toThrow("CPU request is unavailable for monitor target");
  });

  it("rejects memory percentages when the persisted memory resource spec is unavailable", async () => {
    const deps: AioneMonitorDependencies = {
      nowSeconds: () => 1300,
      getAioneExternalRunDetails: async () => ({
        runId,
        resourceSpec: {
          cpu: "2",
        },
        details: {
          action: { id: { name: "a0", run: runId } },
        },
      }),
      getHawkRunMetricSeries: async () => ({
        targets: [
          {
            namespace: "flyte",
            podName: "run-a-a0-0-0",
            containerName: "main",
            containerId: "/k8s/flyte/run-a-a0-0-0/main",
          },
        ],
        metrics: {
          memoryRss: [
            {
              metric: { container_id: "/k8s/flyte/run-a-a0-0-0/main" },
              points: [{ timestamp: 1000, value: 512 * 1024 * 1024 }],
            },
          ],
        },
      }),
    };

    await expect(
      getAioneExternalMonitor(
        "instance",
        "ins-contract-1",
        { modes: ["memory"], periodSeconds: 300 },
        deps,
      ),
    ).rejects.toThrow("Memory request is unavailable for monitor target");
  });
});
