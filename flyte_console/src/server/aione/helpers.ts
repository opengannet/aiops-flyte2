/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  buildCodeServerHost,
  buildCodeServerUrl,
  DEFAULT_NODE_PORT_RANGE,
  DevelopmentInstanceFormValues,
  normalizeRunName,
} from "@/components/pages/DevelopmentInstances/utils";

export const DEFAULT_AIONE_INTERNAL_ORG = "aione";
export const DEFAULT_AIONE_STORAGE_CLASS = "bj1-ebs";
export const AIONE_RUNTIME_NAMESPACE = "flyte";
export const DEFAULT_EXTERNAL_API_PUBLIC_SCHEME = "http";
export const DEFAULT_EXTERNAL_API_PUBLIC_HOST = "172.19.66.218";

type ExternalImageType = "BASE" | "OWN";

type ExternalOssData = {
  endPoint?: string;
  Endpoint?: string;
  end_point?: string;
  endpoint?: string;
  port?: number | string;
  accessKey?: string;
  secretKey?: string;
  targetPath?: string;
  bucket?: string;
  bucketPath?: string;
};

type ExternalInstancePayload = {
  org?: string;
  project?: string;
  domain?: string;
  name?: string;
  id?: string;
  timeout?: number;
  imageType?: ExternalImageType;
  image?: string;
  imageKey?: string;
  imageSecret?: string;
  baseImage?: {
    image?: string;
    imageKey?: string;
    imageSecret?: string;
    mountPath?: string;
  };
  enableSsh?: boolean;
  authorizedKey?: string;
  authorizedKeys?: string[];
  codes?: {
    id?: string;
    branch?: string;
    path?: string;
    token?: string;
  }[];
  datastores?: {
    id?: string;
    path?: string;
    size?: number;
  }[];
  datasets?: unknown;
  ossDatas?: ExternalOssData[];
  resourceDefinition?: {
    cpu?: string;
    memory?: string;
    gpu?: number;
    gpu_key?: string;
  };
};

export type RegistryCredentials = {
  image: string;
  username: string;
  password: string;
};

export type CodeRepositoryWithToken = {
  id: string;
  repoUrl: string;
  branch: string;
  mountPath: string;
  token?: string;
};

export type BuildAioneInstanceValuesInput = {
  payload: ExternalInstancePayload;
  nodePort: number;
  internalOrg?: string;
  defaultStorageClass?: string;
  defaultAuthorizedKey?: string;
  runNameSuffix?: string;
};

export type BuildAioneInstanceAccessInfoInput = {
  runName: string;
  sourceName: string;
  enableSsh: boolean;
  sshUser: string;
  nodePort: number;
  cpu: string;
  memory: string;
  gpuCount: number;
  publicHost?: string;
  codeServerScheme?: string;
  codeServerHost?: string;
  codeServerAvailable?: boolean;
  codeServerReason?: string;
  codeServerMessage?: string;
};

export type AioneInstanceAccessInfo = ReturnType<
  typeof buildAioneInstanceAccessInfo
>;

export type BuildAioneCreateInstanceResponseInput = {
  internalOrg: string;
  project: string;
  domain: string;
  runName: string;
  sourceOrg: string;
  sourceInstanceId: string;
  info: AioneInstanceAccessInfo;
};

