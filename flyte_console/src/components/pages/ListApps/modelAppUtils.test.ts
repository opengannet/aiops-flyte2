/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AppSchema, InputSchema } from "@/gen/flyteidl2/app/app_definition_pb";
import {
  ContainerSchema,
  K8sPodSchema,
  Resources_ResourceName,
  ResourcesSchema,
} from "@/gen/flyteidl2/core/tasks_pb";
import {
  buildCreateModelAppRequest,
  extractAppResourceSummary,
  extractModelCloudStorageMounts,
  normalizeModelImageInput,
  splitModelParam,
} from "./modelAppUtils";

describe("model app helpers", () => {
  it("builds CreateModelAppRequest from form values", () => {
    const request = buildCreateModelAppRequest({
      org: "flyte",
      project: "flytesnacks",
      domain: "development",
      values: {
        name: " Qwen VLLM ",
        id: " qwen-vllm ",
        code: " qwen-local ",
        image: "vllm",
        param: "--served-model-name\nqwen-local",
        codes: [
          {
            id: " https://git.example.com/team/qwen.git ",
            branch: " main ",
            path: "",
            token: "secret-token",
          },
        ],
        cpu: " 4 ",
        memory: " 16Gi ",
        gpu: "2",
        gpuKey: "example.com/gpu",
        cloudStorageMounts: [
          {
            cloudStorageId: " storage-a ",
            mountPath: " /mnt/models ",
          },
          {
            cloudStorageId: "storage-b",
            mountPath: "/mnt/checkpoints",
          },
        ],
      },
    });

    expect(request.model?.project).toBe("flytesnacks");
    expect(request.model?.domain).toBe("development");
    expect(request.model?.name).toBe("Qwen VLLM");
    expect(request.model?.id).toBe("qwen-vllm");
    expect(request.model?.code).toBe("qwen-local");
    expect(request.model?.image).toBe("vllm");
    expect(request.model?.codes[0]).toMatchObject({
      id: "https://git.example.com/team/qwen.git",
      branch: "main",
      token: "secret-token",
    });
    expect(request.model?.resourceDefinition).toMatchObject({
      cpu: "4",
      memory: "16Gi",
      gpu: 2,
      gpuKey: "example.com/gpu",
    });
    expect(request.model?.cloudStorageMounts).toEqual([
      expect.objectContaining({
        cloudStorageId: "storage-a",
        mountPath: "/mnt/models",
      }),
      expect.objectContaining({
        cloudStorageId: "storage-b",
        mountPath: "/mnt/checkpoints",
      }),
    ]);
  });

  it("splits params only on newlines and keeps image aliases stable", () => {
    expect(
      splitModelParam("--host\r\n0.0.0.0\n--served-model-name qwen"),
    ).toEqual(["--host", "0.0.0.0", "--served-model-name qwen"]);
    expect(normalizeModelImageInput("")).toBe("vllm");
    expect(normalizeModelImageInput(" VLLM ")).toBe("vllm");
    expect(normalizeModelImageInput("registry.local/vllm:prod")).toBe(
      "registry.local/vllm:prod",
    );
  });

  it("extracts resources from container and pod App specs", () => {
    const containerApp = create(AppSchema, {
      spec: {
        appPayload: {
          case: "container",
          value: create(ContainerSchema, {
            resources: create(ResourcesSchema, {
              requests: [
                { name: Resources_ResourceName.CPU, value: "2" },
                { name: Resources_ResourceName.MEMORY, value: "8Gi" },
                { name: Resources_ResourceName.GPU, value: "1" },
              ],
              limits: [{ name: Resources_ResourceName.MEMORY, value: "8Gi" }],
            }),
          }),
        },
      },
    });
    expect(extractAppResourceSummary(containerApp).requests).toMatchObject({
      CPU: "2",
      Memory: "8Gi",
      GPU: "1",
    });

    const podApp = create(AppSchema, {
      spec: {
        appPayload: {
          case: "pod",
          value: create(K8sPodSchema, {
            primaryContainerName: "vllm",
            podSpec: {
              containers: [
                {
                  name: "vllm",
                  resources: {
                    requests: {
                      cpu: "4",
                      memory: "16Gi",
                      "example.com/gpu": "2",
                    },
                    limits: {
                      cpu: "4",
                      memory: "16Gi",
                      "example.com/gpu": "2",
                    },
                  },
                },
              ],
            },
          }),
        },
        inputs: {
          items: [
            create(InputSchema, {
              name: "gpu_key",
              value: { case: "stringValue", value: "example.com/gpu" },
            }),
          ],
        },
      },
    });

    expect(extractAppResourceSummary(podApp)).toEqual({
      requests: {
        CPU: "4",
        Memory: "16Gi",
        GPU: "2",
        "GPU Key": "example.com/gpu",
        "Ephemeral Storage": undefined,
      },
      limits: {
        CPU: "4",
        Memory: "16Gi",
        GPU: "2",
        "GPU Key": "example.com/gpu",
        "Ephemeral Storage": undefined,
      },
    });
  });

  it("extracts model cloud storage ids, PVCs, and mount paths from the pod spec", () => {
    const app = create(AppSchema, {
      spec: {
        appPayload: {
          case: "pod",
          value: create(K8sPodSchema, {
            primaryContainerName: "vllm",
            podSpec: {
              volumes: [
                {
                  name: "models",
                  persistentVolumeClaim: { claimName: "model-cache" },
                },
                {
                  name: "cloud-storage-0",
                  persistentVolumeClaim: { claimName: "cs-storage-a" },
                },
              ],
              containers: [
                {
                  name: "vllm",
                  volumeMounts: [
                    { name: "cloud-storage-0", mountPath: "/mnt/storage-a" },
                  ],
                },
              ],
            },
          }),
        },
      },
    });

    expect(extractModelCloudStorageMounts(app)).toEqual([
      {
        cloudStorageId: "storage-a",
        pvcName: "cs-storage-a",
        mountPath: "/mnt/storage-a",
      },
    ]);
  });
});
