/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import {
  ProjectIdentifierSchema,
  RunIdentifierSchema,
} from "@/gen/flyteidl2/common/identifier_pb";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";
import {
  IdentifierSchema,
  ResourceType,
} from "@/gen/flyteidl2/core/identifier_pb";
import {
  TypedInterfaceSchema,
  VariableMapSchema,
} from "@/gen/flyteidl2/core/interface_pb";
import { RetryStrategySchema } from "@/gen/flyteidl2/core/literals_pb";
import {
  TaskMetadataSchema as CoreTaskMetadataSchema,
  TaskTemplateSchema,
} from "@/gen/flyteidl2/core/tasks_pb";
import { InputsSchema } from "@/gen/flyteidl2/task/common_pb";
import { TaskSpecSchema } from "@/gen/flyteidl2/task/task_definition_pb";
import type {
  ActionDetails,
  Run,
} from "@/gen/flyteidl2/workflow/run_definition_pb";
import { RunSource } from "@/gen/flyteidl2/workflow/run_definition_pb";
import { CreateRunRequestSchema } from "@/gen/flyteidl2/workflow/run_service_pb";
import { getUserIdentityString } from "@/lib/userIdentityUtils";
import { create } from "@bufbuild/protobuf";

export const SSH_WORKSPACE_TASK_TYPE = "ssh_workspace";

export const DEFAULT_NODE_PORT_RANGE = {
  min: 31000,
  max: 32767,
};

export const DEFAULT_CODE_SERVER_DOMAIN = "ops.fzyun.io";
export const DEFAULT_CODE_SERVER_SCHEME = "https";

export const DEFAULT_CUSTOM_DEVELOPMENT_INSTANCE_IMAGE = "";

export const DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID = "aione-ide";

export const DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES = [
  {
    id: DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
    name: "官方编辑器",
    imageUri: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
  },
];

export const DELETED_DEVELOPMENT_INSTANCE_REASON =
  "Deleted from development instance console";

const DEVELOPMENT_INSTANCE_RANDOM_SEGMENT_LENGTH = 14;
const DEVELOPMENT_INSTANCE_RUN_NAME_LIMIT = 30;

export type DevelopmentInstanceImageType = "official" | "custom";

export type DevelopmentInstanceResourceSpec = {
  id: string;
  label: string;
  cpu: string;
  memory: string;
  gpuCount: number;
  gpuModel?: string;
};

export const DEVELOPMENT_INSTANCE_RESOURCE_SPECS: DevelopmentInstanceResourceSpec[] =
  [
    {
      id: "cpu-1c-2g",
      label: "1vCPU, 2GiB RAM",
      cpu: "1",
      memory: "2Gi",
      gpuCount: 0,
    },
    {
      id: "t4-1c-2g",
      label: "1vCPU, 2GiB RAM, 1*NVIDIA T4",
      cpu: "1",
      memory: "2Gi",
      gpuCount: 1,
      gpuModel: "NVIDIA T4",
    },
    {
      id: "cpu-2c-4g",
      label: "2vCPU, 4GiB RAM",
      cpu: "2",
      memory: "4Gi",
      gpuCount: 0,
    },
    {
      id: "cpu-4c-8g",
      label: "4vCPU, 8GiB RAM",
      cpu: "4",
      memory: "8Gi",
      gpuCount: 0,
    },
    {
      id: "cpu-8c-16g",
      label: "8vCPU, 16GiB RAM",
      cpu: "8",
      memory: "16Gi",
      gpuCount: 0,
    },
  ];

export type NodePortRange = typeof DEFAULT_NODE_PORT_RANGE;

export type DevelopmentInstanceFormValues = {
  org: string;
  project: string;
  domain: string;
  name: string;
  description?: string;
  owner?: string;
  imageType: DevelopmentInstanceImageType;
  officialImageId: string;
  image: string;
  enableSsh: boolean;
  sshUser: string;
  authorizedKey: string;
  cpu: string;
  memory: string;
  gpuCount?: number;
  gpuModel?: string;
  nodePort: number;
  codeServerHost?: string;
  codeServerUrl?: string;
  codeServerWorkspaceUrl?: string;
  maxHours: number;
  imagePullSecretName?: string;
  codeRepositorySecretName?: string;
  gpuNodeLabelKey?: string;
  sourceOrg?: string;
  sourceInstanceId?: string;
  sourceName?: string;
  sourceSystem?: string;
  baseImageMountPath?: string;
  cloudStorageMounts?: {
    cloudStorageId: string;
    pvcName: string;
    storageClass: string;
    size: string;
    mountPath: string;
  }[];
  codeRepositories?: {
    id: string;
    repoUrl: string;
    branch: string;
    mountPath: string;
    token?: string;
  }[];
  datasets?: {
    endpoint: string;
    port: string;
    accessKey: string;
    secretKey: string;
    targetPath: string;
    bucket: string;
    bucketPath?: string;
  }[];
  datasetMounts?: {
    datasetId: string;
    targetPath: string;
  }[];
};

