/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import type { CloudStorage } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";

import { ModelAppField, modelAppInputClassName } from "./ModelAppFormFields";
import type { ModelAppFormValues } from "./modelAppUtils";

type Props = {
  cloudStorages: CloudStorage[];
  error: string;
  isLoading: boolean;
  mounts: ModelAppFormValues["cloudStorageMounts"];
  onSelectedChange: (storageId: string, selected: boolean) => void;
  onMountPathChange: (storageId: string, mountPath: string) => void;
};

export function ModelAppCloudStorageList({
  cloudStorages,
  error,
  isLoading,
  mounts,
  onSelectedChange,
  onMountPathChange,
}: Props) {
  const byId = new Map(
    cloudStorages.flatMap((storage) =>
      storage.id?.id ? [[storage.id.id, storage] as const] : [],
    ),
  );
  const storageIds = [
    ...byId.keys(),
    ...mounts
      .map((mount) => mount.cloudStorageId)
      .filter((id) => !byId.has(id)),
  ];

  if (error) {
    return <div className="text-sm text-red-500">{error}</div>;
  }
  if (isLoading) {
    return <div className="text-sm dark:text-(--system-gray-6)">加载中</div>;
  }
  if (storageIds.length === 0) {
    return (
      <div className="text-sm dark:text-(--system-gray-6)">暂无可用云存储</div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {storageIds.map((storageId) => {
        const storage = byId.get(storageId);
        const selectedMount = mounts.find(
          (mount) => mount.cloudStorageId === storageId,
        );
        return (
          <div
            key={storageId}
            className="grid gap-3 border border-(--system-gray-4) p-3 md:grid-cols-[1fr_320px]"
          >
            <label className="flex min-w-0 items-start gap-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={Boolean(selectedMount)}
                onChange={(event) =>
                  onSelectedChange(storageId, event.target.checked)
                }
              />
              <span className="min-w-0">
                <span className="block font-medium">
                  {storage?.name || storageId}
                </span>
                <span className="mt-1 grid gap-x-4 gap-y-1 text-xs dark:text-(--system-gray-6) sm:grid-cols-3">
                  <span>{storageId}</span>
                  {storage && <span>{storage.sizeGb} GB</span>}
                  {storage && <span>{storage.storageClassName || "默认"}</span>}
                </span>
              </span>
            </label>
            <ModelAppField label="挂载路径">
              <input
                className={modelAppInputClassName}
                disabled={!selectedMount}
                placeholder="/mnt/storage"
                value={selectedMount?.mountPath ?? ""}
                onChange={(event) =>
                  onMountPathChange(storageId, event.target.value)
                }
              />
            </ModelAppField>
          </div>
        );
      })}
    </div>
  );
}
