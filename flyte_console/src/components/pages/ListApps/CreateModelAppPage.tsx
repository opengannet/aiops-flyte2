/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "@heroicons/react/20/solid";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/Button";
import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { AppService } from "@/gen/flyteidl2/app/app_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";

import { ProjectDomainParams } from "../RunDetails/types";
import { ModelAppFormFields } from "./ModelAppFormFields";
import {
  ModelAppFormValues,
  buildCreateModelAppRequest,
  defaultModelAppFormValues,
  validateModelAppFormValues,
} from "./modelAppUtils";

export function CreateModelAppPage() {
  const params = useParams<ProjectDomainParams>();
  const router = useRouter();
  const org = useOrg();
  const client = useConnectRpcClient(AppService);
  const queryClient = useQueryClient();
  const [values, setValues] = useState<ModelAppFormValues>(
    defaultModelAppFormValues,
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createHref = `/v2/domain/${params.domain}/project/${params.project}/apps`;
  const hasProjectContext = Boolean(org && params.domain && params.project);

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
    setError(null);
    if (!hasProjectContext) {
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
                  disabled={isSubmitting || !hasProjectContext}
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
          </form>
        </div>
      </NavPanelLayout>
    </main>
  );
}
