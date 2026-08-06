/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { create } from "@bufbuild/protobuf";

import {
  App,
  IdentifierSchema,
  Input,
} from "@/gen/flyteidl2/app/app_definition_pb";
import {
  CreateModelAppRequest,
  CreateModelAppRequestSchema,
  ModelAppConfig,
  ModelAppInputSchema,
  ModelCodeSourceSchema,
  ModelResourceDefinitionSchema,
  UpdateModelAppRequest,
  UpdateModelAppRequestSchema,
} from "@/gen/flyteidl2/app/app_payload_pb";
import {
  Resources,
  Resources_ResourceName,
} from "@/gen/flyteidl2/core/tasks_pb";

export type ModelCodeFormValue = {
  id: string;
  branch: string;
  path: string;
  token: string;
};

export type ModelAppFormValues = {
  name: string;
  id: string;
  code: string;
  image: string;
  param: string;
  codes: ModelCodeFormValue[];
  cpu: string;
  memory: string;
  gpu: string;
  gpuKey: string;
  modelCacheSize: string;
};

export type BuildModelAppRequestInput = {
  org: string;
  project: string;
  domain: string;
  values: ModelAppFormValues;
};

export type BuildUpdateModelAppRequestInput = {
  appId: {
    org: string;
    project: string;
    domain: string;
    name: string;
  };
  values: ModelAppFormValues;
};

export type AppResourceSummary = {
  requests: Record<string, string | undefined>;
  limits: Record<string, string | undefined>;
};

export type ModelAppMetadata = {
  code?: string;
  gpuKey?: string;
  image?: string;
  modelPath?: string;
  pvc?: string;
};

export type ModelCloudStorageMetadata = {
  cloudStorageId: string;
  pvcName: string;
  mountPath: string;
};

const DEFAULT_GPU_KEY = "nvidia.com/gpu";
const DEFAULT_MODEL_CACHE_SIZE_GI = "80";
const WELL_KNOWN_K8S_RESOURCES = new Set([
  "cpu",
  "memory",
  "storage",
  "ephemeral-storage",
]);

export const defaultModelAppFormValues: ModelAppFormValues = {
  name: "Qwen VLLM",
  id: "qwen-vllm",
  code: "qwen-vllm",
  image: "vllm",
  param: "--served-model-name\nqwen-vllm",
  codes: [{ id: "", branch: "main", path: "", token: "" }],
  cpu: "4",
  memory: "16Gi",
  gpu: "1",
  gpuKey: DEFAULT_GPU_KEY,
  modelCacheSize: DEFAULT_MODEL_CACHE_SIZE_GI,
};

