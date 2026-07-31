/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { buildCloudStoragePVCName } from "@/server/cloud-storage/naming";
import { statusError } from "@/server/http/response";
import { requestKubernetes } from "@/server/kubernetes/client";

export async function loadCloudStorageLiveMounts({
  apiOrigin,
  namespace,
  token,
  ca,
  storageIds,
}: {
  apiOrigin: string;
  namespace: string;
  token: string;
  ca: string;
  storageIds: string[];
}) {
  const mounts: Record<string, string[]> = Object.fromEntries(
    storageIds.map((storageId) => [storageId, []]),
  );
  const storageIdByPvc = new Map<string, string>();
  for (const storageId of storageIds) {
    try {
      storageIdByPvc.set(buildCloudStoragePVCName(storageId), storageId);
    } catch {
      // Existing non-canonical records cannot have a canonical PVC.
    }
  }

  const response = await requestKubernetes({
    url: `${apiOrigin}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?fieldSelector=${encodeURIComponent("status.phase=Running")}`,
    token,
    ca,
  });
  if (!response.ok) {
    throw statusError(response.text || "failed to list running Pods", 502);
  }

  const podNamesByStorageId = new Map<string, Set<string>>();
  for (const pod of response.json<KubernetesPodList>().items ?? []) {
    if (pod.status?.phase !== "Running") {
      continue;
    }
    const podName = pod.metadata?.name?.trim();
    if (!podName) {
      continue;
    }
    for (const volume of pod.spec?.volumes ?? []) {
      const claimName = volume.persistentVolumeClaim?.claimName?.trim();
      const storageId = claimName ? storageIdByPvc.get(claimName) : undefined;
      if (storageId) {
        const names = podNamesByStorageId.get(storageId) ?? new Set<string>();
        names.add(podName);
        podNamesByStorageId.set(storageId, names);
      }
    }
  }
  for (const [storageId, names] of podNamesByStorageId) {
    mounts[storageId] = Array.from(names).sort();
  }
  return mounts;
}

type KubernetesPodList = {
  items?: Array<{
    metadata?: { name?: string };
    status?: { phase?: string };
    spec?: {
      volumes?: Array<{
        persistentVolumeClaim?: { claimName?: string };
      }>;
    };
  }>;
};
