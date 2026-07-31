import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getCloudStorageMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn(() => ({
      getCloudStorage: getCloudStorageMock,
    })),
  };
});

vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: vi.fn(() => ({})),
}));

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
  requestKubernetes: requestKubernetesMock,
}));

const cloudStorage = {
  id: {
    org: "aione",
    project: "aione",
    domain: "development",
    id: "stg-1",
  },
  name: "stg-1",
  description: "Auto-registered from external API datastore",
  sizeGb: 2,
  storageClassName: "bj1-ebs",
  targetNamespace: "flyte",
  pvcName: "pvc-1",
  creator: "external-system",
  materializations: [
    {
      targetNamespace: "flyte",
      pvcName: "pvc-1",
    },
  ],
};

describe("cloud storage stats route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getCloudStorageMock.mockResolvedValue({ cloudStorage });
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
  });

  it("returns PVC usage from kubelet volume stats", async () => {
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("/persistentvolumeclaims?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => ({
            items: [
              {
                metadata: {
                  name: "pvc-1",
                  namespace: "flyte",
                },
                spec: {
                  resources: {
                    requests: {
                      storage: "2Gi",
                    },
                  },
                  storageClassName: "bj1-ebs",
                },
                status: {
                  phase: "Bound",
                  capacity: {
                    storage: "2Gi",
                  },
                },
              },
            ],
          }),
        });
      }
      if (url.includes("/pods?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => ({
            items: [
              {
                metadata: { name: "pod-a", namespace: "flyte" },
                spec: {
                  nodeName: "node-a",
                  volumes: [
                    { persistentVolumeClaim: { claimName: "pvc-1" } },
                  ],
                },
                status: { phase: "Running" },
              },
            ],
          }),
        });
      }
      if (url.includes("/nodes/node-a/proxy/stats/summary")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => ({
            pods: [
              {
                podRef: {
                  name: "pod-a",
                  namespace: "flyte",
                },
                volume: [
                  {
                    name: "cloud-storage-0",
                    time: "2026-06-25T02:36:15Z",
                    usedBytes: 1048576,
                    capacityBytes: 2147483648,
                    availableBytes: 2146435072,
                    inodesUsed: 11,
                    inodes: 65536,
                    inodesFree: 65525,
                    pvcRef: {
                      name: "pvc-1",
                      namespace: "flyte",
                    },
                  },
                ],
              },
            ],
          }),
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/cloud-storages/stg-1/stats?org=aione&project=aione&domain=development",
      ),
      { params: Promise.resolve({ storageId: "stg-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.cloudStorage.id).toBe("stg-1");
    expect(body.data.pvcs).toEqual([
      expect.objectContaining({
        name: "pvc-1",
        namespace: "flyte",
        phase: "Bound",
        requestedBytes: 2147483648,
        capacityBytes: 2147483648,
        filesystemCapacityBytes: 2147483648,
        usedBytes: 1048576,
        availableBytes: 2146435072,
        usagePercent: 0.05,
        statsSource: "kubelet",
        mountedBy: ["pod-a"],
        nodeName: "node-a",
        statsTime: "2026-06-25T02:36:15Z",
      }),
    ]);
    expect(body.data.warnings).toEqual([]);
  });

  it("keeps PVC rows when kubelet usage stats are unavailable", async () => {
    requestKubernetesMock.mockImplementation(({ url }) => {
      if (url.includes("/persistentvolumeclaims?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => ({
            items: [
              {
                metadata: {
                  name: "pvc-1",
                  namespace: "flyte",
                },
                spec: {
                  resources: {
                    requests: {
                      storage: "2Gi",
                    },
                  },
                  storageClassName: "bj1-ebs",
                },
                status: {
                  phase: "Bound",
                  capacity: {
                    storage: "2Gi",
                  },
                },
              },
            ],
          }),
        });
      }
      if (url.includes("/pods?")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => ({ items: [] }),
        });
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/cloud-storages/stg-1/stats?org=aione&project=aione&domain=development",
      ),
      { params: Promise.resolve({ storageId: "stg-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.pvcs[0]).toMatchObject({
      name: "pvc-1",
      usedBytes: null,
      filesystemCapacityBytes: null,
      availableBytes: null,
      usagePercent: null,
      statsSource: "unavailable",
      statsTime: null,
      mountedBy: [],
      nodeName: "",
    });
    expect(body.data.warnings).toEqual([
      "PVC flyte/pvc-1 has no PV name; usage is unavailable",
    ]);
  });
});
