/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { getConsoleApiPath } from "@/components/pages/DevelopmentInstances/utils";
import { useOrg } from "@/hooks/useOrg";
import { ArrowLeftIcon, ArrowPathIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  formatBytes,
  formatNullablePercent,
  formatStatsSource,
} from "@/components/pages/CloudStorage/utils";

type DetailParams = {
  domain?: string;
  project?: string;
  storageId?: string;
};

type CloudStorageStats = {
  cloudStorage: {
    id: string;
    name: string;
    description: string;
    sizeGb: number;
    storageClassName: string;
    targetNamespace: string;
    pvcName: string;
    creator: string;
    status: number;
    createdAt: string;
    updatedAt: string;
    materializedAt: string;
    materializations: Array<{
      targetNamespace: string;
      pvcName: string;
      materializedAt: string;
    }>;
  };
  pvcs: Array<{
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
  }>;
  warnings: string[];
};

const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
        {title}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InfoGrid({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid gap-x-8 gap-y-5 md:grid-cols-4">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="border-r border-zinc-100 pr-4 last:border-r-0 dark:border-zinc-800"
        >
          <dt className="mb-1 text-xs text-zinc-500">{label}</dt>
          <dd className="break-words text-sm font-medium text-zinc-950 dark:text-zinc-100">
            {value || "-"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function statusText(status: number) {
  return status === 2 ? "已挂载" : "未挂载";
}

function decodeParam(value?: string) {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatIsoTimestamp(value?: string) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function CloudStorageDetailPage() {
  const params = useParams<DetailParams>();
  const org = useOrg();
  const [stats, setStats] = useState<CloudStorageStats>();
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const storageId = useMemo(
    () => decodeParam(params.storageId),
    [params.storageId],
  );
  const listHref = `/domain/${params.domain}/project/${params.project}/cloud-storages`;

  const loadStats = useCallback(async () => {
    if (!org || !params.project || !params.domain || !storageId) {
      return;
    }
    setIsLoading(true);
    setMessage("");
    try {
      const query = new URLSearchParams({
        org,
        project: params.project,
        domain: params.domain,
      });
      const response = await fetch(
        getConsoleApiPath(
          `/api/cloud-storages/${encodeURIComponent(storageId)}/stats?${query}`,
        ),
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.message || "failed to load cloud storage stats");
      }
      setStats(body.data);
    } catch (error) {
      console.error("Error loading cloud storage stats", error);
      setMessage("加载云存储详情失败");
    } finally {
      setIsLoading(false);
    }
  }, [org, params.domain, params.project, storageId]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const cloudStorage = stats?.cloudStorage;

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link
                  href={listHref}
                  className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  <ArrowLeftIcon className="size-4" />
                  云存储
                </Link>
                <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                  {cloudStorage?.name || storageId || "云存储详情"}
                </h1>
              </div>
              <button
                className={buttonClass}
                onClick={loadStats}
                disabled={isLoading}
                title="刷新"
                aria-label="刷新"
              >
                <ArrowPathIcon className="size-5" />
              </button>
            </div>

            {message && (
              <div className="mb-4 text-sm text-zinc-600">{message}</div>
            )}

            <div className="space-y-5">
              <InfoSection title="基本信息">
                <InfoGrid
                  items={[
                    ["名称", cloudStorage?.name],
                    ["存储ID", cloudStorage?.id],
                    ["描述", cloudStorage?.description || "-"],
                    [
                      "空间大小",
                      cloudStorage ? `${cloudStorage.sizeGb} GB` : "-",
                    ],
                    [
                      "状态",
                      cloudStorage ? statusText(cloudStorage.status) : "-",
                    ],
                    ["存储类", cloudStorage?.storageClassName || "-"],
                    ["命名空间", cloudStorage?.targetNamespace || "-"],
                    ["PVC", cloudStorage?.pvcName || "-"],
                    ["创建人", cloudStorage?.creator || "-"],
                    ["创建时间", formatIsoTimestamp(cloudStorage?.createdAt)],
                    ["更新时间", formatIsoTimestamp(cloudStorage?.updatedAt)],
                    [
                      "挂载时间",
                      formatIsoTimestamp(cloudStorage?.materializedAt),
                    ],
                  ]}
                />
              </InfoSection>

              {stats?.warnings?.length ? (
                <div className="border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {stats.warnings.join("；")}
                </div>
              ) : null}

              <InfoSection title={`PVC 统计 (${stats?.pvcs.length ?? 0})`}>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-y border-zinc-100 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      <tr>
                        <th className="px-3 py-3">PVC 名称</th>
                        <th className="px-3 py-3">命名空间</th>
                        <th className="px-3 py-3">状态</th>
                        <th className="px-3 py-3">请求容量</th>
                        <th className="px-3 py-3">实际容量</th>
                        <th className="px-3 py-3">已用</th>
                        <th className="px-3 py-3">可用</th>
                        <th className="px-3 py-3">使用率</th>
                        <th className="px-3 py-3">数据来源</th>
                        <th className="px-3 py-3">挂载 Pod</th>
                        <th className="px-3 py-3">节点</th>
                        <th className="px-3 py-3">最后观测时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {(stats?.pvcs ?? []).map((pvc) => (
                        <tr
                          key={`${pvc.namespace}/${pvc.name}`}
                          className="text-zinc-900 dark:text-zinc-100"
                        >
                          <td className="px-3 py-3 font-mono text-xs">
                            {pvc.name || "-"}
                          </td>
                          <td className="px-3 py-3">{pvc.namespace || "-"}</td>
                          <td className="px-3 py-3">{pvc.phase || "-"}</td>
                          <td className="px-3 py-3">
                            {formatBytes(pvc.requestedBytes)}
                          </td>
                          <td className="px-3 py-3">
                            {formatBytes(pvc.capacityBytes)}
                          </td>
                          <td className="px-3 py-3">
                            {formatBytes(pvc.usedBytes)}
                          </td>
                          <td className="px-3 py-3">
                            {formatBytes(pvc.availableBytes)}
                            {pvc.statsSource === "hawk_history" ? (
                              <div className="text-xs text-zinc-500">
                                总量−已用推算
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3">
                            {formatNullablePercent(pvc.usagePercent)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {formatStatsSource(pvc.statsSource)}
                          </td>
                          <td className="px-3 py-3">
                            {pvc.mountedBy.length
                              ? pvc.mountedBy.join(", ")
                              : "-"}
                          </td>
                          <td className="px-3 py-3">{pvc.nodeName || "-"}</td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {formatIsoTimestamp(pvc.statsTime)}
                          </td>
                        </tr>
                      ))}
                      {!stats?.pvcs.length && (
                        <tr>
                          <td
                            colSpan={12}
                            className="px-3 py-8 text-center text-zinc-500"
                          >
                            没有要显示的数据。
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </InfoSection>
            </div>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}

export default CloudStorageDetailPage;
