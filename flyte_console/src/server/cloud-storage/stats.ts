/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import type { CloudStorage } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import {
  loadHawkPvcHistory,
  type HawkPvcHistory,
} from "@/server/cloud-storage/hawk-history";
import { buildCloudStoragePVCName } from "@/server/cloud-storage/naming";
import { statusError } from "@/server/http/response";
import { requestKubernetes } from "@/server/kubernetes/client";

export type PvcStats = {
  name: string;
  namespace: string;
  phase: string;
  storageClassName: string;
  requestedBytes: number | null;
  capacityBytes: number | null;
  filesystemCapacityBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usagePercent: number | null;
  mountedBy: string[];
  nodeName: string;
  statsSource: "kubelet" | "hawk_history" | "unavailable";
  statsTime: string | null;
};

type LoadCloudStoragePvcStatsDependencies = {
  loadHawkHistory?: (input: {
    volumeName: string;
  }) => Promise<HawkPvcHistory | null>;
};

export async function loadCloudStoragePvcStats(
  {
    apiOrigin,
    namespace,
    token,
    ca,
    storageId,
    cloudStorage,
  }: {
    apiOrigin: string;
    namespace: string;
    token: string;
    ca: string;
    storageId: string;
    cloudStorage: CloudStorage;
  },
  dependencies: LoadCloudStoragePvcStatsDependencies = {},
) {
  const loadHawkHistory =
    dependencies.loadHawkHistory ?? loadHawkPvcHistory;
  const warnings: string[] = [];
  const pvcMap = new Map<string, KubernetesPVC>();
  const canonicalName = buildCloudStoragePVCName(storageId);
  const canonicalPvc = await getPvcIfPresent({
    apiOrigin,
    namespace,
    token,
    ca,
    pvcName: canonicalName,
  });
  if (canonicalPvc) {
    pvcMap.set(pvcKey(namespace, canonicalName), canonicalPvc);
  } else {
    const recordedMaterialization = cloudStorage.materializations.find(
      (item) => !item.targetNamespace || item.targetNamespace === namespace,
    );
    const recordedName =
      recordedMaterialization?.pvcName?.trim() || cloudStorage.pvcName?.trim();
    const recordedNamespace =
      recordedMaterialization?.targetNamespace?.trim() ||
      cloudStorage.targetNamespace?.trim() ||
      namespace;
    if (recordedName && recordedName !== canonicalName) {
      const recordedPvc = await getPvcIfPresent({
        apiOrigin,
        namespace: recordedNamespace,
        token,
        ca,
        pvcName: recordedName,
      });
      if (recordedPvc) {
        warnings.push(
          `Canonical PVC ${canonicalName} was not found; using recorded legacy PVC ${recordedName}`,
        );
        pvcMap.set(
          pvcKey(recordedNamespace, recordedName),
          recordedPvc,
        );
      }
    }
  }

  const pvcNamespaces = Array.from(
    new Set(
      Array.from(pvcMap.values()).map(
        (pvc) => pvc.metadata?.namespace?.trim() || namespace,
      ),
    ),
  );
  const pods = (
    await Promise.all(
      pvcNamespaces.map((pvcNamespace) =>
        listPods({
          apiOrigin,
          namespace: pvcNamespace,
          token,
          ca,
        }),
      ),
    )
  ).flat();
  const mounts = buildPvcMountMap(pods);
  const nodeStats = new Map<string, KubeletSummary | null>();
  for (const mounted of mounts.values()) {
    for (const nodeName of mounted.nodeNames) {
      if (!nodeStats.has(nodeName)) {
        nodeStats.set(
          nodeName,
          await getNodeStats({ apiOrigin, token, ca, nodeName, warnings }),
        );
      }
    }
  }

  const pvcs = await mapWithConcurrency(
    Array.from(pvcMap.values()),
    3,
    (pvc) =>
      buildPvcStatsRow({
        pvc,
        mounted: mounts.get(
          pvcKey(
            pvc.metadata?.namespace ?? namespace,
            pvc.metadata?.name ?? "",
          ),
        ),
        nodeStats,
        warnings,
        loadHawkHistory,
      }),
  );

  return { pvcs, warnings };
}

