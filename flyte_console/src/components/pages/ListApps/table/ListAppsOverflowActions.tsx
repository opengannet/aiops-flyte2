/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { PopoverMenu } from "@/components/Popovers";
import { ButtonConfig, SimpleDialog } from "@/components/SimpleDialog";
import {
  App,
  Status_DeploymentStatus,
} from "@/gen/flyteidl2/app/app_definition_pb";
import { getStatus } from "@/lib/appUtils";
import { useDeleteApp, useStartApp, useStopApp } from "@/hooks/useApps";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getLocation } from "@/lib/windowUtils";

export const ListAppsOverflowActions = ({ app }: { app: App }) => {
  const status = getStatus(app.status?.conditions);
  const router = useRouter();
  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isUnspecifiedOrStopped =
    status === Status_DeploymentStatus.UNASSIGNED ||
    status === Status_DeploymentStatus.STOPPED;
  const isDeletable =
    status === Status_DeploymentStatus.UNASSIGNED ||
    status === Status_DeploymentStatus.STOPPED ||
    status === Status_DeploymentStatus.FAILED;

  const startApp = useStartApp({ app });
  const stopApp = useStopApp({ app });
  const deleteApp = useDeleteApp({ app });

  const startStop = isUnspecifiedOrStopped
    ? { id: "start-app", label: "启动应用", onClick: () => startApp.mutate() }
    : { id: "stop-app", label: "停止应用", onClick: () => stopApp.mutate() };
  const { pathname } = getLocation();
  const route = pathname.replace("/v2", "");
  const appName = app.metadata?.id?.name;

  const confirmDelete = async () => {
    setDeleteError(null);
    try {
      await deleteApp.mutateAsync();
      setDeleteDialogOpen(false);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "删除应用失败，请稍后重试",
      );
    }
  };

  const deleteDialogButtons: ButtonConfig[] = [
    {
      color: "rose",
      displayText: deleteApp.isPending ? "删除中..." : "删除",
      onClick: confirmDelete,
      disabled: deleteApp.isPending,
    },
    {
      color: "dark/zinc",
      displayText: "取消",
      onClick: () => setDeleteDialogOpen(false),
      outline: true,
      plain: true,
      disabled: deleteApp.isPending,
    },
  ];

  return (
    <>
      <SimpleDialog
        buttons={deleteDialogButtons}
        content={
          <div className="text-sm dark:text-(--system-gray-5)">
            <p>删除后无法恢复，该应用的运行资源也将被清理。</p>
            {deleteError && (
              <p className="mt-3 text-red-600" role="alert">
                {deleteError}
              </p>
            )}
          </div>
        }
        headerText={`删除 ${appName ?? "应用"}？`}
        isOpen={isDeleteDialogOpen}
        setIsOpen={setDeleteDialogOpen}
      />
      <div
        onClick={(e) => {
          e.preventDefault();
        }}
      >
        <PopoverMenu
          items={[
            {
              id: "app-details",
              label: "查看应用详情",
              onClick: () => {
                router.push(`${route}/${appName}`);
              },
            },
            ...(app.spec?.profile?.type?.toUpperCase() === "VLLM"
              ? [
                  {
                    id: "edit-model-app",
                    label: "编辑",
                    onClick: () => router.push(`${route}/${appName}/edit`),
                  },
                ]
              : []),
            {
              id: "divider-01",
              type: "divider",
            },
            startStop,
            {
              id: "delete-app",
              label: isDeletable ? "删除" : "删除（请先停止应用）",
              disabled: !isDeletable,
              onClick: () => {
                setDeleteError(null);
                setDeleteDialogOpen(true);
              },
            },
            {
              id: "divider-02",
              type: "divider",
            },
            {
              id: "copy-name",
              label: "复制应用名称",
              onClick: () =>
                navigator.clipboard.writeText(app.metadata?.id?.name || "-"),
            },
            {
              id: "copy-endpoint",
              label: "复制访问地址",
              onClick: () =>
                navigator.clipboard.writeText(
                  app.status?.ingress?.publicUrl || "-",
                ),
            },
          ]}
          size="lg"
          triggerAriaLabel="更多操作"
          triggerClassName="group transition-colors hover:bg-(--system-gray-3) data-[state=open]:bg-(--system-gray-3) focus-visible:ring-2 focus-visible:ring-(--system-blue-6) focus-visible:ring-offset-2 focus-visible:outline-none"
          triggerTooltip="更多操作"
          overflowIconClassName="text-(--system-gray-7) transition-colors group-hover:text-(--system-gray-9) group-focus-visible:text-(--system-gray-9)"
          variant="overflow"
        />
      </div>
    </>
  );
};