export function splitModelParam(param: string) {
  return param
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeModelImageInput(image: string) {
  const trimmed = image.trim();
  return trimmed === "" || trimmed.toLowerCase() === "vllm" ? "vllm" : trimmed;
}

export function buildCreateModelAppRequest({
  domain,
  org,
  project,
  values,
}: BuildModelAppRequestInput): CreateModelAppRequest {
  const codes = values.codes
    .map((source) => ({
      id: source.id.trim(),
      branch: source.branch.trim(),
      path: source.path.trim(),
      token: source.token,
    }))
    .filter((source) => source.id.length > 0)
    .map((source) => create(ModelCodeSourceSchema, source));

  const gpu = parseModelGpu(values.gpu);
  const modelCacheSize = formatModelCacheSize(values.modelCacheSize);
  return create(CreateModelAppRequestSchema, {
    model: create(ModelAppInputSchema, {
      org,
      project,
      domain,
      name: values.name.trim(),
      id: values.id.trim(),
      code: values.code.trim(),
      image: normalizeModelImageInput(values.image),
      param: values.param,
      codes,
      resourceDefinition: create(ModelResourceDefinitionSchema, {
        cpu: values.cpu.trim(),
        memory: values.memory.trim(),
        gpu,
        gpuKey: values.gpuKey.trim() || DEFAULT_GPU_KEY,
      }),
      modelCacheSize,
    }),
  });
}

export function buildUpdateModelAppRequest({
  appId,
  values,
}: BuildUpdateModelAppRequestInput): UpdateModelAppRequest {
  const gpu = parseModelGpu(values.gpu);
  const modelCacheSize = formatModelCacheSize(values.modelCacheSize);
  return create(UpdateModelAppRequestSchema, {
    appId: create(IdentifierSchema, appId),
    name: values.name.trim(),
    image: normalizeModelImageInput(values.image),
    param: values.param,
    resourceDefinition: create(ModelResourceDefinitionSchema, {
      cpu: values.cpu.trim(),
      memory: values.memory.trim(),
      gpu,
      gpuKey: values.gpuKey.trim() || DEFAULT_GPU_KEY,
    }),
    modelCacheSize,
    reason: "console model app edit",
  });
}

export function modelAppConfigToFormValues(
  config: ModelAppConfig,
): ModelAppFormValues {
  const resourceDefinition = config.resourceDefinition;
  return {
    name: config.name,
    id: config.appId?.name ?? "",
    code: config.code,
    image: config.image,
    param: config.param,
    codes:
      config.codes.length > 0
        ? config.codes.map((source) => ({
            id: source.id,
            branch: source.branch,
            path: source.path,
            token: "",
          }))
        : [{ id: "", branch: "", path: "", token: "" }],
    cpu: resourceDefinition?.cpu ?? "",
    memory: resourceDefinition?.memory ?? "",
    gpu: String(resourceDefinition?.gpu ?? 0),
    gpuKey: resourceDefinition?.gpuKey || DEFAULT_GPU_KEY,
    modelCacheSize: quantityToGiIntegerString(
      config.modelCachePvc?.requestedSize,
    ),
  };
}

export type ValidateModelAppFormOptions = {
  currentModelCacheSize?: string;
  modelCacheExpandable?: boolean;
};

export function validateModelAppFormValues(
  values: ModelAppFormValues,
  options: ValidateModelAppFormOptions = {},
) {
  try {
    parseModelGpu(values.gpu);
    const requestedCacheSizeGi = parsePositiveGiInteger(values.modelCacheSize);
    const currentCacheSizeGi = parseQuantityToGi(options.currentModelCacheSize);
    if (
      currentCacheSizeGi !== undefined &&
      requestedCacheSizeGi < currentCacheSizeGi
    ) {
      return "模型缓存 PVC 容量只能增大，不能变小";
    }
    if (
      options.modelCacheExpandable === false &&
      currentCacheSizeGi !== undefined &&
      requestedCacheSizeGi > currentCacheSizeGi
    ) {
      return "当前 PVC 不支持在线扩容，需要迁移或重建";
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

function formatModelCacheSize(value: string) {
  return `${parsePositiveGiInteger(value)}Gi`;
}

function parsePositiveGiInteger(value: string) {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error("模型缓存 PVC 容量必须是正整数");
  }
  const size = Number(trimmed);
  if (!Number.isSafeInteger(size)) {
    throw new Error("模型缓存 PVC 容量必须是正整数");
  }
  return size;
}

function quantityToGiIntegerString(value: string | undefined) {
  const size = parseQuantityToGi(value);
  return size === undefined ? DEFAULT_MODEL_CACHE_SIZE_GI : String(size);
}

function parseQuantityToGi(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const plainMatch = trimmed.match(/^([1-9]\d*)$/);
  if (plainMatch) {
    return Number(plainMatch[1]);
  }
  const binaryMatch = trimmed.match(/^([1-9]\d*)(Ki|Mi|Gi|Ti|Pi|Ei)$/);
  if (!binaryMatch) {
    return undefined;
  }
  const valueInUnits = Number(binaryMatch[1]);
  if (!Number.isSafeInteger(valueInUnits)) {
    return undefined;
  }
  const factorByUnit: Record<string, number> = {
    Ki: 1 / (1024 * 1024),
    Mi: 1 / 1024,
    Gi: 1,
    Ti: 1024,
    Pi: 1024 * 1024,
    Ei: 1024 * 1024 * 1024,
  };
  const size = valueInUnits * factorByUnit[binaryMatch[2]];
  return Number.isInteger(size) && Number.isSafeInteger(size)
    ? size
    : undefined;
}

function parseModelGpu(value: string) {
  const trimmed = value.trim();
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new Error("GPU 必须是非负整数");
  }
  const gpu = Number(trimmed);
  if (!Number.isSafeInteger(gpu)) {
    throw new Error("GPU 必须是非负整数");
  }
  return gpu;
}

export function extractModelMetadata(app: App | undefined): ModelAppMetadata {
  if (!app?.spec) return {};
  return {
    code: inputString(app.spec.inputs?.items, "code"),
    gpuKey: inputString(app.spec.inputs?.items, "gpu_key"),
    image: inputString(app.spec.inputs?.items, "image"),
    modelPath: inputString(app.spec.inputs?.items, "model_path"),
    pvc: inputString(app.spec.inputs?.items, "model_cache_pvc"),
  };
}

export function extractAppResourceSummary(
  app: App | undefined,
): AppResourceSummary {
  if (!app?.spec) {
    return emptyResources();
  }
  if (app.spec.appPayload.case === "container") {
    return resourcesFromContainer(app.spec.appPayload.value.resources);
  }
  if (app.spec.appPayload.case === "pod") {
    return resourcesFromPod(app);
  }
  return emptyResources();
}

export function extractModelCloudStorageMounts(
  app: App | undefined,
): ModelCloudStorageMetadata[] {
  const pod =
    app?.spec?.appPayload.case === "pod"
      ? app.spec.appPayload.value
      : undefined;
  const podSpec = pod?.podSpec as Record<string, unknown> | undefined;
  const volumes = Array.isArray(podSpec?.volumes)
    ? (podSpec.volumes as Record<string, unknown>[])
    : [];
  const containers = Array.isArray(podSpec?.containers)
    ? (podSpec.containers as Record<string, unknown>[])
    : [];
  const container =
    containers.find((item) => item.name === pod?.primaryContainerName) ??
    containers[0];
  const volumeMounts = Array.isArray(container?.volumeMounts)
    ? (container.volumeMounts as Record<string, unknown>[])
    : [];

  return volumes.flatMap((volume) => {
    const volumeName = stringValue(volume.name);
    const pvc = recordValue(volume.persistentVolumeClaim);
    const pvcName = stringValue(pvc.claimName);
    const mount = volumeMounts.find((item) => item.name === volumeName);
    const mountPath = stringValue(mount?.mountPath);
    if (
      !volumeName?.startsWith("cloud-storage-") ||
      !pvcName?.startsWith("cs-") ||
      !mountPath
    ) {
      return [];
    }
    return [
      {
        cloudStorageId: pvcName.slice(3),
        pvcName,
        mountPath,
      },
    ];
  });
}

function resourcesFromContainer(
  resources: Resources | undefined,
): AppResourceSummary {
  const requests = resources?.requests ?? [];
  const limits = resources?.limits ?? [];
  return {
    requests: {
      Memory: protoResourceValue(requests, Resources_ResourceName.MEMORY),
      CPU: protoResourceValue(requests, Resources_ResourceName.CPU),
      GPU: protoResourceValue(requests, Resources_ResourceName.GPU),
      "Ephemeral Storage": protoResourceValue(
        requests,
        Resources_ResourceName.EPHEMERAL_STORAGE,
      ),
    },
    limits: {
      Memory: protoResourceValue(limits, Resources_ResourceName.MEMORY),
      CPU: protoResourceValue(limits, Resources_ResourceName.CPU),
      GPU: protoResourceValue(limits, Resources_ResourceName.GPU),
      "Ephemeral Storage": protoResourceValue(
        limits,
        Resources_ResourceName.EPHEMERAL_STORAGE,
      ),
    },
  };
}

function resourcesFromPod(app: App): AppResourceSummary {
  const pod =
    app.spec?.appPayload.case === "pod" ? app.spec.appPayload.value : undefined;
  const podSpec = pod?.podSpec as Record<string, unknown> | undefined;
  const containers = Array.isArray(podSpec?.containers)
    ? (podSpec?.containers as Record<string, unknown>[])
    : [];
  const container =
    containers.find((item) => item.name === pod?.primaryContainerName) ??
    containers[0];
  const requests = resourceMap(container?.resources, "requests");
  const limits = resourceMap(container?.resources, "limits");
  const requestGPU = gpuResource(requests);
  const limitGPU = gpuResource(limits);
  const metadata = extractModelMetadata(app);
  const gpuKey = metadata.gpuKey || requestGPU.key || limitGPU.key;

  return {
    requests: {
      Memory: stringValue(requests.memory),
      CPU: stringValue(requests.cpu),
      GPU: stringValue(requestGPU.value),
      "GPU Key": gpuKey,
      "Ephemeral Storage": stringValue(requests["ephemeral-storage"]),
    },
    limits: {
      Memory: stringValue(limits.memory),
      CPU: stringValue(limits.cpu),
      GPU: stringValue(limitGPU.value),
      "GPU Key": gpuKey,
      "Ephemeral Storage": stringValue(limits["ephemeral-storage"]),
    },
  };
}

function protoResourceValue(
  entries: Resources["requests"],
  name: Resources_ResourceName,
) {
  return entries.find((entry) => entry.name === name)?.value;
}

function resourceMap(value: unknown, key: "requests" | "limits") {
  const resources =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const selected = resources[key];
  return typeof selected === "object" && selected !== null
    ? (selected as Record<string, unknown>)
    : {};
}

function gpuResource(resources: Record<string, unknown>) {
  const entry = Object.entries(resources).find(
    ([key]) =>
      !WELL_KNOWN_K8S_RESOURCES.has(key) && key.toLowerCase().includes("gpu"),
  );
  return {
    key: entry?.[0],
    value: entry?.[1],
  };
}

function inputString(inputs: Input[] | undefined, name: string) {
  const value = inputs?.find((input) => input.name === name)?.value;
  return value?.case === "stringValue" ? value.value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function recordValue(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function emptyResources(): AppResourceSummary {
  return { requests: {}, limits: {} };
}
