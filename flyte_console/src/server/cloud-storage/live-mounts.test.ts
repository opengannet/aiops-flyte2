import { beforeEach, describe, expect, it, vi } from "vitest";

const requestKubernetesMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/kubernetes/client", () => ({
  requestKubernetes: requestKubernetesMock,
}));

import { loadCloudStorageLiveMounts } from "./live-mounts";

describe("loadCloudStorageLiveMounts", () => {
  beforeEach(() => vi.resetAllMocks());

  it("maps only running Pod references to canonical cloud storage PVCs", async () => {
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => ({
        items: [
          pod("writer-b", "Running", ["cs-stg-1"]),
          pod("writer-a", "Running", ["cs-stg-1", "cs-stg-1"]),
          pod("finished", "Succeeded", ["cs-stg-2"]),
          pod("pending", "Pending", ["cs-stg-2"]),
        ],
      }),
    });

    const mounts = await loadCloudStorageLiveMounts({
      apiOrigin: "https://kube",
      namespace: "flyte",
      token: "token",
      ca: "ca",
      storageIds: ["stg-1", "stg-2", "Store_A"],
    });

    expect(mounts).toEqual({
      "stg-1": ["writer-a", "writer-b"],
      "stg-2": [],
      Store_A: [],
    });
    expect(requestKubernetesMock).toHaveBeenCalledTimes(1);
  });
});

function pod(name: string, phase: string, claims: string[]) {
  return {
    metadata: { name },
    status: { phase },
    spec: {
      volumes: claims.map((claimName) => ({
        persistentVolumeClaim: { claimName },
      })),
    },
  };
}
