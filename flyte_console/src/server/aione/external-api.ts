/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { create } from "@bufbuild/protobuf";
import { createClient, Code, ConnectError } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  buildDevelopmentInstanceRunName,
  getNextNodePort,
  type DevelopmentInstanceFormValues,
} from "@/components/pages/DevelopmentInstances/utils";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";
import type {
  LogContext,
  PodLogContext,
} from "@/gen/flyteidl2/core/execution_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import {
  ImageType,
  type TrainingTask,
  type TrainingTaskIdentifier,
  TrainingTaskIdentifierSchema,
} from "@/gen/flyteidl2/trainingtask/training_task_definition_pb";
import {
  CloudStorageIdentifierSchema,
  CloudStorageMountSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import { CodeRepositoryMountSchema } from "@/gen/flyteidl2/aione/coderepository/code_repository_definition_pb";
import {
  CodeRepositoryInputSchema,
  CodeRepositoryService,
  CreateCodeRepositoryRequestSchema,
} from "@/gen/flyteidl2/aione/coderepository/code_repository_service_pb";
import {
  DatasetMountSchema,
  RuntimeDatasetSchema,
} from "@/gen/flyteidl2/aione/dataset/dataset_definition_pb";
import {
  DevelopmentInstance,
  type DevelopmentInstanceAccessInfo,
  DevelopmentInstanceCodeRepositoryDetailSchema,
  DevelopmentInstanceIdentifierSchema,
  ImageType as DevelopmentInstanceImageType,
} from "@/gen/flyteidl2/developmentinstance/development_instance_definition_pb";
import {
  CreateDevelopmentInstanceRequestSchema,
  DevelopmentInstanceInputSchema,
  DevelopmentInstanceService,
  GetDevelopmentInstanceByIdRequestSchema,
  ListDevelopmentInstanceRunsRequestSchema,
  StartDevelopmentInstanceRequestSchema,
  StopDevelopmentInstanceRequestSchema,
} from "@/gen/flyteidl2/developmentinstance/development_instance_service_pb";
import {
  ClearCloudStorageMaterializationsRequestSchema,
  CloudStorageInputSchema,
  CloudStorageService,
  EnsureCloudStorageRequestSchema,
  GetCloudStorageByIdRequestSchema,
  MaterializeCloudStorageRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import { AppService } from "@/gen/flyteidl2/app/app_service_pb";
import {
  CreateModelAppRequestSchema,
  ModelAppInputSchema,
  ModelCodeSourceSchema,
  ModelResourceDefinitionSchema,
} from "@/gen/flyteidl2/app/app_payload_pb";
import {
  CreateTrainingTaskRequestSchema,
  GetTrainingTaskByIdRequestSchema,
  StartTrainingTaskRequestSchema,
  StopTrainingTaskRequestSchema,
  TrainingTaskInputSchema,
  TrainingTaskService,
} from "@/gen/flyteidl2/trainingtask/training_task_service_pb";
import { RunService } from "@/gen/flyteidl2/workflow/run_service_pb";
import type { ActionStatus } from "@/gen/flyteidl2/workflow/run_definition_pb";
import {
  getKubernetesClientConfig,
  requestKubernetes,
} from "@/server/kubernetes/client";
import {
  KubernetesServiceList,
  extractNodePorts,
} from "@/server/development-instances/nodeports";
import {
  buildDeleteCollectionRequests,
  buildWorkspaceLabelSelector,
} from "@/server/development-instances/delete";
import { statusError } from "@/server/http/response";
import type { PvcStats } from "@/server/cloud-storage/stats";
import {
  AIONE_RUNTIME_NAMESPACE,
  type AioneInstanceAccessInfo,
  CodeRepositoryWithToken,
  DEFAULT_AIONE_INTERNAL_ORG,
  DEFAULT_AIONE_STORAGE_CLASS,
  RegistryCredentials,
  buildAioneCreateInstanceResponse,
  buildAioneInstanceAccessInfo,
  buildAioneInstanceValues,
  buildDockerConfigJson,
  buildWorkspaceLabels,
  getAioneNodePortRange,
} from "@/server/aione/helpers";
import { getHawkRunLogs, type HawkRunLogLine } from "@/server/hawk/run-logs";
import { buildCloudStoragePVCName } from "@/server/cloud-storage/naming";

export type AioneExternalType = "instance" | "task";
export type AioneExternalRunType = AioneExternalType | "model";
export type AioneClearType = AioneExternalType | "store";
type DevelopmentInstanceCloudStorageMounts =
  DevelopmentInstanceFormValues["cloudStorageMounts"];

const NODE_PORT_RETRIES = 3;
const EXTERNAL_HAWK_LOG_LIMIT = 10000;
const AUTO_REGISTERED_CLOUD_STORAGE_DESCRIPTION =
  "Auto-registered from external API datastore";
const TASK_DELETABLE_KINDS = [
  {
    apiPath: "/apis/batch/v1",
    kind: "jobs",
  },
  {
    apiPath: "/api/v1",
    kind: "pods",
  },
  {
    apiPath: "/api/v1",
    kind: "services",
  },
  {
    apiPath: "/api/v1",
    kind: "secrets",
  },
  {
    apiPath: "/apis/networking.k8s.io/v1",
    kind: "ingresses",
  },
] as const;
let allocationLock: Promise<void> = Promise.resolve();

export function parseAioneExternalType(type: string): AioneExternalType {
  const resolved = type.trim();
  if (resolved !== "instance" && resolved !== "task") {
    throw statusError("type must be instance or task", 400);
  }
  return resolved;
}

export function parseAioneExternalRunType(type: string): AioneExternalRunType {
  const resolved = type.trim();
  if (resolved !== "instance" && resolved !== "task" && resolved !== "model") {
    throw statusError("type must be instance, task, or model", 400);
  }
  return resolved;
}

export function parseAioneClearType(type: string): AioneClearType {
  const resolved = type.trim();
  if (resolved !== "instance" && resolved !== "task" && resolved !== "store") {
    throw statusError("type must be instance, task, or store", 400);
  }
  return resolved;
}

export async function createAioneExternalRun(
  type: AioneExternalRunType,
  payload: unknown,
) {
  if (type === "model") {
    return createModelAppRun(payload);
  }
  if (type === "task") {
    return createTrainingTaskRun(payload);
  }
  const enableSsh =
    typeof payload === "object" &&
    payload !== null &&
    (payload as { enableSsh?: unknown }).enableSsh === true;
  return enableSsh
    ? withNodePortAllocation(async () => createInstanceRun(payload))
    : createInstanceRun(payload);
}

export async function stopAioneExternalRun(
  type: AioneExternalType,
  sourceId: string,
) {
  return type === "task"
    ? stopTrainingTaskRun(sourceId)
    : stopInstanceRun(sourceId);
}

export async function clearAioneExternalResources(
  type: AioneClearType,
  sourceId: string,
) {
  switch (type) {
    case "instance":
      return clearInstanceRuntimeResources(sourceId);
    case "task":
      return clearTaskRuntimeResources(sourceId);
    case "store":
      return clearStoreRuntimeResources(sourceId);
  }
}

export async function getAioneExternalStatus(
  type: AioneExternalType,
  sourceId: string,
) {
  const runId =
    type === "task"
      ? await resolveTaskRunIdentifier(sourceId)
      : await resolveInstanceRunIdentifier(sourceId);
  const response = await createFlyteRunClient().getRunDetails({ runId });
  const action = response.details?.action;
  const status = action?.status;
  return {
    runId: formatFlyteRunId(runId),
    phase: status?.phase ?? 0,
    error: getActionError(action?.result),
    durationSeconds: getActionDurationSeconds(status),
  };
}

export async function getAioneExternalRunDetails(
  type: AioneExternalType,
  sourceId: string,
) {
  const { runId, resourceSpec } =
    type === "task"
      ? await resolveTaskRunContext(sourceId)
      : await resolveInstanceRunContext(sourceId);
  const response = await createFlyteRunClient().getRunDetails({ runId });
  return { runId, resourceSpec, details: response.details };
}

export async function getAioneExternalLogs(
  type: AioneExternalType,
  sourceId: string,
  pagination: { page: number; size: number },
) {
  const runId =
    type === "task"
      ? await resolveTaskRunIdentifier(sourceId)
      : await resolveInstanceRunIdentifier(sourceId);
  const response = await createFlyteRunClient().getRunDetails({ runId });
  const action = response.details?.action;
  const actionId = action?.id?.name?.trim() ?? "";
  const attempt = getLatestAttemptWithLogContext(action?.attempts ?? []);
  if (!actionId || !attempt) {
    return emptyAioneLogPage();
  }

  try {
    const logs = await getHawkRunLogs(
      {
        org: runId.org,
        project: runId.project,
        domain: runId.domain,
        runId: runId.name,
        actionId,
        attempt: attempt.attempt,
        limit: EXTERNAL_HAWK_LOG_LIMIT,
      },
      { getActionDetails: async () => action },
    );
    return paginateLogLines(
      hawkRunLogLinesToExternalLines(logs.lines),
      pagination,
    );
  } catch {
    throw statusError("failed to read Hawk logs", 502);
  }
}

export async function listAioneInstanceRuns(sourceInstanceId: string) {
  const sourceId = sourceInstanceId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const client = createDevelopmentInstanceClient();
  const instance = await getDevelopmentInstanceById(client, sourceId);
  const instanceID = requireDevelopmentInstanceIdentifier(instance);
  const response = await client.listDevelopmentInstanceRuns(
    create(ListDevelopmentInstanceRunsRequestSchema, { id: instanceID }),
  );
  return {
    total: response.total,
    runs: response.runs.map((run) => ({
      instanceId: run.instanceId,
      org: run.org,
      project: run.project,
      domain: run.domain,
      runName: run.runName,
      generation: run.generation,
      status: run.status,
      nodePort: run.nodePort,
      startedAt: run.startedAt?.seconds
        ? new Date(Number(run.startedAt.seconds) * 1000).toISOString()
        : "",
      endedAt: run.endedAt?.seconds
        ? new Date(Number(run.endedAt.seconds) * 1000).toISOString()
        : "",
    })),
  };
}

export async function getAioneExternalPvcSize(sourcePvcId: string) {
  const sourceId = sourcePvcId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }

  const cloudStorageClient = createCloudStorageClient();
  let cloudStorage;
  try {
    const response = await cloudStorageClient.getCloudStorageById(
      create(GetCloudStorageByIdRequestSchema, { id: sourceId }),
    );
    cloudStorage = response.cloudStorage;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw statusError("cloud storage record not found", 404);
    }
    throw error;
  }
  if (!cloudStorage?.id?.id) {
    throw statusError("cloud storage record not found", 404);
  }

  const namespace =
    cloudStorage.targetNamespace ||
    cloudStorage.materializations[0]?.targetNamespace ||
    AIONE_RUNTIME_NAMESPACE;
  const {
    apiOrigin,
    namespace: kubeNamespace,
    token,
    ca,
  } = await getKubernetesClientConfig(namespace);
  const { loadCloudStoragePvcStats } =
    await import("@/server/cloud-storage/stats");
  const { pvcs } = await loadCloudStoragePvcStats({
    apiOrigin,
    namespace: kubeNamespace,
    token,
    ca,
    storageId: sourceId,
    cloudStorage,
  });
  if (pvcs.length === 0) {
    throw statusError("cloud storage PVC not found", 404);
  }

  return aggregatePvcStats(pvcs);
}

