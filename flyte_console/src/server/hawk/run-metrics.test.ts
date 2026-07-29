import { describe, expect, it, vi } from "vitest";

import {
  buildHawkContainerId,
  getHawkRunMetrics,
} from "@/server/hawk/run-metrics";

const baseParams = {
  org: "aione",
  project: "aione",
  domain: "development",
  runId: "run-a",
  actionId: "a0",
  attempt: 2,
  start: 1000,
  end: 1120,
  step: 60,
};

describe("Hawk run metrics", () => {
  it("builds Hawk Kubernetes container ids from namespace, pod, and container", () => {
    expect(buildHawkContainerId("flyte", "run-a-a0-0-0", "ssh")).toBe(
      "/k8s/flyte/run-a-a0-0-0/ssh",
    );
  });

  it("uses selected attempt log context before falling back to Kubernetes labels", async () => {
    const listPods = vi.fn();
    const queryHawkRange = vi.fn(async ({ query }: { query: string }) => ({
      result: query.includes("cpu_usage")
        ? []
        : [
            {
              metric: {},
              values: [
                [1000, "1"],
                [1060, "2"],
              ] as Array<[number, string]>,
            },
          ],
    }));

    const result = await getHawkRunMetrics(baseParams, {
      getActionDetails: async () =>
        ({
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
              attempt: 2,
              logContext: {
                primaryPodName: "run-a-a0-0-0",
                pods: [
                  {
                    namespace: "flyte",
                    podName: "run-a-a0-0-0",
                    primaryContainerName: "ssh",
                    containers: [{ containerName: "ssh" }],
                    initContainers: [],
                  },
                ],
              },
            },
          ],
        }) as any,
      getPod: async () => undefined,
      listPods,
      queryHawkRange,
    });

    expect(listPods).not.toHaveBeenCalled();
    expect(result.targets).toEqual([
      {
        namespace: "flyte",
        podName: "run-a-a0-0-0",
        containerName: "ssh",
        containerId: "/k8s/flyte/run-a-a0-0-0/ssh",
      },
    ]);
    expect(result.metrics.cpuUsage).toMatchObject({
      points: [],
      emptyReason: "Hawk has no samples for this metric.",
    });
    expect(queryHawkRange).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          'rate(container_resources_cpu_usage_seconds_total{container_id="/k8s/flyte/run-a-a0-0-0/ssh"}[2m])',
      }),
    );
  });

  it("falls back to Flyte pod labels when action details do not include log context", async () => {
    const queryHawkRange = vi.fn(async () => ({ result: [] }));
    const result = await getHawkRunMetrics(baseParams, {
      getActionDetails: async () => ({ attempts: [] }) as any,
      getPod: async () => undefined,
      listPods: async ({ labelSelector }) => {
        expect(labelSelector).toBe(
          "flyte.org/project=aione,flyte.org/domain=development,flyte.org/run-name=run-a,flyte.org/action-name=a0",
        );
        return [
          {
            metadata: { name: "run-a-a0-0-0", namespace: "flyte" },
            spec: {
              containers: [
                { name: "ssh", resources: { requests: { cpu: "2" } } },
              ],
            },
          },
        ];
      },
      queryHawkRange,
    });

    expect(result.targets[0]).toMatchObject({
      containerId: "/k8s/flyte/run-a-a0-0-0/ssh",
      cpuRequestCores: 2,
    });
  });

  it("aggregates whitelisted Hawk metric results without exposing arbitrary PromQL", async () => {
    const queries: string[] = [];
    const result = await getHawkRunMetrics(baseParams, {
      getActionDetails: async () =>
        ({
          attempts: [
            {
              attempt: 2,
              logContext: {
                primaryPodName: "run-a-a0-0-0",
                pods: [
                  {
                    namespace: "flyte",
                    podName: "run-a-a0-0-0",
                    primaryContainerName: "ssh",
                    containers: [{ containerName: "ssh" }],
                    initContainers: [],
                  },
                ],
              },
            },
          ],
        }) as any,
      getPod: async () => undefined,
      listPods: async () => [],
      queryHawkRange: async ({ query }) => {
        queries.push(query);
        return {
          result: [
            {
              metric: {},
              values: [
                [1000, "1"],
                [1060, "2"],
              ] as Array<[number, string]>,
            },
          ],
        };
      },
    });

    expect(queries).toEqual([
      'rate(container_resources_cpu_usage_seconds_total{container_id="/k8s/flyte/run-a-a0-0-0/ssh"}[2m])',
      'container_resources_memory_rss_bytes{container_id="/k8s/flyte/run-a-a0-0-0/ssh"}',
      'container_resources_gpu_usage_percent{container_id="/k8s/flyte/run-a-a0-0-0/ssh"}',
      'container_resources_gpu_memory_usage_percent{container_id="/k8s/flyte/run-a-a0-0-0/ssh"}',
    ]);
    expect(result.metrics.cpuUsage.points).toEqual([
      { timestamp: 1000, value: 1 },
      { timestamp: 1060, value: 2 },
    ]);
    expect(result.metrics.memoryRss.unit).toBe("bytes");
  });

  it("surfaces Hawk query errors from the whitelisted metric fetch", async () => {
    await expect(
      getHawkRunMetrics(baseParams, {
        getActionDetails: async () =>
          ({
            attempts: [
              {
                attempt: 2,
                logContext: {
                  primaryPodName: "run-a-a0-0-0",
                  pods: [
                    {
                      namespace: "flyte",
                      podName: "run-a-a0-0-0",
                      primaryContainerName: "ssh",
                      containers: [{ containerName: "ssh" }],
                      initContainers: [],
                    },
                  ],
                },
              },
            ],
          }) as any,
        getPod: async () => undefined,
        listPods: async () => [],
        queryHawkRange: async () => {
          throw new Error("Hawk query failed");
        },
      }),
    ).rejects.toThrow("Hawk query failed");
  });
});
