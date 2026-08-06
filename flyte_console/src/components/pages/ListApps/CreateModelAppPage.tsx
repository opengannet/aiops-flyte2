/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Button } from "@/components/Button";
import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { CloudStorage } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import {
  CloudStorageInputSchema,
  CloudStorageService,
  CreateCloudStorageRequestSchema,
  ListCloudStoragesRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import { AppService } from "@/gen/flyteidl2/app/app_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { ListRequestSchema } from "@/gen/flyteidl2/common/list_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "@heroicons/react/20/solid";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ProjectDomainParams } from "../RunDetails/types";
import {
  ModelAppFormValues,
  buildCreateModelAppRequest,
  defaultModelAppFormValues,
  validateModelAppFormValues,
} from "./modelAppUtils";
import { ModelAppCloudStorageList } from "./ModelAppCloudStorageList";
import { ModelAppFormFields } from "./ModelAppFormFields";

const inputClassName =
  "h-9 w-full rounded-md border border-(--system-gray-4) bg-transparent px-3 text-sm outline-none focus:border-(--accent-text-blue)";
export function CreateModelAppPage() {
  const params = useParams<ProjectDomainParams>();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(AppService);
  const cloudStorageClient = useConnectRpcClient(CloudStorageService);
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ModelAppFormValues>(
    defaultModelAppFormValues,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cloudStorages, setCloudStorages] = useState<CloudStorage[]>([]);
  const [cloudStorageError, setCloudStorageError] = useState("");
  const [isLoadingCloudStorages, setIsLoadingCloudStorages] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [isCreatingCloudStorage, setIsCreatingCloudStorage] = useState(false);
  const [quickCreateError, setQuickCreateError] = useState("");
  const [quickCreateValues, setQuickCreateValues] = useState({
    name: "",
    description: "",
    sizeGb: 1,
    storageClassName: "",
  });

  const createHref = useMemo(
    () => `/v2/domain/${params.domain}/project/${params.project}/apps`,
    [params.domain, params.project],
  );
  const cloudStorageListHref = `/domain/${params.domain}/project/${params.project}/cloud-storages`;
  const projectId = useMemo(
    () =>
      org && params.domain && params.project
        ? create(ProjectIdentifierSchema, {
            organization: org,
            domain: params.domain,
            name: params.project,
          })
        : undefined,
    [org, params.domain, params.project],
  );

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      return;
    }
    const loadCloudStorages = async () => {
      setIsLoadingCloudStorages(true);
      setCloudStorageError("");
      try {
        const allCloudStorages: CloudStorage[] = [];
        const seenTokens = new Set<string>();
        let token = "";
        while (true) {
          if (cancelled) {
            break;
          }
          const response = await cloudStorageClient.listCloudStorages(
            create(ListCloudStoragesRequestSchema, {
              project: projectId,
              request: create(ListRequestSchema, { limit: 50, token }),
            }),
          );
          if (cancelled) {
            break;
          }
          allCloudStorages.push(...(response.cloudStorages ?? []));
          const nextToken = response.token;
          if (!nextToken || seenTokens.has(nextToken)) {
            break;
          }
          seenTokens.add(nextToken);
          token = nextToken;
        }
        if (!cancelled) {
          setCloudStorages((current) => {
            const byId = new Map<string, CloudStorage>();
            for (const storage of [...allCloudStorages, ...current]) {
              const storageId = storage.id?.id;
              if (storageId) {
                byId.set(storageId, storage);
              }
            }
            return [...byId.values()];
          });
        }
      } catch (loadError) {
        console.error("Error loading cloud storages", loadError);
        if (!cancelled) {
          setCloudStorageError("加载云存储失败");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCloudStorages(false);
        }
      }
    };
    loadCloudStorages();
    return () => {
      cancelled = true;
    };
  }, [cloudStorageClient, projectId]);

  const setField = (field: keyof ModelAppFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const setCodeField = (
    field: keyof ModelAppFormValues["codes"][number],
    value: string,
  ) => {
    setValues((current) => ({
      ...current,
      codes: current.codes.map((source, index) =>
        index === 0 ? { ...source, [field]: value } : source,
      ),
    }));
  };

  const setCloudStorageSelected = (storageId: string, selected: boolean) => {
    setValues((current) => ({
      ...current,
      cloudStorageMounts: selected
        ? [
            ...current.cloudStorageMounts,
            { cloudStorageId: storageId, mountPath: `/mnt/${storageId}` },
          ]
        : current.cloudStorageMounts.filter(
            (mount) => mount.cloudStorageId !== storageId,
          ),
    }));
  };

  const setCloudStorageMountPath = (storageId: string, mountPath: string) => {
    setValues((current) => ({
      ...current,
      cloudStorageMounts: current.cloudStorageMounts.map((mount) =>
        mount.cloudStorageId === storageId ? { ...mount, mountPath } : mount,
      ),
    }));
  };

  const createCloudStorage = async () => {
    setQuickCreateError("");
    if (!projectId) {
      setQuickCreateError("项目上下文未加载完成");
      return;
    }
    const name = quickCreateValues.name.trim();
    if (!name) {
      setQuickCreateError("请输入云存储名称");
      return;
    }
    if (
      !Number.isInteger(quickCreateValues.sizeGb) ||
      quickCreateValues.sizeGb < 1 ||
      quickCreateValues.sizeGb > 1000
    ) {
      setQuickCreateError("容量必须为 1-1000 GB");
      return;
    }
    setIsCreatingCloudStorage(true);
    try {
      const response = await cloudStorageClient.createCloudStorage(
        create(CreateCloudStorageRequestSchema, {
          project: projectId,
          creator: "console",
          cloudStorage: create(CloudStorageInputSchema, {
            name,
            description: quickCreateValues.description.trim(),
            sizeGb: quickCreateValues.sizeGb,
            storageClassName: quickCreateValues.storageClassName.trim(),
          }),
        }),
      );
      const storage = response.cloudStorage;
      const storageId = storage?.id?.id;
      if (!storage || !storageId) {
        throw new Error("missing cloud storage id");
      }
      setCloudStorages((current) => [
        ...current.filter((item) => item.id?.id !== storageId),
        storage,
      ]);
      setValues((current) => ({
        ...current,
        cloudStorageMounts: [
          ...current.cloudStorageMounts.filter(
            (mount) => mount.cloudStorageId !== storageId,
          ),
          { cloudStorageId: storageId, mountPath: `/mnt/${storageId}` },
        ],
      }));
      setQuickCreateValues({
        name: "",
        description: "",
        sizeGb: 1,
        storageClassName: "",
      });
      setIsQuickCreateOpen(false);
    } catch (createError) {
      console.error("Error creating cloud storage", createError);
      setQuickCreateError("创建云存储失败");
    } finally {
      setIsCreatingCloudStorage(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!projectId) {
      setError("项目上下文未加载完成");
      return;
    }
    const validationError = validateModelAppFormValues(values);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSubmitting(true);
    try {
      const request = buildCreateModelAppRequest({
        org,
        project: params.project,
        domain: params.domain,
        values,
      });
      const response = await client.createModelApp(request);
      await queryClient.invalidateQueries({
        queryKey: ["apps", org, params.project, params.domain],
      });
      const appName = response.app?.metadata?.id?.name || values.id;
      router.push(
        `/domain/${params.domain}/project/${params.project}/apps/${appName}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`创建模型应用失败：${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="embedded">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={false} />
          <form
            onSubmit={onSubmit}
            className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-auto px-10 py-6"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-medium">创建模型应用</h1>
                <div className="mt-1 text-sm dark:text-(--system-gray-6)">
                  {params.project} / {params.domain}
                </div>
              </div>
              <div className="flex gap-3">
                <Button href={createHref} outline>
                  取消
                </Button>
                <Button
                  color="union"
                  disabled={
                    isSubmitting || isCreatingCloudStorage || !projectId
                  }
                  type="submit"
                >
                  <PlusIcon data-slot="icon" />
                  {isSubmitting ? "创建中" : "创建"}
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                {error}
              </div>
            )}

            <ModelAppFormFields
              values={values}
              onFieldChange={setField}
              onCodeFieldChange={setCodeField}
            />

            <section className="flex flex-col gap-4 pb-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-bold">云存储</h2>
                <div className="flex items-center gap-2">
                  <Button href={cloudStorageListHref} outline size="sm">
                    管理云存储
                  </Button>
                  <Button
                    outline
                    disabled={!projectId || isCreatingCloudStorage}
                    size="sm"
                    type="button"
                    onClick={() => {
                      setQuickCreateError("");
                      setIsQuickCreateOpen((current) => !current);
                    }}
                  >
                    <PlusIcon data-slot="icon" />
                    快速新建
                  </Button>
                </div>
              </div>

              {isQuickCreateOpen && (
                <div
                  className="grid gap-4 border border-(--system-gray-4) p-4 lg:grid-cols-2"
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.target instanceof HTMLInputElement ||
                        event.target instanceof HTMLTextAreaElement)
                    ) {
                      event.preventDefault();
                      if (!isCreatingCloudStorage && projectId) {
                        void createCloudStorage();
                      }
                    }
                  }}
                >
                  <Field label="云存储名称">
                    <input
                      className={inputClassName}
                      value={quickCreateValues.name}
                      onChange={(event) =>
                        setQuickCreateValues((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="云存储描述">
                    <input
                      className={inputClassName}
                      value={quickCreateValues.description}
                      onChange={(event) =>
                        setQuickCreateValues((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="容量（GB）">
                    <input
                      className={inputClassName}
                      type="number"
                      min={1}
                      max={1000}
                      value={quickCreateValues.sizeGb}
                      onChange={(event) =>
                        setQuickCreateValues((current) => ({
                          ...current,
                          sizeGb: Number(event.target.value),
                        }))
                      }
                    />
                  </Field>
                  <Field label="StorageClass（可选）">
                    <input
                      className={inputClassName}
                      value={quickCreateValues.storageClassName}
                      onChange={(event) =>
                        setQuickCreateValues((current) => ({
                          ...current,
                          storageClassName: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <div className="flex items-center gap-3 lg:col-span-2">
                    <Button
                      color="union"
                      disabled={isCreatingCloudStorage || !projectId}
                      size="sm"
                      type="button"
                      onClick={createCloudStorage}
                    >
                      {isCreatingCloudStorage ? "新建中" : "新建并选择"}
                    </Button>
                    {quickCreateError && (
                      <span className="text-sm text-red-500">
                        {quickCreateError}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <ModelAppCloudStorageList
                cloudStorages={cloudStorages}
                error={cloudStorageError}
                isLoading={isLoadingCloudStorages}
                mounts={values.cloudStorageMounts}
                onSelectedChange={setCloudStorageSelected}
                onMountPathChange={setCloudStorageMountPath}
              />
            </section>
          </form>
        </div>
      </NavPanelLayout>
    </main>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium dark:text-(--system-gray-6)">
        {label}
      </span>
      {children}
    </label>
  );
}
