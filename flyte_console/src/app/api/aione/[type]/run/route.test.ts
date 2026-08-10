import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Code, ConnectError } from "@connectrpc/connect";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";

const createRunMock = vi.hoisted(() => vi.fn());
const getRunDetailsMock = vi.hoisted(() => vi.fn());
const getTrainingTaskByIdMock = vi.hoisted(() => vi.fn());
const createTrainingTaskMock = vi.hoisted(() => vi.fn());
const createModelAppMock = vi.hoisted(() => vi.fn());
const startTrainingTaskMock = vi.hoisted(() => vi.fn());
const createCodeRepositoryMock = vi.hoisted(() => vi.fn());
const getDevelopmentInstanceByIdMock = vi.hoisted(() => vi.fn());
const createDevelopmentInstanceMock = vi.hoisted(() => vi.fn());
const startDevelopmentInstanceMock = vi.hoisted(() => vi.fn());
const ensureCloudStorageMock = vi.hoisted(() => vi.fn());
const materializeCloudStorageMock = vi.hoisted(() => vi.fn());
const getKubernetesClientConfigMock = vi.hoisted(() => vi.fn());
const requestKubernetesMock = vi.hoisted(() => vi.fn());

vi.mock("@connectrpc/connect", async () => {
  const actual = await vi.importActual<typeof import("@connectrpc/connect")>(
    "@connectrpc/connect",
  );
  return {
    ...actual,
    createClient: vi.fn((service: { typeName?: string }) =>
      service.typeName === "flyteidl2.trainingtask.TrainingTaskService"
        ? {
            getTrainingTaskById: getTrainingTaskByIdMock,
            createTrainingTask: createTrainingTaskMock,
            startTrainingTask: startTrainingTaskMock,
          }
        : service.typeName === "flyteidl2.app.AppService"
          ? {
              createModelApp: createModelAppMock,
            }
          : service.typeName ===
              "flyteidl2.developmentinstance.DevelopmentInstanceService"
            ? {
                getDevelopmentInstanceById: getDevelopmentInstanceByIdMock,
                createDevelopmentInstance: createDevelopmentInstanceMock,
                startDevelopmentInstance: startDevelopmentInstanceMock,
              }
            : service.typeName ===
                "flyteidl2.aione.cloudstorage.CloudStorageService"
              ? {
                  ensureCloudStorage: ensureCloudStorageMock,
                  materializeCloudStorage: materializeCloudStorageMock,
                }
              : service.typeName ===
                  "flyteidl2.aione.coderepository.CodeRepositoryService"
                ? {
                    createCodeRepository: createCodeRepositoryMock,
                  }
                : {
                    createRun: createRunMock,
                    getRunDetails: getRunDetailsMock,
                  },
    ),
  };
});

vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: vi.fn(() => ({})),
}));

vi.mock("@/server/kubernetes/client", () => ({
  getKubernetesClientConfig: getKubernetesClientConfigMock,
  requestKubernetes: requestKubernetesMock,
}));

const instancePayload = {
  org: "external-system",
  project: "aione",
  domain: "development",
  name: "开发实例一",
  id: "ins-contract-1",
  timeout: 1,
  imageType: "BASE",
  baseImage: {
    image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
  },
  resourceDefinition: {
    cpu: "2",
    memory: "4Gi",
  },
};

const taskPayload = {
  ...instancePayload,
  type: "INSTANCE",
  name: "外部训练任务",
  id: "task-contract-1",
  cmd: "python train.py",
  imageType: "OWN",
  image: "docker.fzyun.io/founder/train:1.0.0",
  resourceDefinition: {
    cpu: "3",
    memory: "7Gi",
    gpu: 2,
    gpu_key: "nvidia.com/gpu",
  },
};

const modelPayload = {
  org: "external-system",
  project: "aione",
  domain: "development",
  name: "Qwen VLLM",
  id: "qwen-vllm",
  code: "qwen-local",
  profile: "VLLM",
  param: "--served-model-name\nqwen-local",
  codes: [
    {
      id: "https://git.example.com/team/qwen.git",
      branch: "main",
      token: "model-token",
    },
  ],
  resourceDefinition: {
    cpu: "4",
    memory: "16Gi",
    gpu: 1,
    gpu_key: "example.com/gpu",
  },
};

const existingTrainingTask = {
  id: {
    org: "aione",
    project: "aione",
    domain: "development",
    id: "task-contract-1",
  },
  name: "外部训练任务",
  latestRunName: "old-run",
};

let cleanupApiDebugEnvFile: (() => void) | undefined;