export function authenticateAioneRequest(
  headers: Headers,
  configuredKeys: string[] | string | undefined,
) {
  const keys = Array.isArray(configuredKeys)
    ? configuredKeys
    : (configuredKeys ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
  if (keys.length === 0) {
    return false;
  }

  const authorization = headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const apiKey = headers.get("x-api-key")?.trim() ?? "";
  return keys.includes(bearer) || keys.includes(apiKey);
}

export function buildAioneInstanceValues({
  payload,
  nodePort,
  internalOrg = DEFAULT_AIONE_INTERNAL_ORG,
  defaultStorageClass = DEFAULT_AIONE_STORAGE_CLASS,
  defaultAuthorizedKey = "",
  runNameSuffix,
}: BuildAioneInstanceValuesInput) {
  const project = requiredString(payload.project, "project");
  const domain = requiredString(payload.domain, "domain");
  const sourceID = payload.id?.trim() ?? "";
  const sourceName = payload.name?.trim() ?? "";
  const sourceInstanceId = sourceID || sourceName;
  const sourceBaseName = normalizeRunName(sourceInstanceId);
  if (!sourceBaseName) {
    throw new Error("id or name must produce a valid run name");
  }
  const runName = buildRestartableRunName(sourceBaseName, runNameSuffix);
  const codeServerHost = buildCodeServerHost(sourceBaseName);
  const codeServerUrl = buildCodeServerUrl(codeServerHost);
  const codeServerWorkspaceUrl = codeServerUrl;
  const enableSsh = payload.enableSsh === true;

  const authorizedKey =
    firstNonEmpty([payload.authorizedKey, ...(payload.authorizedKeys ?? [])]) ||
    defaultAuthorizedKey.trim();
  if (enableSsh && !authorizedKey) {
    throw new Error("authorizedKey is required");
  }

  const imageType = payload.imageType ?? "BASE";
  const image =
    imageType === "OWN"
      ? requiredString(payload.image, "image")
      : requiredString(payload.baseImage?.image, "baseImage.image");
  const imageKey =
    imageType === "OWN"
      ? payload.imageKey?.trim()
      : payload.baseImage?.imageKey?.trim();
  const imageSecret =
    imageType === "OWN"
      ? payload.imageSecret?.trim()
      : payload.baseImage?.imageSecret?.trim();
  const registryCredentials =
    imageKey && imageSecret
      ? { image, username: imageKey, password: imageSecret }
      : undefined;
  const imagePullSecretName = registryCredentials
    ? buildExternalSecretName(project, sourceBaseName, "image")
    : "";

  const codeRepositoriesWithTokens = (payload.codes ?? []).map((repo) => {
    const repoURL = requiredString(repo.id, "codes.id");
    return {
      id: repoURL,
      repoUrl: repoURL,
      branch: repo.branch?.trim() || "master",
      mountPath: requiredAbsolutePath(repo.path, "codes.path"),
      token: repo.token?.trim() || undefined,
    };
  });
  const hasCodeRepositoryTokens = codeRepositoriesWithTokens.some(
    (repo) => repo.token,
  );
  const codeRepositorySecretName = hasCodeRepositoryTokens
    ? buildExternalSecretName(project, sourceBaseName, "code")
    : "";

  const values: DevelopmentInstanceFormValues = {
    org: internalOrg,
    project,
    domain,
    name: runName,
    description: sourceName,
    owner: payload.org?.trim() || "external-api",
    imageType: "custom",
    officialImageId: "",
    image,
    enableSsh,
    sshUser: "flytekit",
    authorizedKey: enableSsh ? authorizedKey : "",
    cpu: payload.resourceDefinition?.cpu?.trim() || "2",
    memory: payload.resourceDefinition?.memory?.trim() || "4Gi",
    gpuCount: payload.resourceDefinition?.gpu ?? 0,
    gpuModel: "",
    nodePort,
    codeServerHost,
    codeServerUrl,
    codeServerWorkspaceUrl,
    maxHours: positiveIntegerNumber(payload.timeout, 24, "timeout"),
    imagePullSecretName,
    codeRepositorySecretName,
    gpuNodeLabelKey: payload.resourceDefinition?.gpu_key?.trim() || "",
    sourceOrg: payload.org?.trim() || "",
    sourceInstanceId,
    sourceName,
    sourceSystem: "external-api",
    baseImageMountPath: payload.baseImage?.mountPath?.trim() || "",
    cloudStorageMounts: (payload.datastores ?? []).map((datastore) => {
      const id = requiredString(datastore.id, "datastores.id");
      return {
        cloudStorageId: id,
        pvcName: buildStablePVCName(sourceBaseName, id),
        storageClass: defaultStorageClass,
        size: `${positiveNumber(datastore.size, 1, "datastores.size")}Gi`,
        mountPath: requiredAbsolutePath(datastore.path, "datastores.path"),
      };
    }),
    datasets: (payload.ossDatas ?? []).map((dataset, index) => {
      for (const field of ["endPoint", "Endpoint", "end_point"]) {
        if (Object.prototype.hasOwnProperty.call(dataset, field)) {
          throw new Error(
            `ossDatas[${index}].${field} is not supported; use endpoint`,
          );
        }
      }
      const bucketPath = dataset.bucketPath?.trim() || "";
      if (
        bucketPath.includes("..") ||
        bucketPath.includes("\\") ||
        bucketPath.includes("://")
      ) {
        throw new Error(
          `ossDatas[${index}].bucketPath cannot contain .., backslash, or URL scheme`,
        );
      }
      return {
        endpoint: requiredString(dataset.endpoint, `ossDatas[${index}].endpoint`),
        port: String(
          requiredString(String(dataset.port ?? ""), `ossDatas[${index}].port`),
        ),
        accessKey: requiredString(
          dataset.accessKey,
          `ossDatas[${index}].accessKey`,
        ),
        secretKey: requiredString(
          dataset.secretKey,
          `ossDatas[${index}].secretKey`,
        ),
        targetPath: requiredAbsolutePath(
          dataset.targetPath,
          `ossDatas[${index}].targetPath`,
        ),
        bucket: requiredString(dataset.bucket, `ossDatas[${index}].bucket`),
        bucketPath,
      };
    }),
    codeRepositories: codeRepositoriesWithTokens,
  };

  return {
    runName,
    sourceInstanceId,
    values,
    registryCredentials,
    codeRepositoriesWithTokens,
  };
}

export function buildDockerConfigJson(credentials: RegistryCredentials) {
  const registry = new URL(`https://${credentials.image}`).hostname;
  const auth = Buffer.from(
    `${credentials.username}:${credentials.password}`,
    "utf8",
  ).toString("base64");
  return JSON.stringify({
    auths: {
      [registry]: {
        username: credentials.username,
        password: credentials.password,
        auth,
      },
    },
  });
}

export function buildAioneInstanceAccessInfo({
  runName,
  sourceName,
  enableSsh,
  sshUser,
  nodePort,
  cpu,
  memory,
  gpuCount,
  publicHost = DEFAULT_EXTERNAL_API_PUBLIC_HOST,
  codeServerScheme = "https",
  codeServerHost,
  codeServerAvailable = true,
  codeServerReason,
  codeServerMessage,
}: BuildAioneInstanceAccessInfoInput) {
  const host = publicHost.trim() || DEFAULT_EXTERNAL_API_PUBLIC_HOST;
  const resolvedCodeServerHost = codeServerHost?.trim();
  const resolvedCodeServerUrl = resolvedCodeServerHost
    ? buildCodeServerUrl(resolvedCodeServerHost, codeServerScheme)
    : "";
  const resolvedCodeServerPort = codeServerScheme === "http" ? 80 : 443;
  const info: {
    id: string;
    name: string;
    status: string;
    ssh?: {
      user: string;
      host: string;
      port: number;
      command: string;
    };
    codeServer: {
      host: string;
      port: number;
      url: string;
      workspaceUrl: string;
      available: boolean;
      reason?: string;
      message?: string;
    };
    resources: {
      cpu: string;
      memory: string;
      gpu: number;
    };
  } = {
    id: runName,
    name: sourceName,
    status: "CREATED",
    codeServer: {
      host: resolvedCodeServerHost || "",
      port: resolvedCodeServerPort,
      url: resolvedCodeServerUrl,
      workspaceUrl: resolvedCodeServerUrl,
      available: codeServerAvailable,
      reason: codeServerReason || undefined,
      message: codeServerMessage || undefined,
    },
    resources: {
      cpu,
      memory,
      gpu: gpuCount,
    },
  };
  if (enableSsh) {
    info.ssh = {
      user: sshUser,
      host,
      port: nodePort,
      command: `ssh -p ${nodePort} ${sshUser}@${host}`,
    };
  }
  return info;
}

export function buildAioneCreateInstanceResponse({
  internalOrg,
  project,
  domain,
  runName,
  sourceOrg,
  sourceInstanceId,
  info,
}: BuildAioneCreateInstanceResponseInput) {
  return {
    status: 200,
    data: {
      id: sourceInstanceId,
      run: {
        org: internalOrg,
        project,
        domain,
        name: runName,
      },
      source: {
        org: sourceOrg,
        id: sourceInstanceId,
      },
      info,
    },
  };
}

export function buildExternalSecretName(
  project: string,
  runName: string,
  suffix: string,
) {
  const cleaned = normalizeRunName(`${project}-${runName}-${suffix}`) || suffix;
  if (cleaned.length <= 63) {
    return cleaned;
  }
  const hash = shortHash(cleaned);
  return `${cleaned.slice(0, 63 - hash.length - 1).replace(/-+$/g, "")}-${hash}`;
}

export function buildWorkspaceLabels({
  org,
  project,
  domain,
  runName,
}: {
  org: string;
  project: string;
  domain: string;
  runName: string;
}) {
  return {
    "flyte.org/ssh-workspace": runName,
    "flyte.org/run-name": runName,
    "flyte.org/project": project,
    "flyte.org/domain": domain,
    "flyte.org/org": org,
  };
}

export function getAioneNodePortRange() {
  const min = Number.parseInt(
    process.env.EXTERNAL_API_NODE_PORT_MIN ||
      String(DEFAULT_NODE_PORT_RANGE.min),
    10,
  );
  const max = Number.parseInt(
    process.env.EXTERNAL_API_NODE_PORT_MAX ||
      String(DEFAULT_NODE_PORT_RANGE.max),
    10,
  );
  return { min, max };
}

function buildRestartableRunName(sourceBaseName: string, suffix?: string) {
  const resolvedSuffix =
    normalizeRunName(suffix ?? `r${Math.random().toString(36).slice(2, 5)}`) ||
    "r";
  return buildNameWithSuffix(sourceBaseName, resolvedSuffix, 30);
}

function buildStablePVCName(sourceBaseName: string, suffix: string) {
  return buildBoundedName(`${sourceBaseName}-${suffix}`, 253);
}

function buildNameWithSuffix(base: string, suffix: string, maxLength: number) {
  const cleaned = normalizeRunName(base) || "instance";
  const cleanedSuffix = normalizeRunName(suffix) || "r";
  const full = `${cleaned}-${cleanedSuffix}`;
  if (full.length <= maxLength) {
    return full;
  }
  const hash = shortHash(full);
  const prefixLength = Math.max(
    1,
    maxLength - cleanedSuffix.length - hash.length - 2,
  );
  return `${cleaned.slice(0, prefixLength).replace(/-+$/g, "")}-${hash}-${cleanedSuffix}`;
}

function buildBoundedName(value: string, maxLength: number) {
  const cleaned = normalizeRunName(value) || "instance";
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  const hash = shortHash(cleaned);
  return `${cleaned.slice(0, maxLength - hash.length - 1).replace(/-+$/g, "")}-${hash}`;
}

function requiredString(value: string | undefined, field: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function requiredAbsolutePath(value: string | undefined, field: string) {
  const trimmed = requiredString(value, field);
  if (!trimmed.startsWith("/")) {
    throw new Error(`${field} must be an absolute path`);
  }
  return trimmed;
}

function positiveNumber(
  value: number | undefined,
  fallback: number,
  field: string,
) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return resolved;
}

function positiveIntegerNumber(
  value: number | undefined,
  fallback: number,
  field: string,
) {
  return Math.ceil(positiveNumber(value, fallback, field));
}

function firstNonEmpty(values: (string | undefined)[]) {
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
