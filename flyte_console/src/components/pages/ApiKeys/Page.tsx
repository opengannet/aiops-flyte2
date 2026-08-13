/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import { KeyIcon } from "@heroicons/react/20/solid";

export function ApiKeysPage({ publicURL }: { publicURL: string }) {
  const target = publicURL.trim().replace(/\/$/, "");

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={false} />
          <div className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-9 items-center justify-center border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                <KeyIcon className="size-5" />
              </span>
              <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                Model publication and API keys
              </h1>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <section className="max-w-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-sm text-zinc-700 dark:text-zinc-300">
                Model invocation keys are managed by aione-api. Flyte external
                management API keys and model invocation keys are separate.
              </p>
              {target ? (
                <a
                  className="mt-5 inline-flex h-10 items-center justify-center bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
                  href={`${target}/models/deployments`}
                >
                  Open publication and API key management
                </a>
              ) : (
                <p className="mt-5 text-sm text-red-600">
                  AIONE_PUBLIC_URL is not configured.
                </p>
              )}
            </section>
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}