export type DevelopmentInstance = {
  name: string;
  description: string;
  resourceSummary: string;
  owner: string;
  createdAt: string;
  status: ActionPhase;
  statusLabel: string;
  runName: string;
  sourceInstanceId: string;
  sshCommand?: string;
  nodePort?: number;
  codeServerUrl?: string;
  enableSsh: boolean;
  image?: string;
  custom?: Record<string, unknown>;
  run: Run;
};

export function getNextNodePort(
  usedPorts: number[],
  range: NodePortRange = DEFAULT_NODE_PORT_RANGE,
) {
  const used = new Set(usedPorts);
  for (let port = range.min; port <= range.max; port += 1) {
    if (!used.has(port)) {
      return port;
    }
  }
  throw new Error(
    "No available NodePort in default development instance range",
  );
}

export function buildRunIdentifier(
  org: string,
  project: string,
  domain: string,
  name: string,
) {
  return create(RunIdentifierSchema, {
    org,
    project,
    domain,
    name,
  });
}

export function normalizeRunName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeBase36Segment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function createDevelopmentInstanceRandomSegment() {
  let segment = "";
  while (segment.length < DEVELOPMENT_INSTANCE_RANDOM_SEGMENT_LENGTH) {
    segment += Math.random().toString(36).slice(2);
  }
  return segment.slice(0, DEVELOPMENT_INSTANCE_RANDOM_SEGMENT_LENGTH);
}

export function buildGeneratedDevelopmentInstanceSourceId(
  seed = createDevelopmentInstanceRandomSegment(),
) {
  const normalizedSeed = normalizeBase36Segment(seed);
  const randomPart = (
    normalizedSeed + createDevelopmentInstanceRandomSegment()
  ).slice(0, DEVELOPMENT_INSTANCE_RANDOM_SEGMENT_LENGTH);
  return `ins-${randomPart}-${shortHash(normalizedSeed || randomPart)}`;
}

function buildRunNameWithSuffix(
  baseName: string,
  suffix: string,
  limit = DEVELOPMENT_INSTANCE_RUN_NAME_LIMIT,
) {
  const base = normalizeRunName(baseName) || "instance";
  const normalizedSuffix = normalizeRunName(suffix) || "r1";
  const suffixWithSeparator = `-${normalizedSuffix}`;
  if (base.length + suffixWithSeparator.length <= limit) {
    return `${base}${suffixWithSeparator}`;
  }
  const hash = shortHash(base);
  const maxBaseLength = Math.max(
    1,
    limit - suffixWithSeparator.length - hash.length - 1,
  );
  const prefix = base.slice(0, maxBaseLength).replace(/-+$/g, "") || "i";
  return `${prefix}-${hash}${suffixWithSeparator}`;
}

export function buildDevelopmentInstanceRunName(
  sourceInstanceId: string,
  generation: number,
) {
  return buildRunNameWithSuffix(
    sourceInstanceId,
    `r${Math.max(1, Math.floor(generation))}`,
  );
}

export function getNextDevelopmentInstanceRunGeneration(
  instances: Pick<DevelopmentInstance, "runName" | "sourceInstanceId">[],
  sourceInstanceId: string,
) {
  const latestGeneration = instances.reduce((latest, instance) => {
    if (instance.sourceInstanceId !== sourceInstanceId) {
      return latest;
    }
    const match = instance.runName.match(/-r([1-9]\d*)$/);
    if (!match) {
      return latest;
    }
    return Math.max(latest, Number(match[1]));
  }, 0);
  return latestGeneration + 1;
}

export function buildCodeServerHost(
  value: string,
  domain = DEFAULT_CODE_SERVER_DOMAIN,
) {
  const base = normalizeRunName(value) || "instance";
  const suffix = "-code";
  const hostLabel =
    base.length + suffix.length <= 63
      ? `${base}${suffix}`
      : `${base.slice(0, 63 - suffix.length - 9).replace(/-+$/g, "")}-${shortHash(base)}${suffix}`;
  return `${hostLabel}.${domain}`;
}

export function buildCodeServerUrl(
  host: string,
  scheme = DEFAULT_CODE_SERVER_SCHEME,
) {
  return `${scheme}://${host}`;
}

export function buildCodeServerWorkspaceUrl(
  host: string,
  scheme = DEFAULT_CODE_SERVER_SCHEME,
) {
  return buildCodeServerUrl(host, scheme);
}

