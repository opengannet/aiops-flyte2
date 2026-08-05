/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Button } from "@/components/Button";
import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { AppService } from "@/gen/flyteidl2/app/app_service_pb";
import { useConnectRpcClient } from "@/hooks/useConnectRpc";
import { useOrg } from "@/hooks/useOrg";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "@heroicons/react/20/solid";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ProjectDomainParams } from "../RunDetails/types";
import {
  ModelAppFormValues,
  buildCreateModelAppRequest,
  defaultModelAppFormValues,
} from "./modelAppUtils";

const inputClassName =
  "h-9 w-full rounded-md border border-(--system-gray-4) bg-transparent px-3 text-sm outline-none focus:border-(--accent-text-blue)";
const textareaClassName =
  "min-h-32 w-full resize-y rounded-md border border-(--system-gray-4) bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-(--accent-text-blue)";

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

  const createHref = useMemo(
    () => `/domain/${params.domain}/project/${params.project}/apps`,
    [params.domain, params.project],
  );

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
      setError(err instanceof Error ? err.message : String(err));
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
                <h1 className="text-xl font-medium">Create model app</h1>
                <div className="mt-1 text-sm dark:text-(--system-gray-6)">
                  {params.project} / {params.domain}
                </div>
              </div>
              <div className="flex gap-3">
                <Button href={createHref} outline>
                  Cancel
                </Button>
                <Button color="union" disabled={isSubmitting} type="submit">
                  <PlusIcon data-slot="icon" />
                  {isSubmitting ? "Creating" : "Create"}
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                {error}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <section className="flex flex-col gap-4">
                <h2 className="text-sm font-bold">Model</h2>
                <Field label="App name">
                  <input
                    className={inputClassName}
                    value={values.name}
                    onChange={(event) => setField("name", event.target.value)}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="App id">
                    <input
                      className={inputClassName}
                      value={values.id}
                      onChange={(event) => setField("id", event.target.value)}
                    />
                  </Field>
                  <Field label="Model code">
                    <input
                      className={inputClassName}
                      value={values.code}
                      onChange={(event) => setField("code", event.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Image">
                  <input
                    className={inputClassName}
                    value={values.image}
                    onChange={(event) => setField("image", event.target.value)}
                  />
                </Field>
                <Field label="Parameters">
                  <textarea
                    className={textareaClassName}
                    value={values.param}
                    onChange={(event) => setField("param", event.target.value)}
                  />
                </Field>
              </section>

              <section className="flex flex-col gap-4">
                <h2 className="text-sm font-bold">Resources</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                  <Field label="CPU">
                    <input
                      className={inputClassName}
                      value={values.cpu}
                      onChange={(event) => setField("cpu", event.target.value)}
                    />
                  </Field>
                  <Field label="Memory">
                    <input
                      className={inputClassName}
                      value={values.memory}
                      onChange={(event) =>
                        setField("memory", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="GPU">
                    <input
                      className={inputClassName}
                      inputMode="numeric"
                      value={values.gpu}
                      onChange={(event) => setField("gpu", event.target.value)}
                    />
                  </Field>
                  <Field label="GPU key">
                    <input
                      className={inputClassName}
                      value={values.gpuKey}
                      onChange={(event) =>
                        setField("gpuKey", event.target.value)
                      }
                    />
                  </Field>
                </div>
              </section>
            </div>

            <section className="flex flex-col gap-4 pb-8">
              <h2 className="text-sm font-bold">Model source</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Repository URL">
                  <input
                    className={inputClassName}
                    value={values.codes[0]?.id || ""}
                    onChange={(event) => setCodeField("id", event.target.value)}
                  />
                </Field>
                <Field label="Branch">
                  <input
                    className={inputClassName}
                    value={values.codes[0]?.branch || ""}
                    onChange={(event) =>
                      setCodeField("branch", event.target.value)
                    }
                  />
                </Field>
                <Field label="Target path">
                  <input
                    className={inputClassName}
                    value={values.codes[0]?.path || ""}
                    onChange={(event) =>
                      setCodeField("path", event.target.value)
                    }
                  />
                </Field>
                <Field label="Token">
                  <input
                    className={inputClassName}
                    type="password"
                    value={values.codes[0]?.token || ""}
                    onChange={(event) =>
                      setCodeField("token", event.target.value)
                    }
                  />
                </Field>
              </div>
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