export function aggregatePvcStats(pvcs: PvcStats[]) {
  const provisioned = pvcs.reduce(
    (total, pvc) => total + (pvc.capacityBytes ?? pvc.requestedBytes ?? 0),
    0,
  );
  const allUsageAvailable = pvcs.every(
    (pvc) =>
      pvc.filesystemCapacityBytes !== null &&
      pvc.filesystemCapacityBytes > 0 &&
      pvc.usedBytes !== null &&
      pvc.availableBytes !== null &&
      pvc.statsSource !== "unavailable",
  );
  if (!allUsageAvailable) {
    return {
      used: null,
      provisioned,
      available: null,
      usagePercent: null,
      statsSource: "unavailable" as const,
      statsTime: null,
    };
  }

  const used = pvcs.reduce((total, pvc) => total + (pvc.usedBytes ?? 0), 0);
  const available = pvcs.reduce(
    (total, pvc) => total + (pvc.availableBytes ?? 0),
    0,
  );
  const filesystemCapacity = pvcs.reduce(
    (total, pvc) => total + (pvc.filesystemCapacityBytes ?? 0),
    0,
  );
  const sources = new Set(pvcs.map((pvc) => pvc.statsSource));
  const statsSource =
    sources.size > 1
      ? ("mixed" as const)
      : pvcs[0].statsSource === "hawk_history"
        ? ("hawk_history" as const)
        : ("kubelet" as const);
  const observedTimes = pvcs.map((pvc) => pvc.statsTime);

  return {
    used,
    provisioned,
    available,
    usagePercent: Math.round((used / filesystemCapacity) * 100 * 100) / 100,
    statsSource,
    statsTime: observedTimes.every((value): value is string => value !== null)
      ? observedTimes.reduce((earliest, value) =>
          value < earliest ? value : earliest,
        )
      : null,
  };
}

async function createInstanceRun(payload: unknown) {
  const internalOrg =
    process.env.EXTERNAL_API_FLYTE_ORG?.trim() || DEFAULT_AIONE_INTERNAL_ORG;
  const defaultStorageClass =
    process.env.EXTERNAL_API_DEFAULT_STORAGE_CLASS?.trim() ||
    DEFAULT_AIONE_STORAGE_CLASS;
  const defaultAuthorizedKey =
    process.env.EXTERNAL_API_DEFAULT_AUTHORIZED_KEY?.trim() || "";

  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const developmentClient = createDevelopmentInstanceClient();
  const baseMapped = buildAioneInstanceValues({
    payload: payload as Parameters<
      typeof buildAioneInstanceValues
    >[0]["payload"],
    nodePort: 0,
    internalOrg,
    defaultStorageClass,
    defaultAuthorizedKey,
    runNameSuffix: "r0",
  });
  const existingInstance = await findDevelopmentInstanceById(
    developmentClient,
    baseMapped.sourceInstanceId,
  );
  if (
    existingInstance &&
    (await hasActiveLatestDevelopmentInstanceRun(existingInstance))
  ) {
    throw statusError("instance is already running", 409);
  }
  const generation = Number(existingInstance?.generation ?? 0) + 1;

  let lastError: unknown;
  const maxAttempts = baseMapped.values.enableSsh ? NODE_PORT_RETRIES : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const nodePort = baseMapped.values.enableSsh
      ? await allocateNodePort({
          apiOrigin,
          namespace,
          token,
          ca,
        })
      : 0;
    const mapped = buildAioneInstanceValues({
      payload: payload as Parameters<
        typeof buildAioneInstanceValues
      >[0]["payload"],
      nodePort,
      internalOrg,
      defaultStorageClass,
      defaultAuthorizedKey,
      runNameSuffix: `r${generation}`,
    });

    try {
      await ensureExternalSecrets({
        apiOrigin,
        namespace,
        token,
        ca,
        labels: buildWorkspaceLabels({
          org: internalOrg,
          project: mapped.values.project,
          domain: mapped.values.domain,
          runName: mapped.runName,
        }),
        registryCredentials: mapped.registryCredentials,
        imagePullSecretName: mapped.values.imagePullSecretName,
        codeRepositories: mapped.codeRepositoriesWithTokens,
        codeRepositorySecretName: mapped.values.codeRepositorySecretName,
      });

      const cloudStorageClient = createCloudStorageClient();
      await ensureExternalCloudStorages({
        client: cloudStorageClient,
        org: mapped.values.org,
        project: mapped.values.project,
        domain: mapped.values.domain,
        creator: mapped.values.sourceOrg || "external-api",
        mounts: mapped.values.cloudStorageMounts ?? [],
      });
      const saved = await developmentClient.createDevelopmentInstance(
        create(CreateDevelopmentInstanceRequestSchema, {
          project: create(ProjectIdentifierSchema, {
            organization: internalOrg,
            name: mapped.values.project,
            domain: mapped.values.domain,
          }),
          developmentInstance: buildDevelopmentInstanceInput(mapped.values),
          creator: mapped.values.sourceOrg || "external-api",
          developmentInstanceId: mapped.sourceInstanceId,
        }),
      );
      const instanceID =
        saved.developmentInstance?.id?.id || mapped.sourceInstanceId;
      const started = await developmentClient.startDevelopmentInstance(
        create(StartDevelopmentInstanceRequestSchema, {
          id: create(DevelopmentInstanceIdentifierSchema, { id: instanceID }),
          nodePort: mapped.values.enableSsh ? nodePort : 0,
        }),
      );
      const runName = started.runName || mapped.runName;
      await materializeExternalCloudStorages({
        client: cloudStorageClient,
        org: mapped.values.org,
        project: mapped.values.project,
        domain: mapped.values.domain,
        targetNamespace: namespace,
        mounts: mapped.values.cloudStorageMounts ?? [],
      });
      const info = buildAioneInstanceAccessInfo({
        runName,
        sourceName: mapped.values.sourceName ?? "",
        enableSsh: mapped.values.enableSsh,
        sshUser: mapped.values.sshUser,
        nodePort,
        cpu: mapped.values.cpu,
        memory: mapped.values.memory,
        gpuCount: mapped.values.gpuCount,
        publicHost: process.env.EXTERNAL_API_PUBLIC_HOST,
        codeServerHost: mapped.values.codeServerHost,
      });
      applyStartedDevelopmentInstanceAccessInfo(
        info,
        started.developmentInstance?.access,
      );
      const codeServerStatus = await readStartedCodeServerStatus({
        org: internalOrg,
        runName,
        project: mapped.values.project,
        domain: mapped.values.domain,
        apiOrigin,
        namespace,
        token,
        ca,
      });
      applyCodeServerStatus(info, codeServerStatus);
      return buildAioneCreateInstanceResponse({
        internalOrg,
        project: mapped.values.project,
        domain: mapped.values.domain,
        runName,
        sourceOrg: mapped.values.sourceOrg ?? "",
        sourceInstanceId: mapped.sourceInstanceId,
        info,
      }).data;
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw statusError("run already exists", 409);
      }
      lastError = error;
      if (!isLikelyNodePortConflict(error)) {
        throw error;
      }
    }
  }

  throw statusError(
    lastError instanceof Error ? lastError.message : "failed to create run",
    502,
  );
}