export function buildCreateDevelopmentInstanceRequest(
  values: DevelopmentInstanceFormValues,
) {
  const name = normalizeRunName(values.name);
  const cloudStorageMounts = (values.cloudStorageMounts ?? []).map((mount) => ({
    id: mount.cloudStorageId,
    pvcName: mount.pvcName,
    storageClass: mount.storageClass,
    size: mount.size,
    mountPath: mount.mountPath,
  }));
  const officialImage =
    values.imageType === "official"
      ? developmentInstanceOfficialImageByID(values.officialImageId)
      : undefined;
  const image = officialImage?.imageUri ?? values.image.trim();
  const codeServerHost =
    values.codeServerHost?.trim() || buildCodeServerHost(name);
  const codeServerUrl =
    values.codeServerUrl?.trim() || buildCodeServerUrl(codeServerHost);
  const codeServerWorkspaceUrl =
    values.codeServerWorkspaceUrl?.trim() ||
    buildCodeServerWorkspaceUrl(codeServerHost);

  const custom = {
    image,
    imageType: values.imageType,
    officialImageId: officialImage?.id ?? "",
    imageName: officialImage?.name ?? image,
    enableSsh: values.enableSsh,
    cpu: values.cpu.trim(),
    memory: values.memory.trim(),
    gpuCount: values.gpuCount ?? 0,
    gpuModel: values.gpuModel?.trim() ?? "",
    codeServerHost,
    codeServerUrl,
    codeServerWorkspaceUrl,
    description: values.description?.trim() ?? "",
    owner: values.owner?.trim() ?? "",
    maxHours: values.maxHours,
    imagePullSecretName: values.imagePullSecretName?.trim() ?? "",
    codeRepositorySecretName: values.codeRepositorySecretName?.trim() ?? "",
    gpuNodeLabelKey: values.gpuNodeLabelKey?.trim() ?? "",
    sourceOrg: values.sourceOrg?.trim() ?? "",
    sourceInstanceId: values.sourceInstanceId?.trim() ?? "",
    sourceName: values.sourceName?.trim() ?? "",
    sourceSystem: values.sourceSystem?.trim() ?? "",
    baseImageMountPath: values.baseImageMountPath?.trim() ?? "",
    cloudStorageMounts,
    codeRepositories: values.codeRepositories ?? [],
    datasets: values.datasets ?? [],
    datasetMounts: values.datasetMounts ?? [],
  };
  if (values.enableSsh) {
    Object.assign(custom, {
      sshUser: values.sshUser.trim(),
      authorizedKeys: [values.authorizedKey.trim()],
      serviceType: "NodePort",
      nodePort: values.nodePort,
    });
  }

  return create(CreateRunRequestSchema, {
    id: {
      case: "runId",
      value: buildRunIdentifier(
        values.org,
        values.project,
        values.domain,
        name,
      ),
    },
    task: {
      case: "taskSpec",
      value: create(TaskSpecSchema, {
        shortName: "开发实例",
        taskTemplate: create(TaskTemplateSchema, {
          id: create(IdentifierSchema, {
            resourceType: ResourceType.TASK,
            org: values.org,
            project: values.project,
            domain: values.domain,
            name: SSH_WORKSPACE_TASK_TYPE,
            version: `console-${Date.now()}`,
          }),
          type: SSH_WORKSPACE_TASK_TYPE,
          custom,
          metadata: create(CoreTaskMetadataSchema, {
            discoverable: false,
            timeout: {
              seconds: BigInt(values.maxHours * 3600),
              nanos: 0,
            },
            retries: create(RetryStrategySchema, { retries: 0 }),
            interruptibleValue: { case: "interruptible", value: false },
            cacheSerializable: false,
            debuggable: true,
          }),
          interface: create(TypedInterfaceSchema, {
            inputs: create(VariableMapSchema, { variables: [] }),
            outputs: create(VariableMapSchema, { variables: [] }),
          }),
        }),
      }),
    },
    inputWrapper: {
      case: "inputs",
      value: create(InputsSchema, { literals: [] }),
    },
    source: RunSource.WEB,
  });
}

export function developmentInstanceOfficialImageByID(id: string) {
  const selectedID = id || DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID;
  return (
    DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES.find(
      (image) => image.id === selectedID,
    ) ?? DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES[0]
  );
}

export function isTerminalPhase(phase: ActionPhase | undefined) {
  return (
    phase === ActionPhase.SUCCEEDED ||
    phase === ActionPhase.FAILED ||
    phase === ActionPhase.ABORTED ||
    phase === ActionPhase.TIMED_OUT
  );
}

