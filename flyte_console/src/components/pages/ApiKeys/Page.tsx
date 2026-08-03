/**
 * 漏 Copyright Union Systems Inc 2026. All rights reserved.
 */

"use client";

import { Header } from "@/components/Header";
import { NavPanelLayout } from "@/components/NavPanel/NavPanelLayout";
import {
  ClipboardDocumentIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
} from "@heroicons/react/20/solid";
import { FormEvent, useMemo, useState } from "react";

type CreatedKey = {
  model: string;
  name: string;
  key: string;
};

const fieldClass =
  "h-10 w-full border border-zinc-300 bg-white px-3 text-sm outline-none focus:border-blue-600 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200";
const primaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50";

export function ApiKeysPage() {
  const [model, setModel] = useState("");
  const [externalApiKey, setExternalApiKey] = useState("");
  const [token, setToken] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayedKey = useMemo(() => {
    if (!createdKey) {
      return "";
    }
    return keyVisible ? createdKey.key : maskKey(createdKey.key);
  }, [createdKey, keyVisible]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setCreatedKey(null);
    setCopied(false);
    const trimmedModel = model.trim();
    const trimmedExternalApiKey = externalApiKey.trim();
    const trimmedToken = token.trim();
    if (!trimmedModel) {
      setError("模型标识不能为空");
      return;
    }
    if (!trimmedExternalApiKey) {
      setError("第三方 API Key 不能为空");
      return;
    }
    if (!trimmedToken) {
      setError("New API 凭证不能为空");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(getConsoleApiPath("/token"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${trimmedExternalApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: trimmedModel,
          token: trimmedToken,
        }),
      });
      const body = (await response.json()) as {
        status?: number;
        message?: string;
        data?: CreatedKey;
      };
      if (!response.ok || !body.data) {
        throw new Error(body.message || "创建密钥失败");
      }
      setCreatedKey(body.data);
      setKeyVisible(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "创建密钥失败",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyKey = async () => {
    if (!createdKey) {
      return;
    }
    try {
      await navigator.clipboard.writeText(createdKey.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setError("复制密钥失败");
    }
  };

  return (
    <main className="bg-primary flex h-full min-h-0 w-full">
      <NavPanelLayout initialSize="wide" mode="default">
        <div className="flex h-full min-h-0 w-full flex-col">
          <Header showSearch={false} />
          <div className="border-b border-zinc-200 px-8 py-6 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-9 items-center justify-center border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                  <KeyIcon className="size-5" />
                </span>
                <h1 className="text-2xl font-semibold text-zinc-950 dark:text-white">
                  API密钥
                </h1>
              </div>
            </div>
            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
            <form
              onSubmit={onSubmit}
              className="max-w-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="grid gap-5">
                <label className="grid gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  模型标识
                  <input
                    className={fieldClass}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="sakamakismile/Qwen3.6-27B-NVFP4"
                    disabled={isSubmitting}
                  />
                </label>

                <label className="grid gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  第三方 API Key
                  <input
                    className={fieldClass}
                    type="password"
                    value={externalApiKey}
                    onChange={(event) => setExternalApiKey(event.target.value)}
                    placeholder="用于调用 /token 的外部 API Key"
                    autoComplete="new-password"
                    disabled={isSubmitting}
                  />
                </label>

                <label className="grid gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  New API 凭证
                  <span className="flex h-10 border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950">
                    <input
                      className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none disabled:bg-zinc-100 disabled:text-zinc-500 dark:text-zinc-100 dark:disabled:bg-zinc-900"
                      type={tokenVisible ? "text" : "password"}
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder="New API Dashboard/PAT token"
                      autoComplete="new-password"
                      disabled={isSubmitting}
                    />
                    <button
                      type="button"
                      className="inline-flex w-10 items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                      onClick={() => setTokenVisible((current) => !current)}
                      title={tokenVisible ? "隐藏凭证" : "显示凭证"}
                      aria-label={tokenVisible ? "隐藏凭证" : "显示凭证"}
                    >
                      {tokenVisible ? (
                        <EyeSlashIcon className="size-5" />
                      ) : (
                        <EyeIcon className="size-5" />
                      )}
                    </button>
                  </span>
                </label>

                <div>
                  <button
                    type="submit"
                    className={primaryButtonClass}
                    disabled={isSubmitting}
                  >
                    <KeyIcon className="size-5" />
                    {isSubmitting ? "创建中" : "创建密钥"}
                  </button>
                </div>
              </div>
            </form>

            {createdKey && (
              <section className="mt-6 max-w-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
                <div className="grid gap-4">
                  <div>
                    <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                      名称
                    </div>
                    <div className="mt-1 font-mono text-sm text-zinc-900 dark:text-zinc-100">
                      {createdKey.name}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                      密钥
                    </div>
                    <div className="mt-2 flex min-h-10 items-center justify-between gap-3 border border-zinc-200 bg-zinc-50 px-3 dark:border-zinc-800 dark:bg-zinc-900">
                      <span className="min-w-0 break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">
                        {displayedKey}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => setKeyVisible((current) => !current)}
                          title={keyVisible ? "隐藏密钥" : "显示密钥"}
                          aria-label={keyVisible ? "隐藏密钥" : "显示密钥"}
                        >
                          {keyVisible ? (
                            <EyeSlashIcon className="size-4" />
                          ) : (
                            <EyeIcon className="size-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={copyKey}
                          title="复制密钥"
                          aria-label="复制密钥"
                        >
                          <ClipboardDocumentIcon className="size-4" />
                          {copied ? "已复制" : "复制"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </NavPanelLayout>
    </main>
  );
}

function getConsoleApiPath(path: string) {
  if (typeof window === "undefined") {
    return path;
  }
  return window.location.pathname.startsWith("/v2/") ? `/v2${path}` : path;
}

function maskKey(key: string) {
  if (key.length <= 8) {
    return "*".repeat(key.length);
  }
  return `${key.slice(0, 4)}*********${key.slice(-3)}`;
}