async function createTrainingTaskRun(payload: unknown) {
  const values = buildExternalTrainingTaskValues(payload);
  const client = createTrainingTaskClient();
  const existingTask = await findTrainingTaskById(client, values.sourceId);
  if (existingTask) {
    if (await hasActiveLatestRun(existingTask)) {
      throw statusError("task is already running", 409);
    }
    return startExistingTrainingTask({
      client,
      task: existingTask,
      sourceOrg: values.sourceOrg,
      sourceId: values.sourceId,
      fallbackTaskName: values.name,
    });
  }
  const codeRepositoryMounts = await createExternalCodeRepositories({
    values,
    creator: values.sourceOrg || "external-api",
  });
  await ensureExternalCloudStorages({
    client: createCloudStorageClient(),
    org: values.internalOrg,
    project: values.project,
    domain: values.domain,
    creator: values.sourceOrg || "external-api",
    mounts: values.cloudStorageMounts,
  });

  const created = await client.createTrainingTask(
    create(CreateTrainingTaskRequestSchema, {
      project: create(ProjectIdentifierSchema, {
        organization: values.internalOrg,
        name: values.project,
        domain: values.domain,
      }),
      trainingTask: create(TrainingTaskInputSchema, {
        name: values.name,
        description: values.description,
        command: values.command,
        maxRuntimeHours: values.maxRuntimeHours,
        imageType: ImageType.CUSTOM,
        imageName: values.image,
        imageUri: values.image,
        cpu: values.cpu,
        memory: values.memory,
        gpuCount: values.gpuCount,
        gpuModel: values.gpuModel,
        bandwidth: values.bandwidth,
        codeRepositoryMounts,
        cloudStorageMounts: values.cloudStorageMounts.map((mount) =>
          create(CloudStorageMountSchema, {
            cloudStorageId: mount.cloudStorageId,
            mountPath: mount.mountPath,
          }),
        ),
        datasets: values.datasets,
      }),
      creator: values.sourceOrg || "external-api",
      trainingTaskId: values.sourceId,
    }),
  );
  const taskID = created.trainingTask?.id;
  if (!taskID?.id) {
    throw statusError("failed to create training task", 502);
  }

  const started = await client.startTrainingTask(
    create(StartTrainingTaskRequestSchema, { id: taskID }),
  );
  const task = started.trainingTask ?? created.trainingTask;
  const runName = started.runName || task?.latestRunName;
  if (!runName) {
    throw statusError("failed to start training task", 502);
  }
  return buildAioneCreateTaskResponse({
    sourceOrg: values.sourceOrg,
    sourceId: values.sourceId,
    taskID,
    taskName: task?.name || values.name,
    runName,
  });
}

async function createModelAppRun(payload: unknown) {
  const request = buildExternalModelAppRequest(payload);
  const created = await createAppClient().createModelApp(request);
  const app = created.app;
  const appID = app?.metadata?.id;
  if (!appID?.name) {
    throw statusError("failed to create model app", 502);
  }
  const model = request.model;
  return {
    id: appID.name,
    source: {
      org: model?.org || "",
      id: model?.id || model?.code || appID.name,
    },
    app: {
      org: appID.org,
      project: appID.project,
      domain: appID.domain,
      name: appID.name,
      code: model?.code || appID.name,
      profile: app?.spec?.profile?.type || "VLLM",
      url: app?.status?.ingress?.publicUrl || "",
    },
  };
}

async function startExistingTrainingTask({
  client,
  task,
  sourceOrg,
  sourceId,
  fallbackTaskName,
}: {
  client: ReturnType<typeof createTrainingTaskClient>;
  task: TrainingTask;
  sourceOrg: string;
  sourceId: string;
  fallbackTaskName: string;
}) {
  const taskID = requireTrainingTaskIdentifier(task);
  const started = await client.startTrainingTask(
    create(StartTrainingTaskRequestSchema, { id: taskID }),
  );
  const startedTask = started.trainingTask ?? task;
  const runName = started.runName || startedTask.latestRunName;
  if (!runName) {
    throw statusError("failed to start training task", 502);
  }
  return buildAioneCreateTaskResponse({
    sourceOrg,
    sourceId,
    taskID,
    taskName: startedTask.name || fallbackTaskName,
    runName,
  });
}

async function stopInstanceRun(sourceInstanceId: string) {
  const sourceId = sourceInstanceId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  await createDevelopmentInstanceClient().stopDevelopmentInstance(
    create(StopDevelopmentInstanceRequestSchema, {
      id: create(DevelopmentInstanceIdentifierSchema, { id: sourceId }),
      reason: "Stopped from AIONE external instance API",
    }),
  );
  return {};
}

async function stopTrainingTaskRun(sourceTaskId: string) {
  const sourceId = sourceTaskId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const client = createTrainingTaskClient();
  const task = await getTrainingTaskById(client, sourceId);
  await client.stopTrainingTask(
    create(StopTrainingTaskRequestSchema, {
      id: requireTrainingTaskIdentifier(task),
      reason: "Stopped from AIONE external task API",
    }),
  );
  return {};
}

async function clearInstanceRuntimeResources(sourceInstanceId: string) {
  const sourceId = sourceInstanceId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const instance = await getDevelopmentInstanceById(
    createDevelopmentInstanceClient(),
    sourceId,
  );
  const instanceID = requireDevelopmentInstanceIdentifier(instance);
  if (!instance.latestRunName) {
    throw statusError("instance has no run", 404);
  }
  await assertLatestRunIsNotActive({
    type: "instance",
    org: instance.org,
    project: instance.project,
    domain: instance.domain,
    runName: instance.latestRunName,
  });
  const labelSelector = buildWorkspaceLabelSelector({
    org: instance.org,
    project: instance.project,
    domain: instance.domain,
    runName: instance.latestRunName,
  });
  const deleted = await deleteRuntimeCollections(
    { token, ca },
    buildDeleteCollectionRequests({
      apiOrigin,
      namespace,
      labelSelector,
    }),
  );
  return { type: "instance", id: instanceID.id, deleted };
}