export function normalizeCloudStorage(cloudStorage: CloudStorage) {
  return {
    id: cloudStorage.id?.id ?? "",
    org: cloudStorage.id?.org ?? "",
    project: cloudStorage.id?.project ?? "",
    domain: cloudStorage.id?.domain ?? "",
    name: cloudStorage.name,
    description: cloudStorage.description,
    sizeGb: cloudStorage.sizeGb,
    storageClassName: cloudStorage.storageClassName,
    targetNamespace: cloudStorage.targetNamespace,
    pvcName: cloudStorage.pvcName,
    creator: cloudStorage.creator,
    status: cloudStorage.status,
    createdAt: timestampToIso(cloudStorage.createdAt),
    updatedAt: timestampToIso(cloudStorage.updatedAt),
    materializedAt: timestampToIso(cloudStorage.materializedAt),
    materializations: cloudStorage.materializations.map((materialization) => ({
      targetNamespace: materialization.targetNamespace,
      pvcName: materialization.pvcName,
      materializedAt: timestampToIso(materialization.materializedAt),
    })),
  };
}

async function getPvcIfPresent({
  apiOrigin,
  namespace,
  token,
  ca,
  pvcName,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  pvcName: string;
}) {
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims/${encodeURIComponent(pvcName)}`,
    token,
    ca,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw statusError(response.text || `failed to load PVC ${pvcName}`, 502);
  }
  return response.json<KubernetesPVC>();
}

async function listPods({
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
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?fieldSelector=${encodeURIComponent("status.phase=Running")}`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(response.text || "failed to list pods", 502);
  }
  return response.json<KubernetesPodList>().items ?? [];
}

function buildPvcMountMap(pods: KubernetesPod[]) {
  const mounts = new Map<
    string,
    { podNames: string[]; nodeNames: Set<string> }
  >();
  for (const pod of pods) {
    if (pod.status?.phase !== "Running") {
      continue;
    }
    const podName = pod.metadata?.name ?? "";
    const namespace = pod.metadata?.namespace ?? "";
    const nodeName = pod.spec?.nodeName ?? "";
    for (const volume of pod.spec?.volumes ?? []) {
      const claimName = volume.persistentVolumeClaim?.claimName;
      if (!claimName) {
        continue;
      }
      const key = pvcKey(namespace, claimName);
      const current = mounts.get(key) ?? {
        podNames: [],
        nodeNames: new Set<string>(),
      };
      if (podName) {
        current.podNames.push(podName);
      }
      if (nodeName) {
        current.nodeNames.add(nodeName);
      }
      mounts.set(key, current);
    }
  }
  return mounts;
}

