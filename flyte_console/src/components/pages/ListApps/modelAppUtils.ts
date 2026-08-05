/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { create } from "@bufbuild/protobuf";

import { App, Input } from "@/gen/flyteidl2/app/app_definition_pb";
import {
  CreateModelAppRequest,
  CreateModelAppRequestSchema,
  ModelAppInputSchema,
  ModelCodeSourceSchema,
  ModelResourceDefinitionSchema,
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
};

export type BuildModelAppRequestInput = {
  org: string;
  project: string;
  domain: string;
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

const DEFAULT_GPU_KEY = "nvidia.com/gpu";
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

  const gpu = Number.parseInt(values.gpu.trim() || "0", 10);
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
        gpu: Number.isFinite(gpu) && gpu > 0 ? gpu : 0,
        gpuKey: values.gpuKey.trim() || DEFAULT_GPU_KEY,
      }),
    }),
  });
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

function emptyResources(): AppResourceSummary {
  return { requests: {}, limits: {} };
}