async function clearTaskRuntimeResources(sourceTaskId: string) {
  const sourceId = sourceTaskId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const kubeContext = { apiOrigin, namespace, token, ca };
  const task = await getTrainingTaskById(createTrainingTaskClient(), sourceId);
  const taskID = requireTrainingTaskIdentifier(task);
  if (!task.latestRunName) {
    throw statusError("task has no run", 404);
  }
  await assertLatestRunIsNotActive({
    type: "task",
    org: taskID.org,
    project: taskID.project,
    domain: taskID.domain,
    runName: task.latestRunName,
  });
  const labelSelector = buildTaskLabelSelector({
    project: taskID.project,
    domain: taskID.domain,
    runName: task.latestRunName,
  });
  const deleted = await deleteRuntimeCollections(
    kubeContext,
    TASK_DELETABLE_KINDS.map(({ apiPath, kind }) => ({
      method: "DELETE" as const,
      kind,
      url: `${apiOrigin}${apiPath}/namespaces/${encodeURIComponent(namespace)}/${kind}?labelSelector=${encodeURIComponent(labelSelector)}`,
    })),
  );
  return { type: "task", id: sourceId, deleted };
}

async function clearStoreRuntimeResources(sourceStoreId: string) {
  const sourceId = sourceStoreId.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const { apiOrigin, namespace, token, ca } = await getKubernetesClientConfig(
    AIONE_RUNTIME_NAMESPACE,
  );
  const cloudStorageClient = createCloudStorageClient();
  let cloudStorage;
  try {
    const response = await cloudStorageClient.getCloudStorageById(
      create(GetCloudStorageByIdRequestSchema, { id: sourceId }),
    );
    cloudStorage = response.cloudStorage;
  } catch (error) {
    if (
      error instanceof ConnectError &&
      error.code === Code.FailedPrecondition
    ) {
      throw statusError(error.message, 409);
    }
    throw error;
  }
  const cloudStorageId = cloudStorage?.id;
  if (!cloudStorageId?.id) {
    throw statusError("cloud storage record not found", 404);
  }

  const labelSelector = [
    ["flyte.org/cloud-storage", "true"],
    ["flyte.org/cloud-storage-id", sourceId],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
  const pvcList = await listKubernetesResources<KubernetesPVCList>({
    apiOrigin,
    namespace,
    token,
    ca,
    apiPath: "/api/v1",
    kind: "persistentvolumeclaims",
    labelSelector,
  });
  const pvcNames = pvcList.items
    .map((item) => item.metadata?.name?.trim() ?? "")
    .filter(Boolean);
  await assertPVCsAreUnused({
    apiOrigin,
    namespace,
    token,
    ca,
    pvcNames,
  });

  const deleted = await Promise.all(
    pvcNames.map(async (pvcName) => {
      const response = await requestKubernetes({
        url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`,
        method: "DELETE",
        token,
        ca,
      });
      if (!response.ok && response.status !== 404) {
        throw statusError(
          response.text || `failed to delete PVC ${pvcName}`,
          502,
        );
      }
      return {
        kind: "persistentvolumeclaims",
        name: pvcName,
        ok: true,
        status: response.status,
      };
    }),
  );

  await cloudStorageClient.clearCloudStorageMaterializations(
    create(ClearCloudStorageMaterializationsRequestSchema, {
      id: create(CloudStorageIdentifierSchema, cloudStorageId),
    }),
  );

  return { type: "store", id: sourceId, deleted };
}

async function resolveInstanceRunIdentifier(
  id: string,
): Promise<FlyteRunIdentifier> {
  return (await resolveInstanceRunContext(id)).runId;
}

async function resolveInstanceRunContext(id: string): Promise<{
  runId: FlyteRunIdentifier;
  resourceSpec?: { cpu?: string; memory?: string };
}> {
  const sourceOrRunId = id.trim();
  if (!sourceOrRunId) {
    throw statusError("id is required", 400);
  }
  const directRunId = parseFlyteWorkflowId(sourceOrRunId);
  if (directRunId) {
    return { runId: directRunId };
  }

  const instance = await getDevelopmentInstanceById(
    createDevelopmentInstanceClient(),
    sourceOrRunId,
  );
  if (instance.latestRunName) {
    return {
      runId: {
        org: instance.org,
        project: instance.project,
        domain: instance.domain,
        name: instance.latestRunName,
      },
      resourceSpec: {
        cpu: instance.resourceSpec?.cpu,
        memory: instance.resourceSpec?.memory,
      },
    };
  }

  throw statusError(
    "instance has no run and id is not a Flyte workflow id",
    404,
  );
}

async function resolveTaskRunIdentifier(
  id: string,
): Promise<FlyteRunIdentifier> {
  return (await resolveTaskRunContext(id)).runId;
}

async function resolveTaskRunContext(id: string): Promise<{
  runId: FlyteRunIdentifier;
  resourceSpec?: { cpu?: string; memory?: string };
}> {
  const sourceId = id.trim();
  if (!sourceId) {
    throw statusError("id is required", 400);
  }
  const task = await getTrainingTaskById(createTrainingTaskClient(), sourceId);
  const taskID = requireTrainingTaskIdentifier(task);
  if (!task.latestRunName) {
    throw statusError("task has no run", 404);
  }
  return {
    runId: {
      org: taskID.org,
      project: taskID.project,
      domain: taskID.domain,
      name: task.latestRunName,
    },
    resourceSpec: {
      cpu: task.resourceSpec?.cpu,
      memory: task.resourceSpec?.memory,
    },
  };
}

function getLatestAttemptLogContext(
  attempts: Array<{ attempt: number; logContext?: LogContext }>,
) {
  return getLatestAttemptWithLogContext(attempts)?.logContext;
}

function getLatestAttemptWithLogContext(
  attempts: Array<{ attempt: number; logContext?: LogContext }>,
) {
  let latest: { attempt: number; logContext: LogContext } | undefined;
  for (const attempt of attempts) {
    if (!attempt.logContext) {
      continue;
    }
    if (!latest || attempt.attempt > latest.attempt) {
      latest = { attempt: attempt.attempt, logContext: attempt.logContext };
    }
  }
  return latest;
}

function getPrimaryPodLogContext(logContext: LogContext) {
  if (logContext.pods.length === 0) {
    return undefined;
  }
  const primaryPodName = logContext.primaryPodName.trim();
  if (!primaryPodName) {
    return logContext.pods[0];
  }
  return (
    logContext.pods.find((pod) => pod.podName === primaryPodName) ??
    logContext.pods[0]
  );
}

function getPrimaryContainerName(pod: PodLogContext) {
  const primaryContainerName = pod.primaryContainerName.trim();
  if (primaryContainerName) {
    return primaryContainerName;
  }
  return (
    pod.containers.find((container) => container.containerName.trim())
      ?.containerName ??
    pod.initContainers.find((container) => container.containerName.trim())
      ?.containerName ??
    ""
  ).trim();
}

async function readKubernetesPodLog({
  pod,
  containerName,
}: {
  pod: PodLogContext;
  containerName: string;
}) {
  const targetNamespace = pod.namespace.trim() || AIONE_RUNTIME_NAMESPACE;
  const { apiOrigin, namespace, token, ca } =
    await getKubernetesClientConfig(targetNamespace);
  const searchParams = new URLSearchParams({
    container: containerName,
    timestamps: "false",
  });
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod.podName)}/log?${searchParams.toString()}`,
    token,
    ca,
  });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw statusError(response.text || "failed to read pod logs", 502);
  }
  return splitLogLines(response.text);
}

function splitLogLines(text: string) {
  if (!text) {
    return [];
  }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function hawkRunLogLinesToExternalLines(lines: HawkRunLogLine[]) {
  return [...lines]
    .sort(
      (left, right) =>
        hawkLogTimestampMillis(right.timestamp) -
        hawkLogTimestampMillis(left.timestamp),
    )
    .flatMap((line) => {
      const time = hawkLogTimestampIso(line.timestamp);
      return splitLogLines(line.message).map((log) => ({ time, log }));
    });
}

function paginateLogLines(
  lines: Array<{ time: string; log: string }>,
  pagination: { page: number; size: number },
) {
  const start = (pagination.page - 1) * pagination.size;
  return {
    total: lines.length,
    logs: lines.slice(start, start + pagination.size),
  };
}

function hawkLogTimestampIso(timestamp: HawkRunLogLine["timestamp"]) {
  const milliseconds = hawkLogTimestampMillis(timestamp);
  return timestamp && Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : "";
}

function hawkLogTimestampMillis(timestamp: HawkRunLogLine["timestamp"]) {
  if (!timestamp) {
    return 0;
  }
  const seconds = Number(timestamp.seconds);
  const nanos = Number(timestamp.nanos ?? 0);
  if (!Number.isFinite(seconds) || !Number.isFinite(nanos)) {
    return 0;
  }
  return seconds * 1000 + Math.floor(nanos / 1_000_000);
}

function emptyAioneLogPage() {
  return { total: 0, logs: [] };
}

async function hasActiveLatestRun(task: TrainingTask) {
  if (!task.latestRunName) {
    return false;
  }
  const taskID = requireTrainingTaskIdentifier(task);
  try {
    const response = await createFlyteRunClient().getRunDetails({
      runId: {
        org: taskID.org,
        project: taskID.project,
        domain: taskID.domain,
        name: task.latestRunName,
      },
    });
    return isActiveActionPhase(response.details?.action?.status?.phase);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function hasActiveLatestDevelopmentInstanceRun(
  instance: DevelopmentInstance,
) {
  if (!instance.latestRunName) {
    return false;
  }
  try {
    const response = await createFlyteRunClient().getRunDetails({
      runId: {
        org: instance.org,
        project: instance.project,
        domain: instance.domain,
        name: instance.latestRunName,
      },
    });
    return isActiveActionPhase(response.details?.action?.status?.phase);
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

async function assertLatestRunIsNotActive({
  type,
  org,
  project,
  domain,
  runName,
}: {
  type: "instance" | "task";
  org: string;
  project: string;
  domain: string;
  runName: string;
}) {
  if (!runName) {
    return;
  }
  try {
    const response = await createFlyteRunClient().getRunDetails({
      runId: { org, project, domain, name: runName },
    });
    if (isActiveActionPhase(response.details?.action?.status?.phase)) {
      throw statusError(`${type} is running; stop it before clear`, 409);
    }
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    throw error;
  }
}

function buildExternalTrainingTaskValues(payload: unknown) {
  const object = getPayloadObject(payload);
  const internalOrg =
    process.env.EXTERNAL_API_FLYTE_ORG?.trim() || DEFAULT_AIONE_INTERNAL_ORG;
  const sourceOrg = stringField(object, "org");
  const sourceId = requiredStringField(object, "id");
  const name = stringField(object, "name") || sourceId;
  const command = stringField(object, "cmd");
  if (!command) {
    throw statusError("cmd is required", 400);
  }
  const image = resolveTrainingTaskImage(object);
  const resources = getPayloadObject(object.resourceDefinition);
  const datasets = parseExternalRuntimeDatasets(object.ossDatas, "ossDatas");
  const codeRepositories = parseExternalCodeRepositories(object.codes);
  const defaultStorageClass =
    process.env.EXTERNAL_API_DEFAULT_STORAGE_CLASS?.trim() ||
    DEFAULT_AIONE_STORAGE_CLASS;
  const cloudStorageMounts = parseExternalCloudStorageMounts(
    object.datastores,
    defaultStorageClass,
  );
  return {
    internalOrg,
    sourceOrg,
    sourceId,
    project: requiredStringField(object, "project"),
    domain: requiredStringField(object, "domain"),
    name,
    description: sourceOrg ? `${sourceOrg}/${sourceId}` : sourceId,
    command,
    maxRuntimeHours: positiveNumberField(object.timeout, 24, "timeout"),
    image,
    cpu: requiredStringField(resources, "cpu"),
    memory: requiredStringField(resources, "memory"),
    gpuCount: nonNegativeIntegerField(
      resources.gpu,
      0,
      "resourceDefinition.gpu",
    ),
    gpuModel: stringField(resources, "gpuModel"),
    bandwidth: stringField(resources, "bandwidth"),
    codeRepositories,
    cloudStorageMounts,
    datasets,
  };
}

function buildExternalModelAppRequest(payload: unknown) {
  const object = getPayloadObject(payload);
  const resources = getPayloadObject(object.resourceDefinition);
  const id = stringField(object, "id");
  const code = stringField(object, "code") || id;
  const name = stringField(object, "name") || code || id;
  if (!id && !code && !name) {
    throw statusError("id, code, or name is required", 400);
  }

  return create(CreateModelAppRequestSchema, {
    model: create(ModelAppInputSchema, {
      org:
        stringField(object, "org") ||
        process.env.EXTERNAL_API_FLYTE_ORG?.trim() ||
        DEFAULT_AIONE_INTERNAL_ORG,
      project: requiredStringField(object, "project"),
      domain: requiredStringField(object, "domain"),
      name,
      id,
      code,
      image: stringField(object, "image") || "vllm",
      param: stringField(object, "param"),
      codes: parseExternalModelCodeSources(object.codes),
      resourceDefinition: create(ModelResourceDefinitionSchema, {
        cpu: stringField(resources, "cpu"),
        memory: stringField(resources, "memory"),
        gpu: nonNegativeIntegerField(
          resources.gpu,
          0,
          "resourceDefinition.gpu",
        ),
        gpuKey:
          stringField(resources, "gpu_key") || stringField(resources, "gpuKey"),
      }),
    }),
  });
}

function parseExternalModelCodeSources(value: unknown) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw statusError("codes must be an array", 400);
  }
  return value.map((item, index) => {
    const code = getPayloadObject(item);
    return create(ModelCodeSourceSchema, {
      id: requiredStringField(code, "id", `codes[${index}].id`),
      branch: stringField(code, "branch"),
      path: stringField(code, "path"),
      token: stringField(code, "token"),
    });
  });
}

function parseExternalCloudStorageMounts(
  value: unknown,
  defaultStorageClass: string,
): NonNullable<DevelopmentInstanceCloudStorageMounts> {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw statusError("datastores must be an array", 400);
  }
  return value.map((item, index) => {
    const datastore = getPayloadObject(item);
    const id = requiredStringField(datastore, "id", `datastores[${index}].id`);
    return {
      cloudStorageId: id,
      pvcName: buildCloudStoragePVCName(id),
      storageClass: defaultStorageClass,
      size: `${positiveNumberField(
        datastore.size,
        1,
        `datastores[${index}].size`,
      )}Gi`,
      mountPath: requiredAbsolutePathField(
        datastore,
        "path",
        `datastores[${index}].path`,
      ),
    };
  });
}

function parseExternalCodeRepositories(value: unknown) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw statusError("codes must be an array", 400);
  }
  return value.map((item, index) => {
    const code = getPayloadObject(item);
    const repoURL = requiredStringField(code, "id", `codes[${index}].id`);
    return {
      id: repoURL,
      repoUrl: repoURL,
      branch: stringField(code, "branch") || "master",
      mountPath: requiredAbsolutePathField(
        code,
        "path",
        `codes[${index}].path`,
      ),
      token: requiredStringField(code, "token", `codes[${index}].token`),
    };
  });
}

async function createExternalCodeRepositories({
  values,
  creator,
}: {
  values: ReturnType<typeof buildExternalTrainingTaskValues>;
  creator: string;
}) {
  if (values.codeRepositories.length === 0) {
    return [];
  }
  const client = createCodeRepositoryClient();
  const project = create(ProjectIdentifierSchema, {
    organization: values.internalOrg,
    name: values.project,
    domain: values.domain,
  });
  const mounts = [];
  for (const repo of values.codeRepositories) {
    const created = await client.createCodeRepository(
      create(CreateCodeRepositoryRequestSchema, {
        project,
        codeRepository: create(CodeRepositoryInputSchema, {
          repoUrl: repo.repoUrl,
          branch: repo.branch,
          mountPath: repo.mountPath,
          token: repo.token ?? "",
        }),
        creator,
      }),
    );
    const codeRepositoryId = created.codeRepository?.id?.id;
    if (!codeRepositoryId) {
      throw statusError("failed to create code repository", 502);
    }
    mounts.push(
      create(CodeRepositoryMountSchema, {
        codeRepositoryId,
        mountPath: repo.mountPath,
      }),
    );
  }
  return mounts;
}

function parseExternalRuntimeDatasets(value: unknown, fieldName: string) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw statusError(`${fieldName} must be an array`, 400);
  }
  return value.map((item, index) => {
    const dataset = getPayloadObject(item);
    for (const field of ["endPoint", "Endpoint", "end_point"]) {
      if (Object.prototype.hasOwnProperty.call(dataset, field)) {
        throw statusError(
          `${fieldName}[${index}].${field} is not supported; use endpoint`,
          400,
        );
      }
    }
    const endpoint = requiredStringField(
      dataset,
      "endpoint",
      `${fieldName}[${index}].endpoint`,
    );
    if (endpoint.includes("://")) {
      throw statusError(
        `${fieldName}[${index}].endpoint must not include scheme`,
        400,
      );
    }
    const portValue = dataset.port;
    const port =
      typeof portValue === "number" || typeof portValue === "string"
        ? String(portValue).trim()
        : "";
    if (!port) {
      throw statusError(`${fieldName}[${index}].port is required`, 400);
    }
    const bucketPath = stringField(dataset, "bucketPath");
    if (
      bucketPath.includes("..") ||
      bucketPath.includes("\\") ||
      bucketPath.includes("://")
    ) {
      throw statusError(
        `${fieldName}[${index}].bucketPath cannot contain .., backslash, or URL scheme`,
        400,
      );
    }
    return create(RuntimeDatasetSchema, {
      endpoint,
      port,
      accessKey: requiredStringField(
        dataset,
        "accessKey",
        `${fieldName}[${index}].accessKey`,
      ),
      secretKey: requiredStringField(
        dataset,
        "secretKey",
        `${fieldName}[${index}].secretKey`,
      ),
      targetPath: requiredAbsolutePathField(
        dataset,
        "targetPath",
        `${fieldName}[${index}].targetPath`,
      ),
      bucket: requiredStringField(
        dataset,
        "bucket",
        `${fieldName}[${index}].bucket`,
      ),
      bucketPath,
    });
  });
}

function buildAioneCreateTaskResponse({
  sourceOrg,
  sourceId,
  taskID,
  taskName,
  runName,
}: {
  sourceOrg: string;
  sourceId: string;
  taskID: TrainingTaskIdentifier;
  taskName: string;
  runName: string;
}) {
  return {
    id: sourceId,
    run: {
      org: taskID.org,
      project: taskID.project,
      domain: taskID.domain,
      name: runName,
    },
    source: {
      org: sourceOrg,
      id: sourceId,
    },
    task: {
      id: taskID.id,
      name: taskName,
      latestRunName: runName,
    },
  };
}

function resolveTrainingTaskImage(payload: Record<string, unknown>) {
  const imageType = stringField(payload, "imageType") || "BASE";
  if (imageType === "OWN") {
    return requiredStringField(payload, "image");
  }
  if (imageType !== "BASE") {
    throw statusError("imageType must be BASE or OWN", 400);
  }
  return requiredStringField(
    getPayloadObject(payload.baseImage),
    "image",
    "baseImage.image",
  );
}

function createFlyteRunClient() {
  return createClient(
    RunService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function createTrainingTaskClient() {
  return createClient(
    TrainingTaskService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function createDevelopmentInstanceClient() {
  return createClient(
    DevelopmentInstanceService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function createAppClient() {
  return createClient(
    AppService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function applyStartedDevelopmentInstanceAccessInfo(
  info: AioneInstanceAccessInfo,
  access?: DevelopmentInstanceAccessInfo,
) {
  if (!access) {
    return;
  }

  const sshPort = Number(access.nodePort || 0);
  if (sshPort > 0 && info.ssh) {
    info.ssh.port = sshPort;
    info.ssh.command = `ssh -p ${sshPort} ${info.ssh.user}@${info.ssh.host}`;
  }

  const codeServerURL = access.codeServerUrl.trim();
  const codeServerWorkspaceURL = access.codeServerWorkspaceUrl.trim();
  if (codeServerURL) {
    info.codeServer.url = codeServerURL;
    info.codeServer.workspaceUrl = codeServerWorkspaceURL || codeServerURL;
    const parsed = parseURL(codeServerURL);
    if (parsed) {
      info.codeServer.host = parsed.host;
      info.codeServer.port = urlPort(parsed, info.codeServer.port);
    }
    return;
  }
}

type CodeServerRuntimeStatus = {
  available: boolean;
  reason?: string;
  message?: string;
};

function applyCodeServerStatus(
  info: AioneInstanceAccessInfo,
  status: CodeServerRuntimeStatus,
) {
  info.codeServer.available = status.available;
  info.codeServer.reason = status.reason;
  info.codeServer.message = status.message;
}

async function readStartedCodeServerStatus({
  org,
  project,
  domain,
  runName,
  apiOrigin,
  namespace,
  token,
  ca,
}: {
  org: string;
  project: string;
  domain: string;
  runName: string;
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
}): Promise<CodeServerRuntimeStatus> {
  const fromLogContext = await readCodeServerStatusFromRunDetails({
    org,
    project,
    domain,
    runName,
  });
  if (fromLogContext) {
    return fromLogContext;
  }
  const fromPods = await readCodeServerStatusFromPods({
    org,
    project,
    domain,
    runName,
    apiOrigin,
    namespace,
    token,
    ca,
  });
  return fromPods ?? { available: true };
}

async function readCodeServerStatusFromRunDetails({
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
  try {
    const response = await createFlyteRunClient().getRunDetails({
      runId: { org, project, domain, name: runName },
    });
    const logContext = getLatestAttemptLogContext(
      response.details?.action?.attempts ?? [],
    );
    if (!logContext) {
      return undefined;
    }
    const pod = getPrimaryPodLogContext(logContext);
    const containerName = pod ? getPrimaryContainerName(pod) : "";
    if (!pod?.podName || !containerName) {
      return undefined;
    }
    return parseCodeServerStatus(
      await readKubernetesPodLog({ pod, containerName }),
    );
  } catch {
    return undefined;
  }
}

async function readCodeServerStatusFromPods({
  org,
  project,
  domain,
  runName,
  apiOrigin,
  namespace,
  token,
  ca,
}: {
  org: string;
  project: string;
  domain: string;
  runName: string;
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
}) {
  try {
    const pods = await listKubernetesResources<KubernetesPodList>({
      apiOrigin,
      namespace,
      token,
      ca,
      apiPath: "/api/v1",
      kind: "pods",
      labelSelector: buildWorkspaceLabelSelector({
        org,
        project,
        domain,
        runName,
      }),
    });
    for (const pod of pods.items) {
      const phase = pod.status?.phase ?? "";
      if (phase === "Succeeded" || phase === "Failed") {
        continue;
      }
      const podName = pod.metadata?.name ?? "";
      if (!podName) {
        continue;
      }
      const containerName =
        pod.spec?.containers?.find((container) => container.name === "ssh")
          ?.name ||
        pod.spec?.containers?.find((container) => container.name)?.name ||
        "ssh";
      const status = parseCodeServerStatus(
        await readKubernetesPodLogByName({
          apiOrigin,
          namespace,
          token,
          ca,
          podName,
          containerName,
        }),
      );
      if (status) {
        return status;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function readKubernetesPodLogByName({
  apiOrigin,
  namespace,
  token,
  ca,
  podName,
  containerName,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  podName: string;
  containerName: string;
}) {
  const searchParams = new URLSearchParams({
    container: containerName,
    timestamps: "false",
  });
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/log?${searchParams.toString()}`,
    token,
    ca,
  });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw statusError(response.text || "failed to read pod logs", 502);
  }
  return splitLogLines(response.text);
}

function parseCodeServerStatus(lines: string[]) {
  const prefix = "AIONE_CODE_SERVER_STATUS ";
  for (const line of lines) {
    const index = line.indexOf(prefix);
    if (index < 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(line.slice(index + prefix.length)) as {
        available?: unknown;
        reason?: unknown;
        message?: unknown;
      };
      if (typeof parsed.available !== "boolean") {
        continue;
      }
      return {
        available: parsed.available,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        message:
          typeof parsed.message === "string" ? parsed.message : undefined,
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

function parseURL(value: string) {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function urlPort(url: URL, fallback: number) {
  if (url.port) {
    return Number(url.port);
  }
  if (url.protocol === "https:") {
    return 443;
  }
  if (url.protocol === "http:") {
    return 80;
  }
  return fallback;
}

function createCloudStorageClient() {
  return createClient(
    CloudStorageService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function createCodeRepositoryClient() {
  return createClient(
    CodeRepositoryService,
    createConnectTransport({
      baseUrl: getFlyteApiOrigin(),
    }),
  );
}

function buildDevelopmentInstanceInput(values: DevelopmentInstanceFormValues) {
  return create(DevelopmentInstanceInputSchema, {
    name:
      values.sourceName?.trim() ||
      values.sourceInstanceId?.trim() ||
      values.name.trim(),
    description: values.description?.trim() ?? "",
    owner: values.owner?.trim() ?? "",
    imageType:
      values.imageType === "official"
        ? DevelopmentInstanceImageType.OFFICIAL
        : DevelopmentInstanceImageType.CUSTOM,
    officialImageId: values.officialImageId,
    imageName: values.image,
    imageUri: values.image,
    enableSsh: values.enableSsh,
    sshUser: values.sshUser,
    authorizedKeys: values.enableSsh
      ? [values.authorizedKey].filter((key) => key.trim())
      : [],
    cpu: values.cpu,
    memory: values.memory,
    gpuCount: values.gpuCount ?? 0,
    gpuModel: values.gpuModel ?? "",
    maxHours: values.maxHours,
    sourceSystem: values.sourceSystem ?? "",
    cloudStorageMounts: (values.cloudStorageMounts ?? []).map((mount) =>
      create(CloudStorageMountSchema, {
        cloudStorageId: mount.cloudStorageId,
        mountPath: mount.mountPath,
      }),
    ),
    codeRepositoryMounts: (values.codeRepositories ?? []).map((repo) =>
      create(CodeRepositoryMountSchema, {
        codeRepositoryId: repo.id,
        mountPath: repo.mountPath,
      }),
    ),
    codeRepositoryDetails: (values.codeRepositories ?? []).map((repo) =>
      create(DevelopmentInstanceCodeRepositoryDetailSchema, {
        id: repo.id,
        repoUrl: repo.repoUrl,
        branch: repo.branch,
        mountPath: repo.mountPath,
        token: repo.token ?? "",
      }),
    ),
    datasets: (values.datasets ?? []).map((dataset) =>
      create(RuntimeDatasetSchema, {
        endpoint: dataset.endpoint,
        port: dataset.port,
        accessKey: dataset.accessKey,
        secretKey: dataset.secretKey,
        targetPath: dataset.targetPath,
        bucket: dataset.bucket,
        bucketPath: dataset.bucketPath ?? "",
      }),
    ),
    datasetMounts: (values.datasetMounts ?? []).map((mount) =>
      create(DatasetMountSchema, {
        datasetId: mount.datasetId,
        targetPath: mount.targetPath,
      }),
    ),
    imagePullSecretName: values.imagePullSecretName ?? "",
    codeRepositorySecretName: values.codeRepositorySecretName ?? "",
    gpuNodeLabelKey: values.gpuNodeLabelKey ?? "",
    baseImageMountPath: values.baseImageMountPath ?? "",
  });
}

function getFlyteApiOrigin() {
  return (
    process.env.FLYTE_API_ORIGIN?.trim() ||
    "http://flyte-binary-http.flyte.svc.cluster.local:8090"
  );
}

function buildTaskLabelSelector({
  project,
  domain,
  runName,
}: {
  project: string;
  domain: string;
  runName: string;
}) {
  return [
    ["flyte.org/run-name", runName],
    ["flyte.org/project", project],
    ["flyte.org/domain", domain],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join(",");
}

async function deleteRuntimeCollections(
  kubeContext: {
    token: string;
    ca: string;
  },
  deleteRequests: Array<{ method: "DELETE"; kind: string; url: string }>,
) {
  const results = await Promise.all(
    deleteRequests.map(async (deleteRequest) => {
      const response = await requestKubernetes({
        url: deleteRequest.url,
        method: deleteRequest.method,
        token: kubeContext.token,
        ca: kubeContext.ca,
      });
      if (!response.ok && response.status !== 404) {
        return {
          kind: deleteRequest.kind,
          ok: false,
          status: response.status,
          body: response.text,
        };
      }
      return {
        kind: deleteRequest.kind,
        ok: true,
        status: response.status,
      };
    }),
  );
  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    throw statusError(
      `failed to delete runtime resources: ${failures
        .map((failure) => `${failure.kind}(${failure.status})`)
        .join(", ")}`,
      502,
    );
  }
  return results;
}

async function listKubernetesResources<T>({
  apiOrigin,
  namespace,
  token,
  ca,
  apiPath,
  kind,
  labelSelector,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  apiPath: string;
  kind: string;
  labelSelector?: string;
}) {
  const search = labelSelector
    ? `?labelSelector=${encodeURIComponent(labelSelector)}`
    : "";
  const response = await requestKubernetes({
    url: `${apiOrigin}${apiPath}/namespaces/${encodeURIComponent(namespace)}/${kind}${search}`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(response.text || `failed to list ${kind}`, 502);
  }
  return response.json<T>();
}

async function assertPVCsAreUnused({
  apiOrigin,
  namespace,
  token,
  ca,
  pvcNames,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  pvcNames: string[];
}) {
  if (pvcNames.length === 0) {
    return;
  }
  const pvcSet = new Set(pvcNames);
  const podList = await listKubernetesResources<KubernetesPodList>({
    apiOrigin,
    namespace,
    token,
    ca,
    apiPath: "/api/v1",
    kind: "pods",
  });
  for (const pod of podList.items) {
    const phase = pod.status?.phase ?? "";
    if (phase === "Succeeded" || phase === "Failed") {
      continue;
    }
    const podName = pod.metadata?.name ?? "";
    for (const volume of pod.spec?.volumes ?? []) {
      const claimName = volume.persistentVolumeClaim?.claimName;
      if (claimName && pvcSet.has(claimName)) {
        throw statusError(`store PVC is still used by pod ${podName}`, 409);
      }
    }
  }
}

async function allocateNodePort({
  apiOrigin,
  namespace,
  token,
  ca,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
}) {
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/services`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(
      response.text || "failed to list Kubernetes services",
      502,
    );
  }
  const usedPorts = extractNodePorts(response.json<KubernetesServiceList>());
  return getNextNodePort(usedPorts, getAioneNodePortRange());
}

async function ensureExternalSecrets({
  apiOrigin,
  namespace,
  token,
  ca,
  labels,
  registryCredentials,
  imagePullSecretName,
  codeRepositories,
  codeRepositorySecretName,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  labels: Record<string, string>;
  registryCredentials?: RegistryCredentials;
  imagePullSecretName?: string;
  codeRepositories: CodeRepositoryWithToken[];
  codeRepositorySecretName?: string;
}) {
  if (registryCredentials && imagePullSecretName) {
    await createOrReplaceSecret({
      apiOrigin,
      namespace,
      token,
      ca,
      name: imagePullSecretName,
      labels,
      type: "kubernetes.io/dockerconfigjson",
      stringData: {
        ".dockerconfigjson": buildDockerConfigJson(registryCredentials),
      },
    });
  }
  if (codeRepositorySecretName && codeRepositories.length > 0) {
    await createOrReplaceSecret({
      apiOrigin,
      namespace,
      token,
      ca,
      name: codeRepositorySecretName,
      labels,
      type: "Opaque",
      stringData: {
        code_repositories: JSON.stringify(codeRepositories),
      },
    });
  }
}

async function ensureExternalCloudStorages({
  client,
  org,
  project,
  domain,
  creator,
  mounts,
}: {
  client: ReturnType<typeof createCloudStorageClient>;
  org: string;
  project: string;
  domain: string;
  creator: string;
  mounts: NonNullable<DevelopmentInstanceCloudStorageMounts>;
}) {
  await Promise.all(
    mounts.map((mount) =>
      client.ensureCloudStorage(
        create(EnsureCloudStorageRequestSchema, {
          id: createCloudStorageIdentifier({
            org,
            project,
            domain,
            id: mount.cloudStorageId,
          }),
          cloudStorage: create(CloudStorageInputSchema, {
            name: mount.cloudStorageId,
            description: AUTO_REGISTERED_CLOUD_STORAGE_DESCRIPTION,
            sizeGb: storageSizeToGb(mount.size),
            storageClassName: mount.storageClass,
          }),
          creator,
        }),
      ),
    ),
  );
}

async function materializeExternalCloudStorages({
  client,
  org,
  project,
  domain,
  targetNamespace,
  mounts,
}: {
  client: ReturnType<typeof createCloudStorageClient>;
  org: string;
  project: string;
  domain: string;
  targetNamespace: string;
  mounts: NonNullable<DevelopmentInstanceCloudStorageMounts>;
}) {
  await Promise.all(
    mounts.map((mount) =>
      client.materializeCloudStorage(
        create(MaterializeCloudStorageRequestSchema, {
          id: createCloudStorageIdentifier({
            org,
            project,
            domain,
            id: mount.cloudStorageId,
          }),
          targetNamespace,
          pvcName: mount.pvcName,
        }),
      ),
    ),
  );
}

function createCloudStorageIdentifier({
  org,
  project,
  domain,
  id,
}: {
  org: string;
  project: string;
  domain: string;
  id: string;
}) {
  return create(CloudStorageIdentifierSchema, {
    org,
    project,
    domain,
    id,
  });
}

function storageSizeToGb(size: string) {
  const parsed = /^(\d+)Gi$/.exec(size.trim());
  return parsed ? Number(parsed[1]) : 1;
}

async function createOrReplaceSecret({
  apiOrigin,
  namespace,
  token,
  ca,
  name,
  labels,
  type,
  stringData,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  name: string;
  labels: Record<string, string>;
  type: string;
  stringData: Record<string, string>;
}) {
  const body = JSON.stringify({
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name, namespace, labels },
    type,
    stringData,
  });
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets`,
    method: "POST",
    token,
    ca,
    body,
    headers: { "content-type": "application/json" },
  });
  if (response.ok) {
    return;
  }
  if (response.status !== 409) {
    throw statusError(response.text || `failed to create secret ${name}`, 502);
  }
  const replace = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`,
    method: "PUT",
    token,
    ca,
    body,
    headers: { "content-type": "application/json" },
  });
  if (!replace.ok) {
    throw statusError(replace.text || `failed to replace secret ${name}`, 502);
  }
}

async function withNodePortAllocation<T>(fn: () => Promise<T>) {
  const previous = allocationLock;
  let release: () => void = () => {};
  allocationLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function findTrainingTaskById(
  client: ReturnType<typeof createTrainingTaskClient>,
  id: string,
) {
  try {
    const response = await client.getTrainingTaskById(
      create(GetTrainingTaskByIdRequestSchema, { id }),
    );
    return response.trainingTask?.id?.id ? response.trainingTask : null;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return null;
    }
    if (
      error instanceof ConnectError &&
      error.code === Code.FailedPrecondition
    ) {
      throw statusError("task id is ambiguous", 409);
    }
    throw error;
  }
}

async function getTrainingTaskById(
  client: ReturnType<typeof createTrainingTaskClient>,
  id: string,
) {
  try {
    const response = await client.getTrainingTaskById(
      create(GetTrainingTaskByIdRequestSchema, { id }),
    );
    const task = response.trainingTask;
    if (!task?.id?.id) {
      throw statusError("training task not found", 404);
    }
    return task;
  } catch (error) {
    if (error instanceof ConnectError) {
      if (error.code === Code.NotFound) {
        throw statusError("training task not found", 404);
      }
      if (error.code === Code.FailedPrecondition) {
        throw statusError("task id is ambiguous", 409);
      }
    }
    throw error;
  }
}

async function findDevelopmentInstanceById(
  client: ReturnType<typeof createDevelopmentInstanceClient>,
  id: string,
) {
  try {
    return await getDevelopmentInstanceById(client, id);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "development instance not found"
    ) {
      return undefined;
    }
    throw error;
  }
}

async function getDevelopmentInstanceById(
  client: ReturnType<typeof createDevelopmentInstanceClient>,
  id: string,
) {
  try {
    const response = await client.getDevelopmentInstanceById(
      create(GetDevelopmentInstanceByIdRequestSchema, { id }),
    );
    const instance = response.developmentInstance;
    if (!instance?.id?.id) {
      throw statusError("development instance not found", 404);
    }
    return instance;
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      throw statusError("development instance not found", 404);
    }
    throw error;
  }
}

function requireDevelopmentInstanceIdentifier(instance: DevelopmentInstance) {
  if (!instance.id?.id) {
    throw statusError("development instance not found", 404);
  }
  return create(DevelopmentInstanceIdentifierSchema, instance.id);
}

function requireTrainingTaskIdentifier(task: TrainingTask) {
  if (!task.id?.id) {
    throw statusError("training task not found", 404);
  }
  return create(TrainingTaskIdentifierSchema, task.id);
}

function isAlreadyExists(error: unknown) {
  return error instanceof ConnectError && error.code === Code.AlreadyExists;
}

function isNotFound(error: unknown) {
  return error instanceof ConnectError && error.code === Code.NotFound;
}

function isLikelyNodePortConflict(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("provided port is already allocated");
}

function isActiveActionPhase(phase?: ActionPhase) {
  return (
    phase === ActionPhase.QUEUED ||
    phase === ActionPhase.WAITING_FOR_RESOURCES ||
    phase === ActionPhase.INITIALIZING ||
    phase === ActionPhase.RUNNING ||
    phase === ActionPhase.PAUSED
  );
}

export type FlyteRunIdentifier = {
  org: string;
  project: string;
  domain: string;
  name: string;
};

type KubernetesPVCList = {
  items: Array<{
    metadata?: {
      name?: string;
      namespace?: string;
    };
  }>;
};

type KubernetesPodList = {
  items: Array<{
    metadata?: {
      name?: string;
      namespace?: string;
    };
    status?: {
      phase?: string;
    };
    spec?: {
      containers?: Array<{
        name?: string;
      }>;
      volumes?: Array<{
        persistentVolumeClaim?: {
          claimName?: string;
        };
      }>;
    };
  }>;
};

function parseFlyteWorkflowId(id: string): FlyteRunIdentifier | null {
  const segments = id
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 4) {
    const [org, project, domain, name] = segments;
    return { org, project, domain, name };
  }
  if (segments.length === 3) {
    const [project, domain, name] = segments;
    const org =
      process.env.EXTERNAL_API_FLYTE_ORG?.trim() || DEFAULT_AIONE_INTERNAL_ORG;
    return { org, project, domain, name };
  }
  return null;
}

function formatFlyteRunId(runId: FlyteRunIdentifier) {
  return `${runId.org}/${runId.project}/${runId.domain}/${runId.name}`;
}

function getActionDurationSeconds(status?: ActionStatus) {
  const durationMs = status?.durationMs;
  if (durationMs !== undefined) {
    const durationMsNumber = Number(durationMs);
    if (Number.isFinite(durationMsNumber) && durationMsNumber > 0) {
      return Math.floor(durationMsNumber / 1000);
    }
  }

  const startTimeMs = timestampToMilliseconds(status?.startTime);
  if (startTimeMs === undefined) {
    return 0;
  }

  const endTimeMs = timestampToMilliseconds(status?.endTime) ?? Date.now();
  return Math.max(0, Math.floor((endTimeMs - startTimeMs) / 1000));
}

function timestampToMilliseconds(timestamp?: {
  seconds?: bigint | number;
  nanos?: number;
}) {
  if (timestamp?.seconds === undefined) {
    return undefined;
  }

  const seconds = Number(timestamp.seconds);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  const nanos = Number(timestamp.nanos ?? 0);
  return seconds * 1000 + Math.floor(nanos / 1_000_000);
}

function getActionError(
  result:
    | { case: "errorInfo"; value: { message?: string } }
    | { case: "abortInfo"; value: { reason?: string } }
    | { case: undefined; value?: undefined }
    | undefined,
) {
  if (result?.case === "errorInfo") {
    return result.value.message ?? "";
  }
  if (result?.case === "abortInfo") {
    return result.value.reason ?? "";
  }
  return "";
}

function getPayloadObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringField(object: Record<string, unknown>, field: string): string {
  const value = object[field];
  return typeof value === "string" ? value.trim() : "";
}

function requiredStringField(
  object: Record<string, unknown>,
  field: string,
  label = field,
): string {
  const value = stringField(object, field);
  if (!value) {
    throw statusError(`${label} is required`, 400);
  }
  return value;
}

function requiredAbsolutePathField(
  object: Record<string, unknown>,
  field: string,
  label = field,
) {
  const value = requiredStringField(object, field, label);
  if (!value.startsWith("/")) {
    throw statusError(`${label} must be an absolute path`, 400);
  }
  return value;
}

function positiveNumberField(value: unknown, fallback: number, field: string) {
  const resolved = value ?? fallback;
  const number = typeof resolved === "number" ? resolved : Number(resolved);
  if (!Number.isFinite(number) || number <= 0) {
    throw statusError(`${field} must be a positive number`, 400);
  }
  return Math.ceil(number);
}

function nonNegativeIntegerField(
  value: unknown,
  fallback: number,
  field: string,
) {
  const resolved = value ?? fallback;
  const number = typeof resolved === "number" ? resolved : Number(resolved);
  if (!Number.isInteger(number) || number < 0) {
    throw statusError(`${field} must be a non-negative integer`, 400);
  }
  return number;
}
