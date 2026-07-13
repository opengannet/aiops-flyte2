/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import {
  DevelopmentInstance,
  DevelopmentInstanceIdentifierSchema,
  DevelopmentInstanceStatus,
} from "@/gen/flyteidl2/developmentinstance/development_instance_definition_pb";
import {
  DeleteDevelopmentInstanceRequestSchema,
  DevelopmentInstanceService,
  ListDevelopmentInstancesRequestSchema,
  StartDevelopmentInstanceRequestSchema,
  StopDevelopmentInstanceRequestSchema,
} from "@/gen/flyteidl2/developmentinstance/development_instance_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import {
  ArrowPathIcon,
  PlayIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getConsoleApiPath, getNextNodePort } from "./utils";

type ProjectDomainParams = {
  domain?: string;
  project?: string;
};

const buttonClass =
  "inline-flex h-9 min-w-20 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";

function instanceId(instance: DevelopmentInstance) {
  return instance.id?.id ?? "";
}

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

function isTerminalStatus(status: DevelopmentInstanceStatus) {
  return (
    status === DevelopmentInstanceStatus.STOPPED ||
    status === DevelopmentInstanceStatus.SUCCEEDED ||
    status === DevelopmentInstanceStatus.FAILED ||
    status === DevelopmentInstanceStatus.TIMED_OUT ||
    status === DevelopmentInstanceStatus.NOT_STARTED
  );
}

function StatusPill({ status }: { status: DevelopmentInstanceStatus }) {
  const isError = status === DevelopmentInstanceStatus.FAILED;
  const isRunning =
    status === DevelopmentInstanceStatus.RUNNING ||
    status === DevelopmentInstanceStatus.STARTING ||
    status === DevelopmentInstanceStatus.STOPPING;
  const isSuccess = status === DevelopmentInstanceStatus.SUCCEEDED;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        isError
          ? "text-red-600"
          : isRunning
            ? "text-blue-600"
            : isSuccess
              ? "text-green-700"
              : "text-zinc-600 dark:text-zinc-300",
      )}
    >
      <span
        className={clsx(
          "size-3 rounded-full border-2",
          isError
            ? "border-red-600"
            : isRunning
              ? "border-blue-600 bg-blue-600"
              : isSuccess
                ? "border-green-700"
                : "border-zinc-500",
        )}
      />
      {statusText(status)}
    </span>
  );
}