function useApiDebugEnvFile(content: string) {
  cleanupApiDebugEnvFile?.();
  const directory = mkdtempSync(join(tmpdir(), "aione-api-debug-"));
  const envPath = join(directory, ".env");
  writeFileSync(envPath, content);
  cleanupApiDebugEnvFile = () =>
    rmSync(directory, { recursive: true, force: true });
  vi.stubEnv("API_DEBUG_ENV_FILE", envPath);
}

describe("aione external typed run route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    useApiDebugEnvFile("API_DEBUG=False\n");
    vi.stubEnv("EXTERNAL_API_DEFAULT_AUTHORIZED_KEY", "ssh-ed25519 AAAA test");
    getKubernetesClientConfigMock.mockResolvedValue({
      apiOrigin: "https://kubernetes.default.svc",
      namespace: "flyte",
      token: "token",
      ca: "ca",
    });
    requestKubernetesMock.mockResolvedValue({
      ok: true,
      json: () => ({ items: [] }),
    });
    createRunMock.mockResolvedValue({});
    getDevelopmentInstanceByIdMock.mockRejectedValue(
      new ConnectError("development instance not found", Code.NotFound),
    );
    createDevelopmentInstanceMock.mockResolvedValue({
      developmentInstance: {
        id: { id: "ins-contract-1" },
      },
    });
    startDevelopmentInstanceMock.mockResolvedValue({
      runName: "ins-contract-1-r1",
      developmentInstance: {
        id: { id: "ins-contract-1" },
        latestRunName: "ins-contract-1-r1",
        access: {
          sshUser: "dev",
          nodePort: 31000,
          codeServerUrl: "https://ins-contract-1-r1-code.ops.fzyun.io",
          codeServerWorkspaceUrl: "https://ins-contract-1-r1-code.ops.fzyun.io",
        },
      },
    });
    ensureCloudStorageMock.mockResolvedValue({
      cloudStorage: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "stg-external-1",
        },
      },
    });
    materializeCloudStorageMock.mockResolvedValue({});
    createCodeRepositoryMock.mockResolvedValue({
      codeRepository: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "cr-auto-1",
        },
      },
    });
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.SUCCEEDED,
          },
          result: { case: undefined },
        },
      },
    });
    createTrainingTaskMock.mockResolvedValue({
      trainingTask: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "task-contract-1",
        },
        name: "外部训练任务",
      },
    });
    createModelAppMock.mockResolvedValue({
      app: {
        metadata: {
          id: {
            org: "aione",
            project: "aione",
            domain: "development",
            name: "qwen-vllm",
          },
        },
        spec: {
          profile: {
            type: "VLLM",
          },
        },
        status: {
          ingress: {
            publicUrl: "http://qwen-vllm-aione-development.example.com",
          },
        },
      },
    });
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("training task not found", Code.NotFound),
    );
    startTrainingTaskMock.mockResolvedValue({
      trainingTask: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          id: "task-contract-1",
        },
        name: "外部训练任务",
        latestRunName: "task-contract-1-run",
      },
      runName: "task-contract-1-run",
    });
  });

  afterEach(() => {
    cleanupApiDebugEnvFile?.();
    cleanupApiDebugEnvFile = undefined;
    vi.unstubAllEnvs();
  });

  it("rejects requests without an external API key using the public envelope", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instance/run", {
        method: "POST",
        body: JSON.stringify(instancePayload),
      }),
      { params: Promise.resolve({ type: "instance" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: 401, message: "unauthorized" });
  });

  it("does not print external API requests when .env API_DEBUG is not True", async () => {
    vi.stubEnv("API_DEBUG", "True");
    const consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/v2/api/aione/instance/run", {
          method: "POST",
          headers: { authorization: "Bearer external-key" },
          body: JSON.stringify(instancePayload),
        }),
        { params: Promise.resolve({ type: "instance" }) },
      );

      expect(response.status).toBe(200);
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it("prints a redacted external API request when .env API_DEBUG is True", async () => {
    useApiDebugEnvFile("API_DEBUG=True\n");
    const consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      const { POST } = await import("./route");
      const response = await POST(
        new NextRequest("http://localhost/v2/api/aione/instance/run?trace=1", {
          method: "POST",
          headers: { authorization: "Bearer external-key" },
          body: JSON.stringify({
            ...instancePayload,
            authorizedKey: "ssh-ed25519 AAAA debug-key",
            imageSecret: "registry-secret",
            content: JSON.stringify({
              codes: [
                {
                  token: "content-token",
                },
              ],
            }),
            codes: [
              {
                id: "code-1",
                branch: "main",
                path: "/workspace/code",
                token: "code-token",
              },
            ],
            ossDatas: [
              {
                endpoint: "minio.flyte.svc",
                port: "9000",
                accessKey: "dataset-access-key",
                secretKey: "dataset-secret-key",
                targetPath: "/workspace/data",
                bucket: "style-transfer",
                bucketPath: "inputs",
              },
            ],
          }),
        }),
        { params: Promise.resolve({ type: "instance" }) },
      );

      expect(response.status).toBe(200);
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy.mock.calls[0][0]).toBe(
        "[aione-api-debug] external request",
      );
      const debugRequest = JSON.parse(String(consoleInfoSpy.mock.calls[0][1]));
      expect(debugRequest).toEqual(
        expect.objectContaining({
          method: "POST",
          pathname: "/v2/api/aione/instance/run",
          search: "?trace=1",
          type: "instance",
          payload: expect.objectContaining({
            authorizedKey: "[REDACTED]",
            imageSecret: "[REDACTED]",
            codes: [
              expect.objectContaining({
                token: "[REDACTED]",
              }),
            ],
            ossDatas: [
              expect.objectContaining({
                endpoint: "minio.flyte.svc",
                accessKey: "[REDACTED]",
                secretKey: "[REDACTED]",
                bucket: "style-transfer",
              }),
            ],
          }),
        }),
      );
      const serializedLog = JSON.stringify(consoleInfoSpy.mock.calls[0]);
      expect(serializedLog).not.toContain("Bearer external-key");
      expect(serializedLog).not.toContain("debug-key");
      expect(serializedLog).not.toContain("registry-secret");
      expect(serializedLog).not.toContain("code-token");
      expect(serializedLog).not.toContain("content-token");
      expect(serializedLog).not.toContain("dataset-access-key");
      expect(serializedLog).not.toContain("dataset-secret-key");
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it("creates an instance run from the instance path and ignores body type", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instance/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({
          ...instancePayload,
          type: "TASK",
          codes: [
            {
              id: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
              branch: "master",
              path: "/data/js-sample",
              token: "code-token",
            },
          ],
          datasets: [
            {
              endpoint: "ignored.dataset.svc",
              port: "9000",
              accessKey: "ignored",
              secretKey: "ignored",
              targetPath: "/ignored",
              bucket: "ignored",
            },
          ],
          ossDatas: [
            {
              endpoint: "minio.flyte.svc",
              port: 9000,
              accessKey: "dataset-access-key",
              secretKey: "dataset-secret-key",
              targetPath: "/workspace/data",
              bucket: "style-transfer",
              bucketPath: "inputs",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ type: "instance" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createDevelopmentInstanceMock).toHaveBeenCalledTimes(1);
    expect(createDevelopmentInstanceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        developmentInstanceId: "ins-contract-1",
        developmentInstance: expect.objectContaining({
          name: "开发实例一",
          datasets: [
            expect.objectContaining({
              endpoint: "minio.flyte.svc",
              port: "9000",
              accessKey: "dataset-access-key",
              secretKey: "dataset-secret-key",
              targetPath: "/workspace/data",
              bucket: "style-transfer",
              bucketPath: "inputs",
            }),
          ],
          codeRepositoryDetails: [
            expect.objectContaining({
              id: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
              repoUrl:
                "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
              branch: "master",
              mountPath: "/data/js-sample",
              token: "code-token",
            }),
          ],
        }),
      }),
    );
    expect(startDevelopmentInstanceMock).toHaveBeenCalledTimes(1);
    expect(createRunMock).not.toHaveBeenCalled();
    expect(ensureCloudStorageMock).not.toHaveBeenCalled();
    expect(materializeCloudStorageMock).not.toHaveBeenCalled();
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(body.data.id).toBe("ins-contract-1");
    expect(body.data.info.codeServer.workspaceUrl).toBe(
      "https://ins-contract-1-r1-code.ops.fzyun.io",
    );
  });

  it("auto-registers and materializes external datastores around instance run creation", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/instance/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({
          ...instancePayload,
          datastores: [
            {
              id: "stg-external-1",
              path: "/data/store",
              size: 2,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ type: "instance" }) },
    );

    expect(response.status).toBe(200);
    expect(ensureCloudStorageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          org: "aione",
          project: "aione",
          domain: "development",
          id: "stg-external-1",
        }),
        cloudStorage: expect.objectContaining({
          name: "stg-external-1",
          description: "Auto-registered from external API datastore",
          sizeGb: 2,
          storageClassName: "bj1-ebs",
        }),
        creator: "external-system",
      }),
    );
    expect(startDevelopmentInstanceMock).toHaveBeenCalledTimes(1);
    expect(materializeCloudStorageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          org: "aione",
          project: "aione",
          domain: "development",
          id: "stg-external-1",
        }),
        targetNamespace: "flyte",
        pvcName: "cs-stg-external-1",
      }),
    );
    expect(ensureCloudStorageMock.mock.invocationCallOrder[0]).toBeLessThan(
      startDevelopmentInstanceMock.mock.invocationCallOrder[0],
    );
    expect(
      startDevelopmentInstanceMock.mock.invocationCallOrder[0],
    ).toBeLessThan(materializeCloudStorageMock.mock.invocationCallOrder[0]);
  });

  it("creates and starts a task run from the task path using the external id", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({
          ...taskPayload,
          codes: [
            {
              id: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
              branch: "master",
              path: "/data/js-sample",
              token: "code-token",
            },
          ],
          datastores: [
            {
              id: "stg-task-1",
              path: "/data/task-store",
              size: 3,
            },
          ],
          datasets: [
            {
              endpoint: "ignored.dataset.svc",
              port: "9000",
              accessKey: "ignored",
              secretKey: "ignored",
              targetPath: "/ignored",
              bucket: "ignored",
            },
          ],
          ossDatas: [
            {
              endpoint: "minio.flyte.svc",
              port: 9000,
              accessKey: "dataset-access-key",
              secretKey: "dataset-secret-key",
              targetPath: "/workspace/data",
              bucket: "style-transfer",
              bucketPath: "inputs",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createCodeRepositoryMock).toHaveBeenCalledTimes(1);
    expect(createCodeRepositoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({
          name: "aione",
          domain: "development",
        }),
        codeRepository: expect.objectContaining({
          repoUrl: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
          branch: "master",
          mountPath: "/data/js-sample",
          token: "code-token",
        }),
        creator: "external-system",
      }),
    );
    expect(getTrainingTaskByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-contract-1" }),
    );
    expect(createTrainingTaskMock).toHaveBeenCalledTimes(1);
    expect(createTrainingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trainingTaskId: "task-contract-1",
        project: expect.objectContaining({
          name: "aione",
          domain: "development",
        }),
        trainingTask: expect.objectContaining({
          name: "外部训练任务",
          command: "python train.py",
          codeRepositoryMounts: [
            expect.objectContaining({
              codeRepositoryId: "cr-auto-1",
              mountPath: "/data/js-sample",
            }),
          ],
          cloudStorageMounts: [
            expect.objectContaining({
              cloudStorageId: "stg-task-1",
              mountPath: "/data/task-store",
            }),
          ],
          datasets: [
            expect.objectContaining({
              endpoint: "minio.flyte.svc",
              port: "9000",
              accessKey: "dataset-access-key",
              secretKey: "dataset-secret-key",
              targetPath: "/workspace/data",
              bucket: "style-transfer",
              bucketPath: "inputs",
            }),
          ],
        }),
      }),
    );
    expect(ensureCloudStorageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({ id: "stg-task-1" }),
        cloudStorage: expect.objectContaining({
          name: "stg-task-1",
          sizeGb: 3,
          storageClassName: "bj1-ebs",
        }),
      }),
    );
    expect(startTrainingTaskMock).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      status: 200,
      data: {
        id: "task-contract-1",
        run: {
          org: "aione",
          project: "aione",
          domain: "development",
          name: "task-contract-1-run",
        },
        source: {
          org: "external-system",
          id: "task-contract-1",
        },
        task: {
          id: "task-contract-1",
          name: "外部训练任务",
          latestRunName: "task-contract-1-run",
        },
      },
    });
  });

  it("creates a model app from the model path", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/model/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(modelPayload),
      }),
      { params: Promise.resolve({ type: "model" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createModelAppMock).toHaveBeenCalledTimes(1);
    expect(createModelAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          org: "external-system",
          project: "aione",
          domain: "development",
          name: "Qwen VLLM",
          id: "qwen-vllm",
          code: "qwen-local",
          image: "vllm",
          param: "--served-model-name\nqwen-local",
          codes: [
            expect.objectContaining({
              id: "https://git.example.com/team/qwen.git",
              branch: "main",
              token: "model-token",
            }),
          ],
          resourceDefinition: expect.objectContaining({
            cpu: "4",
            memory: "16Gi",
            gpu: 1,
            gpuKey: "nvidia.com/gpu",
            gpuNodeLabelKey: "example.com/gpu",
          }),
        }),
      }),
    );
    expect(createDevelopmentInstanceMock).not.toHaveBeenCalled();
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(body).toEqual({
      status: 200,
      data: {
        id: "qwen-vllm",
        source: {
          org: "external-system",
          id: "qwen-vllm",
        },
        app: {
          org: "aione",
          project: "aione",
          domain: "development",
          name: "qwen-vllm",
          code: "qwen-local",
          profile: "VLLM",
          url: "http://qwen-vllm-aione-development.example.com",
        },
      },
    });
  });

  it("selects the model runtime from profile instead of image", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/model/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({
          ...modelPayload,
          image: "registry.example.com/ignored:latest",
        }),
      }),
      { params: Promise.resolve({ type: "model" }) },
    );

    expect(response.status).toBe(200);
    expect(createModelAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ image: "vllm" }),
      }),
    );
  });

  it("registers model datastores and passes their mounts to the model app", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/model/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({
          ...modelPayload,
          datastores: [
            {
              id: "stg-external-1",
              path: "/mnt/models",
              size: 2,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ type: "model" }) },
    );

    expect(response.status).toBe(200);
    expect(ensureCloudStorageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          org: "external-system",
          project: "aione",
          domain: "development",
          id: "stg-external-1",
        }),
        cloudStorage: expect.objectContaining({
          name: "stg-external-1",
          description: "Auto-registered from external API datastore",
          sizeGb: 2,
          storageClassName: "bj1-ebs",
        }),
        creator: "external-system",
      }),
    );
    expect(createModelAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          org: "external-system",
          cloudStorageMounts: [
            expect.objectContaining({
              cloudStorageId: "stg-external-1",
              mountPath: "/mnt/models",
            }),
          ],
        }),
      }),
    );
    expect(ensureCloudStorageMock.mock.calls[0][0].id.org).toBe(
      createModelAppMock.mock.calls[0][0].model.org,
    );
    expect(ensureCloudStorageMock.mock.invocationCallOrder[0]).toBeLessThan(
      createModelAppMock.mock.invocationCallOrder[0],
    );
  });

  it("requires cmd for task runs", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ ...taskPayload, cmd: "  " }),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "cmd is required" });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("does not accept legacy command for task runs", async () => {
    const { POST } = await import("./route");
    const legacyPayload: Record<string, unknown> = { ...taskPayload };
    delete legacyPayload.cmd;
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify({ ...legacyPayload, command: "python train.py" }),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ status: 400, message: "cmd is required" });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the external task id already has a running latest run", async () => {
    getTrainingTaskByIdMock.mockResolvedValue({
      trainingTask: existingTrainingTask,
    });
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.RUNNING,
          },
          result: { case: undefined },
        },
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "task is already running",
    });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(startTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the external task id latest run is paused", async () => {
    getTrainingTaskByIdMock.mockResolvedValue({
      trainingTask: existingTrainingTask,
    });
    getRunDetailsMock.mockResolvedValue({
      details: {
        action: {
          status: {
            phase: ActionPhase.PAUSED,
          },
          result: { case: undefined },
        },
      },
    });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "task is already running",
    });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(startTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("starts an existing training task when the external task id latest run is terminal", async () => {
    getTrainingTaskByIdMock.mockResolvedValue({
      trainingTask: existingTrainingTask,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(startTrainingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.objectContaining({
          id: "task-contract-1",
        }),
      }),
    );
    expect(body.data.id).toBe("task-contract-1");
    expect(body.data.task.id).toBe("task-contract-1");
    expect(body.data.task.latestRunName).toBe("task-contract-1-run");
  });

  it("returns 409 when the external task id matches multiple training tasks", async () => {
    getTrainingTaskByIdMock.mockRejectedValue(
      new ConnectError("task id is ambiguous", Code.FailedPrecondition),
    );

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/task/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(taskPayload),
      }),
      { params: Promise.resolve({ type: "task" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      status: 409,
      message: "task id is ambiguous",
    });
    expect(createTrainingTaskMock).not.toHaveBeenCalled();
    expect(startTrainingTaskMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported path types", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/v2/api/aione/note/run", {
        method: "POST",
        headers: { authorization: "Bearer external-key" },
        body: JSON.stringify(instancePayload),
      }),
      { params: Promise.resolve({ type: "note" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      status: 400,
      message: "type must be instance, task, or model",
    });
  });
});
