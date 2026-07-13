/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import {
  DevelopmentInstance,
  DevelopmentInstanceIdentifierSchema,
  DevelopmentInstanceRun,
  DevelopmentInstanceStatus,
} from "@/gen/flyteidl2/developmentinstance/development_instance_definition_pb";
import {
  DevelopmentInstanceService,
  GetDevelopmentInstanceRequestSchema,
  ListDevelopmentInstanceRunsRequestSchema,
} from "@/gen/flyteidl2/developmentinstance/development_instance_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { create } from "@bufbuild/protobuf";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type DetailParams = {
  domain?: string;
  project?: string;
  id?: string;
};

function statusText(status: DevelopmentInstanceStatus) {
  switch (status) {
    case DevelopmentInstanceStatus.STARTING:
      return "启动中";
    case DevelopmentInstanceStatus.RUNNING:
      return "运行中";
    case DevelopmentInstanceStatus.STOPPING:
      return "停止中";
    case DevelopmentInstanceStatus.STOPPED:
      return "已停止";
    case DevelopmentInstanceStatus.SUCCEEDED:
      return "已完成";
    case DevelopmentInstanceStatus.FAILED:
      return "异常";
    case DevelopmentInstanceStatus.TIMED_OUT:
      return "已超时";
    default:
      return "未启动";
  }
}

function formatTimestamp(timestamp?: { seconds?: bigint | number }) {
  if (!timestamp?.seconds) {
    return "-";
  }
  return new Date(Number(timestamp.seconds) * 1000).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function durationText(run: DevelopmentInstanceRun) {
  const start = run.startedAt?.seconds ? Number(run.startedAt.seconds) : 0;
  const end = run.endedAt?.seconds ? Number(run.endedAt.seconds) : 0;
  if (!start || !end || end < start) {
    return "-";
  }
  const seconds = end - start;
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function Field({ label, value }: { label: string; value?: string | number }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 break-all text-sm text-zinc-950 dark:text-white">
        {value || "-"}
      </div>
    </div>
  );
}

export function DevelopmentInstanceDetailPage() {
  const params = useParams<DetailParams>();
  const client = useConnectRpcClient(DevelopmentInstanceService);
  const [instance, setInstance] = useState<DevelopmentInstance>();
  const [runs, setRuns] = useState<DevelopmentInstanceRun[]>([]);
  const [message, setMessage] = useState("");

  const decodedId = useMemo(
    () => decodeURIComponent(params.id ?? ""),
    [params.id],
  );
  const listHref = `/domain/${params.domain}/project/${params.project}/development-instances`;

  const loadDetails = useCallback(async () => {
    if (!decodedId) {
      return;
    }
    setMessage("");
    try {
      const id = create(DevelopmentInstanceIdentifierSchema, { id: decodedId });
      const [instanceResponse, runsResponse] = await Promise.all([
        client.getDevelopmentInstance(
          create(GetDevelopmentInstanceRequestSchema, { id }),
        ),
        client.listDevelopmentInstanceRuns(
          create(ListDevelopmentInstanceRunsRequestSchema, { id }),
        ),
      ]);
      setInstance(instanceResponse.developmentInstance);
      setRuns(runsResponse.runs ?? []);
    } catch (error) {
      console.error("Error loading development instance", error);
      setMessage("加载开发实例详情失败");
    }
  }, [client, decodedId]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <div className="mb-5 flex items-center gap-3">
              <Link
                href={listHref}
                className="inline-flex size-9 items-center justify-center border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              >
                <ArrowLeftIcon className="size-5" />
              </Link>
              <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">
                {instance?.name || decodedId}
              </h1>
            </div>

            {message && (
              <div className="mb-4 text-sm text-red-600">{message}</div>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              <section className="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-4 text-sm font-semibold">实例信息</h2>
                <div className="grid gap-4">
                  <Field label="实例 ID" value={instance?.id?.id} />
                  <Field label="状态" value={statusText(instance?.status ?? 0)} />
                  <Field label="最新运行 ID" value={instance?.latestRunName} />
                  <Field label="所有者" value={instance?.owner} />
                  <Field label="创建时间" value={formatTimestamp(instance?.createdAt)} />
                </div>
              </section>

              <section className="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-4 text-sm font-semibold">资源与镜像</h2>
                <div className="grid gap-4">
                  <Field
                    label="资源规格"
                    value={instance?.resourceSpec?.displayLabel}
                  />
                  <Field label="镜像" value={instance?.imageUri} />
                </div>
              </section>

              <section className="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-4 text-sm font-semibold">访问</h2>
                <div className="grid gap-4">
                  <Field
                    label="SSH"
                    value={
                      instance?.access?.nodePort
                        ? `ssh -p ${instance.access.nodePort} ${instance.access.sshUser || "flytekit"}@172.19.66.218`
                        : ""
                    }
                  />
                  <Field
                    label="Code Server"
                    value={instance?.access?.codeServerWorkspaceUrl}
                  />
                </div>
              </section>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <section className="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-4 text-sm font-semibold">云存储挂载</h2>
                <div className="space-y-3">
                  {(instance?.cloudStorageMounts ?? []).map((mount) => (
                    <div key={`${mount.cloudStorageId}:${mount.mountPath}`}>
                      <Field
                        label={mount.cloudStorageId}
                        value={mount.mountPath}
                      />
                    </div>
                  ))}
                  {(instance?.cloudStorageMounts ?? []).length === 0 && (
                    <div className="text-sm text-zinc-500">-</div>
                  )}
                </div>
              </section>

              <section className="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
                <h2 className="mb-4 text-sm font-semibold">代码库挂载</h2>
                <div className="space-y-3">
                  {(instance?.codeRepositoryDetails ?? []).map((repo) => (
                    <div key={`${repo.id}:${repo.mountPath}`}>
                      <Field label={repo.repoUrl || repo.id} value={repo.mountPath} />
                    </div>
                  ))}
                  {(instance?.codeRepositoryDetails ?? []).length === 0 && (
                    <div className="text-sm text-zinc-500">-</div>
                  )}
                </div>
              </section>
            </div>

            <section className="mt-5 border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">
                运行历史
              </div>
              <div className="overflow-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-zinc-600 dark:text-zinc-300">
                    <tr>
                      <th className="px-5 py-3">Run Name</th>
                      <th className="px-5 py-3">状态</th>
                      <th className="px-5 py-3">启动时间</th>
                      <th className="px-5 py-3">结束时间</th>
                      <th className="px-5 py-3">耗时</th>
                      <th className="px-5 py-3">NodePort</th>
                      <th className="px-5 py-3">Run Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {runs.map((run) => (
                      <tr key={run.runName}>
                        <td className="px-5 py-3 font-mono text-xs">
                          {run.runName}
                        </td>
                        <td className="px-5 py-3">{statusText(run.status)}</td>
                        <td className="px-5 py-3">
                          {formatTimestamp(run.startedAt)}
                        </td>
                        <td className="px-5 py-3">
                          {formatTimestamp(run.endedAt)}
                        </td>
                        <td className="px-5 py-3">{durationText(run)}</td>
                        <td className="px-5 py-3">{run.nodePort || "-"}</td>
                        <td className="px-5 py-3 text-blue-600">
                          <Link
                            href={`/domain/${params.domain}/project/${params.project}/runs/${run.runName}`}
                          >
                            打开
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {runs.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-5 py-10 text-center text-zinc-500"
                        >
                          暂无运行历史
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}

export default DevelopmentInstanceDetailPage;
