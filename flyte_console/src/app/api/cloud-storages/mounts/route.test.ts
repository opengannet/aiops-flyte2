import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const loadCloudStorageLiveMountsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
}));
vi.mock("@/server/cloud-storage/live-mounts", () => ({
  loadCloudStorageLiveMounts: loadCloudStorageLiveMountsMock,
}));

describe("cloud storage live mounts route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kube",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    loadCloudStorageLiveMountsMock.mockResolvedValue({ "stg-1": ["pod-a"] });
  });

  it("returns live mounts for a batch of storage ids", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/cloud-storages/mounts", {
        method: "POST",
        body: JSON.stringify({ storageIds: ["stg-1"] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 200,
      data: { mounts: { "stg-1": ["pod-a"] } },
    });
  });

  it("rejects a non-array storageIds value", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/cloud-storages/mounts", {
        method: "POST",
        body: JSON.stringify({ storageIds: "stg-1" }),
      }),
    );

    expect(response.status).toBe(400);
  });
});
