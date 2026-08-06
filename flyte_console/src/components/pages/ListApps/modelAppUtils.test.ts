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
  buildUpdateModelAppRequest,
  defaultModelAppFormValues,
  extractAppResourceSummary,
  extractModelCloudStorageMounts,
  modelAppConfigToFormValues,
  normalizeModelImageInput,
  splitModelParam,
  validateModelAppFormValues,
} from "./modelAppUtils";
import { ModelAppConfigSchema } from "@/gen/flyteidl2/app/app_payload_pb";

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
    expect(request.model?.cloudStorageMounts).toEqual([]);
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

  it("hydrates editable values from a redacted model app config without mounts", () => {
    const config = create(ModelAppConfigSchema, {
      appId: {
        org: "aione",
        project: "flytesnacks",
        domain: "development",
        name: "qwen25-15b",
      },
      name: "Qwen2.5 1.5B Instruct",
      code: "qwen25-15b",
      image: "vllm",
      param:
        "--served-model-name\nqwen25-15b\n--max-num-seqs\n16\n--max-model-len\n8192\n--enforce-eager",
      codes: [
        {
          id: "https://gitea.example/aione/qwen.git",
          branch: "main",
          path: "models/qwen",
          tokenConfigured: true,
        },
      ],
      resourceDefinition: {
        cpu: "4",
        memory: "16Gi",
        gpu: 1,
        gpuKey: "nvidia.com/gpu",
      },
      cloudStorageMounts: [
        { cloudStorageId: "Models@Prod", mountPath: "/mnt/models" },
      ],
    });

    expect(modelAppConfigToFormValues(config)).toEqual({
      name: "Qwen2.5 1.5B Instruct",
      id: "qwen25-15b",
      code: "qwen25-15b",
      image: "vllm",
      param:
        "--served-model-name\nqwen25-15b\n--max-num-seqs\n16\n--max-model-len\n8192\n--enforce-eager",
      codes: [
        {
          id: "https://gitea.example/aione/qwen.git",
          branch: "main",
          path: "models/qwen",
          token: "",
        },
      ],
      cpu: "4",
      memory: "16Gi",
      gpu: "1",
      gpuKey: "nvidia.com/gpu",
    });
  });

  it("builds an update request with editable fields only", () => {
    const request = buildUpdateModelAppRequest({
      appId: {
        org: "aione",
        project: "flytesnacks",
        domain: "development",
        name: "qwen25-15b",
      },
      values: {
        ...defaultModelAppFormValues,
        id: "qwen25-15b",
        code: "immutable-code",
        name: "Updated Qwen",
        image: "registry.example/vllm:latest",
        param: "--max-num-seqs\n16",
      },
    });

    expect(request).toMatchObject({
      appId: { name: "qwen25-15b" },
      name: "Updated Qwen",
      image: "registry.example/vllm:latest",
      param: "--max-num-seqs\n16",
      resourceDefinition: {
        cpu: "4",
        memory: "16Gi",
        gpu: 1,
        gpuKey: "nvidia.com/gpu",
      },
      cloudStorageMounts: [],
      reason: "console model app edit",
    });
    expect(request).not.toHaveProperty("code");
    expect(request).not.toHaveProperty("codes");
  });

  it("validates model app fields without cloud storage mount state", () => {
    expect(validateModelAppFormValues(defaultModelAppFormValues)).toBeNull();
  });

  it.each(["", " ", "1.5", "1gpu", "NaN", "-1"])(
    "rejects an invalid GPU count of %j",
    (gpu) => {
      expect(
        validateModelAppFormValues({
          ...defaultModelAppFormValues,
          gpu,
        }),
      ).toBe("GPU 必须是非负整数");
    },
  );

  it.each(["0", "1", "16"])("accepts a GPU count of %s", (gpu) => {
    expect(
      validateModelAppFormValues({
        ...defaultModelAppFormValues,
        gpu,
      }),
    ).toBeNull();
  });

  it("does not silently truncate an invalid GPU count in update requests", () => {
    expect(() =>
      buildUpdateModelAppRequest({
        appId: {
          org: "aione",
          project: "flytesnacks",
          domain: "development",
          name: "qwen25-15b",
        },
        values: {
          ...defaultModelAppFormValues,
          gpu: "1.5",
        },
      }),
    ).toThrow("GPU 必须是非负整数");
  });
});
