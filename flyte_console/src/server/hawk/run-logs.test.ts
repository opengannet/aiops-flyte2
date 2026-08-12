import { afterEach, describe, expect, it, vi } from "vitest";

import { LogLineOriginator } from "@/gen/flyteidl2/logs/dataplane/payload_pb";
import { getHawkContainerLogs, getHawkRunLogs } from "@/server/hawk/run-logs";

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
    vi.unstubAllEnvs();
  });

  it("queries Hawk with one container id regex", async () => {
    vi.stubEnv("HAWK_API_URL", "https://hawk.example/base");
    vi.stubEnv("HAWK_API_KEY", "hawk-key");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [{ timestamp: 100123, message: "ready" }],
      }),
    } as Response);

    const result = await getHawkContainerLogs({
      containerIdRegex: "^/k8s/flyte/qwen-app-[^/-]+-[^/-]+/vllm$",
      start: 100,
      end: 200,
      limit: 10000,
    });

    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/api/v1/logs");
    expect(url.searchParams.getAll("container_id")).toEqual([]);
    expect(url.searchParams.get("container_id_regex")).toBe(
      "^/k8s/flyte/qwen-app-[^/-]+-[^/-]+/vllm$",
    );
    expect(url.searchParams.get("from")).toBe("100000");
    expect(url.searchParams.get("to")).toBe("200000");
    expect(url.searchParams.get("limit")).toBe("10000");
    expect(init?.headers).toEqual({ "X-API-Key": "hawk-key" });
    expect(result).toEqual([
      {
        timestamp: { seconds: 100, nanos: 123000000 },
        message: "ready",
        originator: LogLineOriginator.USER,
      },
    ]);
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

  it("does not stop the log query window at the last completed phase for a running attempt", async () => {
    vi.spyOn(Date, "now").mockReturnValue(3000 * 1000);
    const queryHawkLogs = vi.fn(async () => ({ entries: [], limit: 5000 }));

    await getHawkRunLogs(baseParams, {
      getActionDetails: async () =>
        ({
          attempts: [
            {
              attempt: 2,
              phase: 4,
              startTime: { seconds: 2000n, nanos: 0 },
              phaseTransitions: [
                {
                  startTime: { seconds: 2000n, nanos: 0 },
                  endTime: { seconds: 2060n, nanos: 0 },
                },
                {
                  startTime: { seconds: 2060n, nanos: 0 },
                  endTime: { seconds: 2090n, nanos: 0 },
                },
                {
                  startTime: { seconds: 2090n, nanos: 0 },
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
      expect.objectContaining({ start: 1970, end: 3000 }),
    );
  });
});
