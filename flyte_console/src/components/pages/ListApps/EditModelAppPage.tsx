/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowPathIcon } from "@heroicons/react/20/solid";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/Button";
import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { IdentifierSchema } from "@/gen/flyteidl2/app/app_definition_pb";
import { GetModelAppConfigRequestSchema } from "@/gen/flyteidl2/app/app_payload_pb";
import type { ModelAppConfig } from "@/gen/flyteidl2/app/app_payload_pb";
import { AppService } from "@/gen/flyteidl2/app/app_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";

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
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<ModelAppConfig>();
  const [values, setValues] = useState<ModelAppFormValues>(
    defaultModelAppFormValues,
  );
  const [tokenConfigured, setTokenConfigured] = useState<boolean[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const detailHref = `/v2/domain/${params.domain}/project/${params.project}/apps/${params.appId}`;
  const configMatchesRoute = Boolean(
    config?.appId &&
      config.appId.org === org &&
      config.appId.project === params.project &&
      config.appId.domain === params.domain &&
      config.appId.name === params.appId,
  );

  useEffect(() => {
    let cancelled = false;
    setConfig(undefined);
    setValues(defaultModelAppFormValues);
    setTokenConfigured([]);
    setError("");
    if (!org || !params.appId || !params.domain || !params.project) {
      setIsLoading(false);
      return;
    }
    const requestedAppId = {
      org,
      project: params.project,
      domain: params.domain,
      name: params.appId,
    };
    setIsLoading(true);
    client
      .getModelAppConfig(
        create(GetModelAppConfigRequestSchema, {
          appId: create(IdentifierSchema, requestedAppId),
        }),
      )
      .then((response) => {
        if (cancelled) return;
        const responseAppId = response.model?.appId;
        if (
          !response.model ||
          !responseAppId ||
          responseAppId.org !== requestedAppId.org ||
          responseAppId.project !== requestedAppId.project ||
          responseAppId.domain !== requestedAppId.domain ||
          responseAppId.name !== requestedAppId.name
        ) {
          throw new Error("模型应用配置不存在");
        }
        setConfig(response.model);
        setValues(modelAppConfigToFormValues(response.model));
        setTokenConfigured(
          response.model.codes.map((source) => source.tokenConfigured),
        );
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

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!config?.appId || !configMatchesRoute || isLoading) return;
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
        updateError instanceof Error ? updateError.message : String(updateError);
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
                  disabled={isLoading || isSubmitting || !configMatchesRoute}
                  type="submit"
                >
                  <ArrowPathIcon data-slot="icon" />
                  {isSubmitting ? "保存中" : "保存并重启"}
                </Button>
              </div>
            </div>

            {error && (
              <div
                aria-live="polite"
                className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500"
                role="alert"
              >
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
          </form>
        </div>
      </NavPanelLayout>
    </main>
  );
}
