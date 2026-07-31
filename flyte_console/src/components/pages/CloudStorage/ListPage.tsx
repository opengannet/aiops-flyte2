/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import {
  CloudStorage,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import {
  CloudStorageService,
  DeleteCloudStorageRequestSchema,
  ListCloudStoragesRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import {
  ArrowPathIcon,
  CircleStackIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatTimestamp } from "../TrainingTasks/utils";
import { buildCloudStorageDetailHref } from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function usageStatusText(podNames: string[] | undefined) {
  if (!podNames) {
    return "未知";
  }
  return podNames.length > 0 ? "使用中" : "未使用";
}

function idKey(storage: CloudStorage) {
  return storage.id?.id ?? "";
}

export function CloudStorageListPage() {
  const params = useParams<ProjectDomainParams>();
  const org = useOrg();
  const client = useConnectRpcClient(CloudStorageService);
  const [items, setItems] = useState<CloudStorage[]>([]);
  const [mounts, setMounts] = useState<Record<string, string[]> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOperating, setIsOperating] = useState(false);
  const [message, setMessage] = useState("");

  const projectId = useMemo(
    () =>
      params.domain && params.project && org
        ? create(ProjectIdentifierSchema, {
            organization: org,
            domain: params.domain,
            name: params.project,
          })
        : undefined,
    [params.domain, params.project, org],
  );

  const listHref = `/domain/${params.domain}/project/${params.project}/cloud-storages`;
  const createHref = `${listHref}/create`;

  const loadItems = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setIsLoading(true);
    setMessage("");
    try {
      const response = await client.listCloudStorages(
        create(ListCloudStoragesRequestSchema, { project: projectId }),
      );
      const cloudStorages = response.cloudStorages ?? [];
      setItems(cloudStorages);
      setMounts(null);
      try {
        const mountsResponse = await fetch("/api/cloud-storages/mounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storageIds: cloudStorages.map(idKey) }),
        });
        if (!mountsResponse.ok) {
          throw new Error("failed to load live mounts");
        }
        const body = (await mountsResponse.json()) as {
          data?: { mounts?: Record<string, string[]> };
        };
        setMounts(body.data?.mounts ?? {});
      } catch (error) {
        console.error("Error loading cloud storage live mounts", error);
        setMessage("加载云存储挂载状态失败");
      }
    } catch (error) {
      console.error("Error loading cloud storages", error);
      setMessage("加载云存储失败");
    } finally {
      setIsLoading(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const filteredItems = useMemo(
    () =>
      items.filter((item) =>
        searchTerm
          ? `${item.name} ${item.description}`
              .toLowerCase()
              .includes(searchTerm.toLowerCase())
          : true,
      ),
    [items, searchTerm],
  );

  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selected.has(idKey(item))),
    [filteredItems, selected],
  );

  const allSelected =
    filteredItems.length > 0 &&
    filteredItems.every((item) => selected.has(idKey(item)));

  const deleteSelected = useCallback(async () => {
    if (selectedItems.length === 0) {
      return;
    }
    setIsOperating(true);
    setMessage("");
    try {
      await Promise.all(
        selectedItems.map((item) =>
          client.deleteCloudStorage(
            create(DeleteCloudStorageRequestSchema, { id: item.id }),
          ),
        ),
      );
      setSelected(new Set());
      setMessage("已删除云存储");
      await loadItems();
    } catch (error) {
      console.error("Error deleting cloud storages", error);
      setMessage("删除云存储失败");
    } finally {
      setIsOperating(false);
    }
  }, [client, loadItems, selectedItems]);

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                云存储 ({filteredItems.length})
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={buttonClass}
                  onClick={loadItems}
                  disabled={isLoading || isOperating}
                  title="刷新"
                  aria-label="刷新"
                >
                  <ArrowPathIcon className="size-5" />
                </button>
                <button
                  className={buttonClass}
                  onClick={deleteSelected}
                  disabled={selectedItems.length === 0 || isOperating}
                >
                  <TrashIcon className="size-4" />
                  删除
                </button>
                <Link
                  href={createHref}
                  className="inline-flex h-9 items-center justify-center gap-2 bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  <PlusIcon className="size-5" />
                  创建
                </Link>
              </div>
            </div>
            <div className="mt-5 flex max-w-3xl items-center border border-zinc-400 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900">
              <MagnifyingGlassIcon className="size-5 text-zinc-500" />
              <input
                className="h-11 flex-1 bg-transparent px-3 text-sm outline-none"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="按关键词搜索"
              />
            </div>
            {message && (
              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                {message}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-left dark:divide-zinc-800">
              <thead className="sticky top-0 bg-white dark:bg-zinc-950">
                <tr className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                  <th className="w-14 px-8 py-4">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(filteredItems.map((item) => idKey(item)))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="px-4 py-4">名称</th>
                  <th className="px-4 py-4">存储ID</th>
                  <th className="px-4 py-4">描述</th>
                  <th className="px-4 py-4">空间大小</th>
                  <th className="px-4 py-4">状态</th>
                  <th className="px-4 py-4">使用 Pod</th>
                  <th className="px-4 py-4">创建人</th>
                  <th className="px-4 py-4">创建时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredItems.map((item) => (
                  <tr
                    key={idKey(item)}
                    className="text-sm text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <td className="px-8 py-4">
                      <input
                        type="checkbox"
                        checked={selected.has(idKey(item))}
                        onChange={(event) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) {
                              next.add(idKey(item));
                            } else {
                              next.delete(idKey(item));
                            }
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-4 font-medium">
                      <Link
                        href={buildCloudStorageDetailHref(
                          params.domain,
                          params.project,
                          idKey(item),
                        )}
                        className="text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        {item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs whitespace-nowrap text-zinc-700 dark:text-zinc-300">
                      {idKey(item) || "-"}
                    </td>
                    <td className="max-w-72 px-4 py-4 text-zinc-700 dark:text-zinc-300">
                      {item.description || "-"}
                    </td>
                    <td className="px-4 py-4">{item.sizeGb} GB</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-2">
                        <CircleStackIcon className="size-4 text-zinc-500" />
                        {usageStatusText(mounts?.[idKey(item)])}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {mounts?.[idKey(item)]?.join(", ") || "-"}
                    </td>
                    <td className="px-4 py-4">{item.creator || "-"}</td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {formatTimestamp(item.createdAt)}
                    </td>
                  </tr>
                ))}
                {filteredItems.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-8 py-12 text-center text-sm text-zinc-500"
                    >
                      暂无云存储
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}