export function getPhaseText(phase: ActionPhase | undefined) {
  switch (phase) {
    case ActionPhase.RUNNING:
      return "运行中";
    case ActionPhase.INITIALIZING:
      return "初始化";
    case ActionPhase.QUEUED:
      return "排队中";
    case ActionPhase.WAITING_FOR_RESOURCES:
      return "等待资源";
    case ActionPhase.SUCCEEDED:
      return "已完成";
    case ActionPhase.FAILED:
      return "异常";
    case ActionPhase.ABORTED:
      return "已停止";
    case ActionPhase.TIMED_OUT:
      return "已超时";
    default:
      return "未启动";
  }
}

function timestampToDateString(timestamp?: { seconds?: bigint | number }) {
  if (!timestamp?.seconds) {
    return "-";
  }
  return new Date(Number(timestamp.seconds) * 1000).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function getTaskCustom(run: Run, actionDetails?: ActionDetails) {
  if (actionDetails?.spec.case === "task") {
    return (
      (actionDetails.spec.value.taskTemplate?.custom as
        | Record<string, unknown>
        | undefined) ?? {}
    );
  }
  const metadata = run.action?.metadata;
  if (metadata?.spec.case !== "task") {
    return {};
  }
  return {};
}

export function formatDevelopmentInstance(
  run: Run,
  actionDetails?: ActionDetails,
): DevelopmentInstance | null {
  const runId = run.action?.id?.run;
  if (!runId?.name) {
    return null;
  }
  if (
    actionDetails?.result.case === "abortInfo" &&
    actionDetails.result.value.reason === DELETED_DEVELOPMENT_INSTANCE_REASON
  ) {
    return null;
  }

  const custom = getTaskCustom(run, actionDetails);
  const nodePort =
    typeof custom.nodePort === "number" ? Number(custom.nodePort) : undefined;
  const enableSsh =
    typeof custom.enableSsh === "boolean" ? custom.enableSsh : Boolean(nodePort);
  const codeServerWorkspaceUrl =
    typeof custom.codeServerWorkspaceUrl === "string" &&
    custom.codeServerWorkspaceUrl.trim()
      ? custom.codeServerWorkspaceUrl.trim()
      : "";
  const codeServerUrl =
    typeof custom.codeServerUrl === "string" && custom.codeServerUrl.trim()
      ? custom.codeServerUrl.trim()
      : "";
  const sshUser =
    typeof custom.sshUser === "string" ? custom.sshUser : "flytekit";
  const cpu = typeof custom.cpu === "string" ? custom.cpu : "";
  const memory = typeof custom.memory === "string" ? custom.memory : "";
  const gpuCount =
    typeof custom.gpuCount === "number" ? Number(custom.gpuCount) : 0;
  const gpuModel = typeof custom.gpuModel === "string" ? custom.gpuModel : "";
  const gpuSummary = gpuCount > 0 ? `${gpuCount}*${gpuModel || "GPU"}` : "";
  const sourceName =
    typeof custom.sourceName === "string" && custom.sourceName.trim()
      ? custom.sourceName.trim()
      : "";
  const sourceInstanceId =
    typeof custom.sourceInstanceId === "string" &&
    custom.sourceInstanceId.trim()
      ? custom.sourceInstanceId.trim()
      : runId.name;
  const resourceSummary = [
    cpu && `${cpu}vCPU`,
    memory,
    gpuSummary,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    name: sourceName || runId.name,
    description:
      typeof custom.description === "string" ? custom.description : "",
    resourceSummary: resourceSummary || "-",
    owner:
      (typeof custom.owner === "string" && custom.owner) ||
      getUserIdentityString(run.action?.metadata?.executedBy),
    createdAt: timestampToDateString(run.action?.status?.startTime),
    status: run.action?.status?.phase ?? ActionPhase.UNSPECIFIED,
    statusLabel: getPhaseText(run.action?.status?.phase),
    runName: runId.name,
    sourceInstanceId,
    sshCommand: nodePort
      ? `ssh -p ${nodePort} ${sshUser}@172.19.66.218`
      : undefined,
    nodePort,
    codeServerUrl:
      codeServerWorkspaceUrl || codeServerUrl || undefined,
    enableSsh,
    image: typeof custom.image === "string" ? custom.image : undefined,
    custom,
    run,
  };
}

function shortHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getUsedNodePorts(runs: Run[]) {
  return runs
    .flatMap((run) => {
      const instance = formatDevelopmentInstance(run);
      return [instance?.nodePort];
    })
    .filter((port): port is number => typeof port === "number");
}

export function getConsoleApiPath(path: string) {
  if (typeof window === "undefined") {
    return path;
  }
  return window.location.pathname.startsWith("/v2/") ? `/v2${path}` : path;
}
