/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/Button";
import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import type { CloudStorage } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import {
  CloudStorageService,
  ListCloudStoragesRequestSchema,
} from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_service_pb";
import { IdentifierSchema } from "@/gen/flyteidl2/app/app_definition_pb";
import { GetModelAppConfigRequestSchema } from "@/gen/flyteidl2/app/app_payload_pb";
import type { ModelAppConfig } from "@/gen/flyteidl2/app/app_payload_pb";
import { AppService } from "@/gen/flyteidl2/app/app_service_pb";
import { ProjectIdentifierSchema } from "@/gen/flyteidl2/common/identifier_pb";
import { ListRequestSchema } from "@/gen/flyteidl2/common/list_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";

import { ModelAppCloudStorageList } from "./ModelAppCloudStorageList";
import { ModelAppFormFields } from "./ModelAppFormFields";
import {
  buildUpdateModelAppRequest,
  defaultModelAppFormValues,
  modelAppConfigToFormValues,
  validateModelAppFormValues,
} from "./modelAppUtils";
import type { ModelAppFormValues } from "./modelAppUtils";

type EditModelAppParams = {
  appId: string;
  domain: string;
  project: string;
};

export function EditModelAppPage() {
  const params = useParams<EditModelAppParams>();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(AppService);
  const cloudStorageClient = useConnectRpcClient(CloudStorageService);
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<ModelAppConfig>();
  const [values, setValues] = useState<ModelAppFormValues>(
    defaultModelAppFormValues,
  );
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cloudStorages, setCloudStorages] = useState<CloudStorage[]>([]);
  const [isLoadingCloudStorages, setIsLoadingCloudStorages] = useState(false);
  const [cloudStorageError, setCloudStorageError] = useState("");

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
  const detailHref = `/v2/domain/${params.domain}/project/${params.project}/apps/${params.appId}`;

  useEffect(() => {
    let cancelled = false;
    if (!org || !params.appId || !params.domain || !params.project) {
      return;
    }
    setIsLoading(true);
    setError("");
    client
      .getModelAppConfig(
        create(GetModelAppConfigRequestSchema, {
          appId: create(IdentifierSchema, {
            org,
            project: params.project,
            domain: params.domain,
            name: params.appId,
          }),
        }),
      )
      .then((response) => {
        if (cancelled) return;
        if (!response.model?.appId) {
          throw new Error("模型应用配置不存在");
        }
        setConfig(response.model);
        setValues(modelAppConfigToFormValues(response.model));
        setTokenConfigured(response.model.codes[0]?.tokenConfigured ?? false);
      })
      .catch((loadError) => {
        console.error("Error loading model app config", loadError);
        if (!cancelled) {
          const message =
            loadError instanceof Error ? loadError.message : String(loadError);
          setError(`加载模型应用配置失败：${message}`);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, org, params.appId, params.domain, params.project]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) return;
    const loadCloudStorages = async () => {
      setIsLoadingCloudStorages(true);
      setCloudStorageError("");
      try {
        const allCloudStorages: CloudStorage[] = [];
        const seenTokens = new Set<string>();
        let token = "";
        while (!cancelled) {
          const response = await cloudStorageClient.listCloudStorages(
            create(ListCloudStoragesRequestSchema, {
              project: projectId,
              request: create(ListRequestSchema, { limit: 50, token }),
            }),
          );
          if (cancelled) break;
          allCloudStorages.push(...(response.cloudStorages ?? []));
          const nextToken = response.token;
          if (!nextToken || seenTokens.has(nextToken)) break;
          seenTokens.add(nextToken);
          token = nextToken;
        }
        if (!cancelled) setCloudStorages(allCloudStorages);
      } catch (loadError) {
        console.error("Error loading cloud storages", loadError);
        if (!cancelled) setCloudStorageError("加载云存储失败");
      } finally {
        if (!cancelled) setIsLoadingCloudStorages(false);
      }
    };
    void loadCloudStorages();
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

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config?.appId || isLoading) return;
    const validationError = validateModelAppFormValues(values);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      await client.updateModelApp(
        buildUpdateModelAppRequest({
          appId: {
            org: config.appId.org,
            project: config.appId.project,
            domain: config.appId.domain,
            name: config.appId.name,
          },
          values,
        }),
      );
      await queryClient.invalidateQueries({
        queryKey: ["apps", org, params.project, params.domain],
      });
      router.push(
        `/domain/${params.domain}/project/${params.project}/apps/${config.appId.name}`,
      );
    } catch (updateError) {
      const message =
        updateError instanceof Error
          ? updateError.message
          : String(updateError);
      setError(`保存模型应用失败：${message}`);
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
                <h1 className="text-xl font-medium">编辑模型应用</h1>
                <div className="mt-1 text-sm dark:text-(--system-gray-6)">
                  {params.project} / {params.domain}
                </div>
              </div>
              <div className="flex gap-3">
                <Button href={detailHref} outline>
                  取消
                </Button>
                <Button
                  color="union"
                  disabled={
                    isLoading ||
                    isSubmitting ||
                    !config ||
                    Boolean(error && !config)
                  }
                  type="submit"
                >
                  <ArrowPathIcon data-slot="icon" />
                  {isSubmitting ? "保存中" : "保存并重启"}
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                {error}
              </div>
            )}
            {isLoading && (
              <div className="text-sm dark:text-(--system-gray-6)">
                加载模型应用配置
              </div>
            )}

            <ModelAppFormFields
              values={values}
              onFieldChange={setField}
              onCodeFieldChange={setCodeField}
              readOnlyIdentity
              readOnlySource
              tokenConfigured={tokenConfigured}
            />

            <section className="flex flex-col gap-4 pb-8">
              <h2 className="text-sm font-bold">云存储</h2>
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
