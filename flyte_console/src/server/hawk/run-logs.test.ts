import { afterEach, describe, expect, it, vi } from "vitest";

import { LogLineOriginator } from "@/gen/flyteidl2/logs/dataplane/payload_pb";
import { getHawkRunLogs } from "@/server/hawk/run-logs";

const baseParams = {
  org: "aione",
  project: "aione",
  domain: "development",
  runId: "run-a",
  actionId: "a0",
  attempt: 2,
};

describe("Hawk run logs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queries Hawk by selected attempt container and returns sorted JSON-safe log lines", async () => {
    const queryHawkLogs = vi.fn(async () => ({
      entries: [
        {
          timestamp: 101123,
          message: "second",
          severity: "warning",
          attributes: { "container.id": "/k8s/flyte/run-a-a0-0-0/ssh" },
          cluster: "admin",
        },
        {
          timestamp: 100000,
          message: "first",
          severity: "info",
          attributes: { "container.id": "/k8s/flyte/run-a-a0-0-0/ssh" },
          cluster: "admin",
        },
        {
          timestamp: 100000,
          message: "first",
          severity: "info",
          attributes: { "container.id": "/k8s/flyte/run-a-a0-0-0/ssh" },
          cluster: "admin",
        },
      ],
      limit: 5000,
    }));

    const result = await getHawkRunLogs(baseParams, {
      getActionDetails: async () =>
        ({
          attempts: [
            {
              attempt: 2,
              startTime: { seconds: 1000n, nanos: 0 },
              endTime: { seconds: 1120n, nanos: 0 },
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
      listPods: async () => [],
      queryHawkLogs,
    });

    expect(queryHawkLogs).toHaveBeenCalledWith({
      containerIds: ["/k8s/flyte/run-a-a0-0-0/ssh"],
      start: 970,
      end: 1150,
      limit: 5000,
    });
    expect(result.targets).toEqual([
      {
        namespace: "flyte",
        podName: "run-a-a0-0-0",
        containerName: "ssh",
        containerId: "/k8s/flyte/run-a-a0-0-0/ssh",
      },
    ]);
    expect(result.lines).toEqual([
      {
        timestamp: { seconds: 100, nanos: 0 },
        message: "first",
        originator: LogLineOriginator.USER,
      },
      {
        timestamp: { seconds: 101, nanos: 123000000 },
        message: "second",
        originator: LogLineOriginator.USER,
      },
    ]);
    expect(typeof result.lines[0].timestamp?.seconds).toBe("number");
  });

  it("falls back to phase transitions for the log query window", async () => {
    const queryHawkLogs = vi.fn(async () => ({ entries: [], limit: 5000 }));

    await getHawkRunLogs(baseParams, {
      getActionDetails: async () =>
        ({
          attempts: [
            {
              attempt: 2,
              phaseTransitions: [
                {
                  startTime: { seconds: 2000n, nanos: 0 },
                  endTime: { seconds: 2060n, nanos: 0 },
                },
              ],
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
      listPods: async () => [],
      queryHawkLogs,
    });

    expect(queryHawkLogs).toHaveBeenCalledWith(
      expect.objectContaining({ start: 1970, end: 2090 }),
    );
  });

  it("uses now as the end of the window for a running attempt", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3000 * 1000);
    const queryHawkLogs = vi.fn(async () => ({ entries: [], limit: 5000 }));

    await getHawkRunLogs(baseParams, {
      getActionDetails: async () =>
        ({
          attempts: [
            {
              attempt: 2,
              startTime: { seconds: 2000n, nanos: 0 },
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
      listPods: async () => [],
      queryHawkLogs,
    });

    expect(queryHawkLogs).toHaveBeenCalledWith(
      expect.objectContaining({ start: 1970, end: 3000 }),
    );
  });
});