function formatTimestamp(timestamp?: { seconds?: bigint | number }) {
  if (!timestamp?.seconds) {
    return "-";
  }
  return new Date(Number(timestamp.seconds) * 1000).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function sshCommand(instance: DevelopmentInstance) {
  const port = instance.access?.nodePort;
  if (!port) {
    return "-";
  }
  return `ssh -p ${port} ${instance.access?.sshUser || "flytekit"}@172.19.66.218`;
}

async function loadUsedNodePorts() {
  const response = await fetch(
    getConsoleApiPath("/api/development-instances/nodeports?namespace=flyte"),
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const envelope = (await response.json()) as {
    data?: { nodePorts?: number[] };
  };
  return envelope.data?.nodePorts ?? [];
}

export function DevelopmentInstancesListPage() {
  const params = useParams<ProjectDomainParams>();
  const org = useOrg();
  const client = useConnectRpcClient(DevelopmentInstanceService);
  const [instances, setInstances] = useState<DevelopmentInstance[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [operationMessage, setOperationMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOperating, setIsOperating] = useState(false);

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

  const loadInstances = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setIsLoading(true);
    setOperationMessage("");
    try {
      const response = await client.listDevelopmentInstances(
        create(ListDevelopmentInstancesRequestSchema, { project: projectId }),
      );
      setInstances(response.developmentInstances ?? []);
    } catch (error) {
      console.error("Error loading development instances", error);
      setOperationMessage("加载开发实例失败");
    } finally {
      setIsLoading(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    loadInstances();
  }, [loadInstances]);

  const filteredInstances = useMemo(
    () =>
      instances.filter((instance) =>
        searchTerm
          ? `${instance.name} ${instanceId(instance)} ${instance.latestRunName} ${instance.owner}`
              .toLowerCase()
              .includes(searchTerm.toLowerCase())
          : true,
      ),
    [instances, searchTerm],
  );

  const selectedInstances = useMemo(
    () =>
      filteredInstances.filter((instance) =>
        selected.has(instanceId(instance)),
      ),
    [filteredInstances, selected],
  );

  const baseHref = `/domain/${params.domain}/project/${params.project}/development-instances`;
  const createHref = `${baseHref}/create`;

  const refresh = useCallback(() => {
    loadInstances();
  }, [loadInstances]);

  const startSelected = useCallback(async () => {
    if (selectedInstances.length !== 1) {
      return;
    }
    const target = selectedInstances[0];
    setIsOperating(true);
    setOperationMessage("");
    try {
      const nodePort = target.enableSsh
        ? getNextNodePort(await loadUsedNodePorts())
        : 0;
      await client.startDevelopmentInstance(
        create(StartDevelopmentInstanceRequestSchema, {
          id: create(DevelopmentInstanceIdentifierSchema, {
            id: instanceId(target),
          }),
          nodePort,
        }),
      );
      setOperationMessage("已提交启动请求");
      setSelected(new Set());
      await loadInstances();
    } catch (error) {
      console.error("Error starting development instance", error);
      setOperationMessage("启动失败，请查看服务日志");
    } finally {
      setIsOperating(false);
    }
  }, [client, loadInstances, selectedInstances]);

  const stopSelected = useCallback(async () => {
    if (selectedInstances.length === 0) {
      return;
    }
    setIsOperating(true);
    setOperationMessage("");
    try {
      await Promise.all(
        selectedInstances.map((instance) =>
          client.stopDevelopmentInstance(
            create(StopDevelopmentInstanceRequestSchema, {
              id: create(DevelopmentInstanceIdentifierSchema, {
                id: instanceId(instance),
              }),
              reason: "Stopped from development instance console",
            }),
          ),
        ),
      );
      setOperationMessage("已提交停止请求");
      setSelected(new Set());
      await loadInstances();
    } catch (error) {
      console.error("Error stopping development instances", error);
      setOperationMessage("停止失败，请查看服务日志");
    } finally {
      setIsOperating(false);
    }
  }, [client, loadInstances, selectedInstances]);

  const deleteSelected = useCallback(async () => {
    if (selectedInstances.length === 0) {
      return;
    }
    setIsOperating(true);
    setOperationMessage("");
    try {
      await Promise.all(
        selectedInstances.map(async (instance) => {
          if (instance.latestRunName) {
            const response = await fetch(
              getConsoleApiPath("/api/development-instances/delete"),
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  org: instance.org,
                  project: instance.project,
                  domain: instance.domain,
                  runName: instance.latestRunName,
                  namespace: "flyte",
                }),
              },
            );
            if (!response.ok) {
              throw new Error(await response.text());
            }
          }
          await client.deleteDevelopmentInstance(
            create(DeleteDevelopmentInstanceRequestSchema, {
              id: create(DevelopmentInstanceIdentifierSchema, {
                id: instanceId(instance),
              }),
            }),
          );
        }),
      );
      setSelected(new Set());
      setOperationMessage("已删除实例资源，PVC 数据已保留");
      await loadInstances();
    } catch (error) {
      console.error("Error deleting development instances", error);
      setOperationMessage("删除失败，请查看服务日志");
    } finally {
      setIsOperating(false);
    }
  }, [client, loadInstances, selectedInstances]);

  const allSelected =
    filteredInstances.length > 0 &&
    filteredInstances.every((instance) => selected.has(instanceId(instance)));

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={true} />

          <div className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                开发实例 ({filteredInstances.length})
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={buttonClass}
                  onClick={refresh}
                  disabled={isLoading || isOperating}
                  title="刷新"
                >
                  <ArrowPathIcon className="size-5" />
                </button>
                <button
                  className={buttonClass}
                  onClick={deleteSelected}
                  disabled={selectedInstances.length === 0 || isOperating}
                >
                  <TrashIcon className="size-4" />
                  删除
                </button>
                <button
                  className={buttonClass}
                  onClick={stopSelected}
                  disabled={selectedInstances.length === 0 || isOperating}
                >
                  <StopIcon className="size-4" />
                  停止
                </button>
                <button
                  className={buttonClass}
                  onClick={startSelected}
                  disabled={
                    selectedInstances.length !== 1 ||
                    !isTerminalStatus(selectedInstances[0]?.status) ||
                    isOperating
                  }
                >
                  <PlayIcon className="size-4" />
                  启动
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
            {operationMessage && (
              <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                {operationMessage}
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
                            ? new Set(
                                filteredInstances.map((item) =>
                                  instanceId(item),
                                ),
                              )
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="px-4 py-4">名称</th>
                  <th className="px-4 py-4">实例 ID</th>
                  <th className="px-4 py-4">最新运行 ID</th>
                  <th className="px-4 py-4">资源规格</th>
                  <th className="px-4 py-4">状态</th>
                  <th className="px-4 py-4">所有者</th>
                  <th className="px-4 py-4">SSH</th>
                  <th className="px-4 py-4">创建时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredInstances.map((instance) => {
                  const id = instanceId(instance);
                  return (
                    <tr
                      key={id}
                      className="text-sm text-zinc-900 hover:bg-zinc-50 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      <td className="px-8 py-4">
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={(event) => {
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) {
                                next.add(id);
                              } else {
                                next.delete(id);
                              }
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="px-4 py-4 font-medium text-blue-600">
                        <Link href={`${baseHref}/${encodeURIComponent(id)}`}>
                          {instance.name}
                        </Link>
                      </td>
                      <td className="px-4 py-4 font-mono text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                        {id || "-"}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs whitespace-nowrap text-zinc-600 dark:text-zinc-300">
                        {instance.latestRunName || "-"}
                      </td>
                      <td className="px-4 py-4">
                        {instance.resourceSpec?.displayLabel || "-"}
                      </td>
                      <td className="px-4 py-4">
                        <StatusPill status={instance.status} />
                      </td>
                      <td className="px-4 py-4">{instance.owner || "-"}</td>
                      <td className="px-4 py-4 font-mono text-xs">
                        {sshCommand(instance)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        {formatTimestamp(instance.createdAt)}
                      </td>
                    </tr>
                  );
                })}
                {filteredInstances.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-8 py-12 text-center text-sm text-zinc-500"
                    >
                      暂无开发实例
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

export default DevelopmentInstancesListPage;
