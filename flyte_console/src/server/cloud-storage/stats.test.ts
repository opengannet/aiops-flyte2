import { beforeEach, describe, expect, it, vi } from "vitest";

const requestKubernetesMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/kubernetes/client", () => ({
  requestKubernetes: requestKubernetesMock,
}));

import { loadCloudStoragePvcStats } from "@/server/cloud-storage/stats";

function response(json: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => json,
  };
}

function pvc(
  name: string,
  namespace: string,
  volumeName: string,
  capacity = "2Gi",
) {
  return {
    metadata: { name, namespace },
    spec: {
      volumeName,
      storageClassName: "bj1-ebs",
      resources: { requests: { storage: "3Gi" } },
    },
    status: { phase: "Bound", capacity: { storage: capacity } },
  };
}

function cloudStorage(
  materializations: Array<{ targetNamespace: string; pvcName: string }>,
) {
  return {
    id: { id: "stg-1" },
    materializations,
    targetNamespace: materializations[0]?.targetNamespace ?? "flyte",
    pvcName: materializations[0]?.pvcName ?? "",
  } as never;
}

describe("loadCloudStoragePvcStats", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps provisioned capacity separate and prefers a complete kubelet sample", async () => {
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("persistentvolumeclaims/cs-stg-1")) {
        return response(pvc("cs-stg-1", "flyte", "pv-data"));
      }
      if (url.includes("/pods?")) {
        return response({
          items: [
            {
              metadata: { name: "writer", namespace: "flyte" },
              spec: {
                nodeName: "node-a",
                volumes: [
                  { persistentVolumeClaim: { claimName: "cs-stg-1" } },
                ],
              },
              status: { phase: "Running" },
            },
          ],
        });
      }
      if (url.includes("/nodes/node-a/proxy/stats/summary")) {
        return response({
          pods: [
            {
              podRef: { name: "writer", namespace: "flyte" },
              volume: [
                {
                  pvcRef: { name: "cs-stg-1", namespace: "flyte" },
                  capacityBytes: 1_000,
                  usedBytes: 250,
                  availableBytes: 700,
                  time: "2026-07-31T01:02:03Z",
                },
              ],
            },
          ],
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const loadHawkHistory = vi.fn();

    const result = await loadCloudStoragePvcStats(
      {
        apiOrigin: "https://kube",
        namespace: "flyte",
        token: "token",
        ca: "ca",
        storageId: "stg-1",
        cloudStorage: cloudStorage([
          { targetNamespace: "flyte", pvcName: "data" },
        ]),
      },
      { loadHawkHistory },
    );

    expect(result.pvcs[0]).toMatchObject({
      capacityBytes: 2 * 1024 ** 3,
      filesystemCapacityBytes: 1_000,
      usedBytes: 250,
      availableBytes: 700,
      usagePercent: 25,
      statsSource: "kubelet",
      statsTime: "2026-07-31T01:02:03Z",
    });
    expect(loadHawkHistory).not.toHaveBeenCalled();
  });

  it("discards an incomplete kubelet sample and uses one complete Hawk sample", async () => {
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("persistentvolumeclaims/cs-stg-1")) {
        return response(pvc("cs-stg-1", "flyte", "pv-data"));
      }
      if (url.includes("/pods?")) {
        return response({
          items: [
            {
              metadata: { name: "writer", namespace: "flyte" },
              spec: {
                nodeName: "node-a",
                volumes: [
                  { persistentVolumeClaim: { claimName: "cs-stg-1" } },
                ],
              },
              status: { phase: "Running" },
            },
          ],
        });
      }
      if (url.includes("/nodes/node-a/proxy/stats/summary")) {
        return response({
          pods: [
            {
              podRef: { name: "writer", namespace: "flyte" },
              volume: [
                {
                  pvcRef: { name: "cs-stg-1", namespace: "flyte" },
                  capacityBytes: 1_000,
                  usedBytes: 999,
                },
              ],
            },
          ],
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const loadHawkHistory = vi.fn().mockResolvedValue({
      filesystemCapacityBytes: 800,
      usedBytes: 200,
      availableBytes: 600,
      usagePercent: 25,
      statsTime: "2026-07-30T00:00:00Z",
    });

    const result = await loadCloudStoragePvcStats(
      {
        apiOrigin: "https://kube",
        namespace: "flyte",
        token: "token",
        ca: "ca",
        storageId: "stg-1",
        cloudStorage: cloudStorage([
          { targetNamespace: "flyte", pvcName: "data" },
        ]),
      },
      { loadHawkHistory },
    );

    expect(loadHawkHistory).toHaveBeenCalledWith({
      volumeName: "pv-data",
    });
    expect(result.pvcs[0]).toMatchObject({
      filesystemCapacityBytes: 800,
      usedBytes: 200,
      availableBytes: 600,
      usagePercent: 25,
      statsSource: "hawk_history",
      statsTime: "2026-07-30T00:00:00Z",
    });
  });

  it("ignores legacy materializations in other namespaces when the canonical PVC exists", async () => {
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("namespaces/team-a/persistentvolumeclaims/cs-stg-1")) {
        return response(pvc("cs-stg-1", "team-a", "pv-a"));
      }
      if (url.includes("/pods?")) {
        const namespace = url.includes("namespaces/team-a/")
          ? "team-a"
          : "team-b";
        return response({
          items: [
            {
              metadata: { name: `pod-${namespace}`, namespace },
              spec: {
                volumes: [
                  { persistentVolumeClaim: { claimName: "cs-stg-1" } },
                ],
              },
              status: { phase: "Running" },
            },
          ],
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const loadHawkHistory = vi.fn().mockResolvedValue(null);

    const result = await loadCloudStoragePvcStats(
      {
        apiOrigin: "https://kube",
        namespace: "team-a",
        token: "token",
        ca: "ca",
        storageId: "stg-1",
        cloudStorage: cloudStorage([
          { targetNamespace: "team-a", pvcName: "data" },
          { targetNamespace: "team-b", pvcName: "data" },
        ]),
      },
      { loadHawkHistory },
    );

    expect(result.pvcs.map(({ namespace, name }) => `${namespace}/${name}`))
      .toEqual(["team-a/cs-stg-1"]);
    expect(
      requestKubernetesMock.mock.calls
        .map(([input]) => input.url)
        .filter((url) => url.includes("/pods?")),
    ).toEqual([expect.stringContaining("namespaces/team-a/pods?")]);
    expect(loadHawkHistory.mock.calls.map(([input]) => input.volumeName))
      .toEqual(["pv-a"]);
    expect(result.pvcs.map(({ mountedBy }) => mountedBy)).toEqual([
      ["pod-team-a"],
    ]);
  });

  it("returns unavailable without querying by PVC name when the PV name is absent", async () => {
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("persistentvolumeclaims/cs-stg-1")) {
        const item = pvc("cs-stg-1", "flyte", "");
        delete item.spec.volumeName;
        return response(item);
      }
      if (url.includes("/pods?")) {
        return response({ items: [] });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const loadHawkHistory = vi.fn();

    const result = await loadCloudStoragePvcStats(
      {
        apiOrigin: "https://kube",
        namespace: "flyte",
        token: "token",
        ca: "ca",
        storageId: "stg-1",
        cloudStorage: cloudStorage([
          { targetNamespace: "flyte", pvcName: "data" },
        ]),
      },
      { loadHawkHistory },
    );

    expect(loadHawkHistory).not.toHaveBeenCalled();
    expect(result.pvcs[0]).toMatchObject({
      filesystemCapacityBytes: null,
      usedBytes: null,
      availableBytes: null,
      usagePercent: null,
      statsSource: "unavailable",
      statsTime: null,
    });
    expect(result.warnings[0]).toContain("flyte/cs-stg-1");
  });

  it("loads Hawk history only for the canonical PVC", async () => {
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("persistentvolumeclaims/cs-stg-1")) {
        return response(pvc("cs-stg-1", "flyte", "pv-1"));
      }
      if (url.includes("/pods?")) {
        return response({ items: [] });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    let active = 0;
    let maximumActive = 0;
    const loadHawkHistory = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return null;
    });

    await loadCloudStoragePvcStats(
      {
        apiOrigin: "https://kube",
        namespace: "flyte",
        token: "token",
        ca: "ca",
        storageId: "stg-1",
        cloudStorage: cloudStorage([]),
      },
      { loadHawkHistory },
    );

    expect(loadHawkHistory).toHaveBeenCalledTimes(1);
    expect(maximumActive).toBe(1);
  });
});