async function getNodeStats({
  apiOrigin,
  token,
  ca,
  nodeName,
  warnings,
}: {
  apiOrigin: string;
  token: string;
  ca: string;
  nodeName: string;
  warnings: string[];
}) {
  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/nodes/${encodeURIComponent(nodeName)}/proxy/stats/summary`,
    token,
    ca,
  });
  if (!response.ok) {
    warnings.push(`Failed to load kubelet stats for node ${nodeName}`);
    return null;
  }
  return response.json<KubeletSummary>();
}

async function buildPvcStatsRow({
  pvc,
  mounted,
  nodeStats,
  warnings,
  loadHawkHistory,
}: {
  pvc: KubernetesPVC;
  mounted?: { podNames: string[]; nodeNames: Set<string> };
  nodeStats: Map<string, KubeletSummary | null>;
  warnings: string[];
  loadHawkHistory: NonNullable<
    LoadCloudStoragePvcStatsDependencies["loadHawkHistory"]
  >;
}): Promise<PvcStats> {
  const name = pvc.metadata?.name ?? "";
  const namespace = pvc.metadata?.namespace ?? "";
  const nodeName = Array.from(mounted?.nodeNames ?? [])[0] ?? "";
  const usage = findPvcUsage({
    pvcName: name,
    namespace,
    podNames: mounted?.podNames ?? [],
    nodeStats,
  });
  const requestedBytes = parseKubernetesQuantity(
    pvc.spec?.resources?.requests?.storage,
  );
  const capacityBytes =
    parseKubernetesQuantity(pvc.status?.capacity?.storage) ??
    requestedBytes;
  const base = {
    name,
    namespace,
    phase: pvc.status?.phase ?? "",
    storageClassName: pvc.spec?.storageClassName ?? "",
    requestedBytes,
    capacityBytes,
    mountedBy: mounted?.podNames ?? [],
    nodeName,
  };

  const kubeletSample = toCompleteKubeletSample(usage);
  if (kubeletSample) {
    return {
      ...base,
      ...kubeletSample,
      statsSource: "kubelet",
    };
  }

  const volumeName = pvc.spec?.volumeName?.trim() ?? "";
  if (volumeName) {
    try {
      const history = await loadHawkHistory({ volumeName });
      if (history) {
        return {
          ...base,
          ...history,
          statsSource: "hawk_history",
        };
      }
      warnings.push(
        `PVC ${namespace}/${name} has no complete Hawk history sample`,
      );
    } catch {
      warnings.push(`Failed to load Hawk history for PVC ${namespace}/${name}`);
    }
  } else {
    warnings.push(
      `PVC ${namespace}/${name} has no PV name; usage is unavailable`,
    );
  }

  return {
    ...base,
    filesystemCapacityBytes: null,
    usedBytes: null,
    availableBytes: null,
    usagePercent: null,
    statsSource: "unavailable",
    statsTime: null,
  };
}

function toCompleteKubeletSample(usage: KubeletVolumeStats | undefined) {
  const filesystemCapacityBytes = toNonNegativeNumber(usage?.capacityBytes);
  const usedBytes = toNonNegativeNumber(usage?.usedBytes);
  const availableBytes = toNonNegativeNumber(usage?.availableBytes);
  if (
    filesystemCapacityBytes === null ||
    filesystemCapacityBytes <= 0 ||
    usedBytes === null ||
    availableBytes === null
  ) {
    return null;
  }
  return {
    filesystemCapacityBytes,
    usedBytes,
    availableBytes,
    usagePercent: roundPercent(
      (usedBytes / filesystemCapacityBytes) * 100,
    ),
    statsTime: usage?.time ?? null,
  };
}

function findPvcUsage({
  pvcName,
  namespace,
  podNames,
  nodeStats,
}: {
  pvcName: string;
  namespace: string;
  podNames: string[];
  nodeStats: Map<string, KubeletSummary | null>;
}) {
  const podSet = new Set(podNames);
  for (const summary of nodeStats.values()) {
    for (const pod of summary?.pods ?? []) {
      if (
        pod.podRef?.namespace &&
        pod.podRef.namespace !== namespace
      ) {
        continue;
      }
      if (podSet.size > 0 && !podSet.has(pod.podRef?.name ?? "")) {
        continue;
      }
      for (const volume of pod.volume ?? []) {
        if (
          volume.pvcRef?.name === pvcName &&
          (!volume.pvcRef.namespace || volume.pvcRef.namespace === namespace)
        ) {
          return volume;
        }
      }
    }
  }
  return undefined;
}

function parseKubernetesQuantity(value: string | undefined) {
  if (!value) {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)([a-zA-Z]*)$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const unit = match[2];
  const multipliers: Record<string, number> = {
    "": 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  return Math.round(amount * (multipliers[unit] ?? 1));
}

function toNullableNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNonNegativeNumber(value: number | undefined) {
  const result = toNullableNumber(value);
  return result !== null && result >= 0 ? result : null;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function timestampToIso(timestamp?: { seconds?: bigint | number }) {
  if (!timestamp?.seconds) {
    return "";
  }
  return new Date(Number(timestamp.seconds) * 1000).toISOString();
}

type KubernetesPVC = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    volumeName?: string;
    storageClassName?: string;
    resources?: {
      requests?: {
        storage?: string;
      };
    };
  };
  status?: {
    phase?: string;
    capacity?: {
      storage?: string;
    };
  };
};

function pvcKey(namespace: string, name: string) {
  return `${namespace}/${name}`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
}

type KubernetesPodList = {
  items?: KubernetesPod[];
};

type KubernetesPod = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    nodeName?: string;
    volumes?: Array<{
      persistentVolumeClaim?: {
        claimName?: string;
      };
    }>;
  };
  status?: {
    phase?: string;
  };
};

type KubeletSummary = {
  pods?: Array<{
    podRef?: {
      name?: string;
      namespace?: string;
    };
    volume?: KubeletVolumeStats[];
  }>;
};

type KubeletVolumeStats = {
  time?: string;
  usedBytes?: number;
  capacityBytes?: number;
  availableBytes?: number;
  inodesUsed?: number;
  inodes?: number;
  inodesFree?: number;
  pvcRef?: {
    name?: string;
    namespace?: string;
  };
};
