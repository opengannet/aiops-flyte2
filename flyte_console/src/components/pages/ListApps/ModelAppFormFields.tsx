/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import type { ReactNode } from "react";

import type { ModelAppFormValues } from "./modelAppUtils";

export const modelAppInputClassName =
  "h-9 w-full rounded-md border border-(--system-gray-4) bg-transparent px-3 text-sm outline-none focus:border-(--accent-text-blue) read-only:bg-(--system-gray-1) read-only:text-(--system-gray-6) disabled:cursor-not-allowed disabled:bg-(--system-gray-1) disabled:text-(--system-gray-6)";
const textareaClassName =
  "min-h-32 w-full resize-y rounded-md border border-(--system-gray-4) bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-(--accent-text-blue)";

type Props = {
  values: ModelAppFormValues;
  onFieldChange: (field: keyof ModelAppFormValues, value: string) => void;
  onCodeFieldChange: (
    field: keyof ModelAppFormValues["codes"][number],
    value: string,
  ) => void;
  readOnlyIdentity?: boolean;
  readOnlySource?: boolean;
  tokenConfigured?: boolean[];
};

export function ModelAppFormFields({
  values,
  onFieldChange,
  onCodeFieldChange,
  readOnlyIdentity = false,
  readOnlySource = false,
  tokenConfigured = [],
}: Props) {
  const sources = readOnlySource
    ? values.codes.filter(
        (source) => source.id || source.branch || source.path || source.token,
      )
    : [values.codes[0] ?? { id: "", branch: "", path: "", token: "" }];
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-bold">模型信息</h2>
          <ModelAppField label="应用名称">
            <input
              className={modelAppInputClassName}
              value={values.name}
              onChange={(event) => onFieldChange("name", event.target.value)}
            />
          </ModelAppField>
          <div className="grid gap-4 sm:grid-cols-2">
            <ModelAppField label="应用 ID">
              <input
                className={modelAppInputClassName}
                aria-readonly={readOnlyIdentity}
                readOnly={readOnlyIdentity}
                value={values.id}
                onChange={(event) => onFieldChange("id", event.target.value)}
              />
            </ModelAppField>
            <ModelAppField label="模型代码">
              <input
                className={modelAppInputClassName}
                aria-readonly={readOnlyIdentity}
                readOnly={readOnlyIdentity}
                value={values.code}
                onChange={(event) => onFieldChange("code", event.target.value)}
              />
            </ModelAppField>
          </div>
          <ModelAppField label="镜像">
            <input
              className={modelAppInputClassName}
              value={values.image}
              onChange={(event) => onFieldChange("image", event.target.value)}
            />
          </ModelAppField>
          <ModelAppField label="启动参数">
            <textarea
              className={textareaClassName}
              value={values.param}
              onChange={(event) => onFieldChange("param", event.target.value)}
            />
          </ModelAppField>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-bold">资源配置</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <ModelAppField label="CPU">
              <input
                className={modelAppInputClassName}
                value={values.cpu}
                onChange={(event) => onFieldChange("cpu", event.target.value)}
              />
            </ModelAppField>
            <ModelAppField label="内存">
              <input
                className={modelAppInputClassName}
                value={values.memory}
                onChange={(event) =>
                  onFieldChange("memory", event.target.value)
                }
              />
            </ModelAppField>
            <ModelAppField label="GPU">
              <input
                className={modelAppInputClassName}
                inputMode="numeric"
                min={0}
                step={1}
                type="number"
                value={values.gpu}
                onChange={(event) => onFieldChange("gpu", event.target.value)}
              />
            </ModelAppField>
            <ModelAppField label="GPU 资源键">
              <input
                className={modelAppInputClassName}
                value={values.gpuKey}
                onChange={(event) =>
                  onFieldChange("gpuKey", event.target.value)
                }
              />
            </ModelAppField>
          </div>
        </section>
      </div>

      <section className="flex flex-col gap-4 pb-8">
        <h2 className="text-sm font-bold">模型来源</h2>
        {sources.length === 0 ? (
          <div className="text-sm dark:text-(--system-gray-6)">无模型来源</div>
        ) : (
          <div className="flex flex-col gap-4">
            {sources.map((source, index) => (
              <div
                className="grid gap-4 border border-(--system-gray-4) p-3 lg:grid-cols-2"
                key={index}
              >
                {sources.length > 1 && (
                  <h3 className="text-sm font-medium lg:col-span-2">
                    来源 {index + 1}
                  </h3>
                )}
                <ModelAppField label="仓库地址">
                  <input
                    aria-readonly={readOnlySource}
                    className={modelAppInputClassName}
                    readOnly={readOnlySource}
                    value={source.id}
                    onChange={(event) =>
                      onCodeFieldChange("id", event.target.value)
                    }
                  />
                </ModelAppField>
                <ModelAppField label="分支">
                  <input
                    aria-readonly={readOnlySource}
                    className={modelAppInputClassName}
                    readOnly={readOnlySource}
                    value={source.branch}
                    onChange={(event) =>
                      onCodeFieldChange("branch", event.target.value)
                    }
                  />
                </ModelAppField>
                <ModelAppField label="目标路径">
                  <input
                    aria-readonly={readOnlySource}
                    className={modelAppInputClassName}
                    readOnly={readOnlySource}
                    value={source.path}
                    onChange={(event) =>
                      onCodeFieldChange("path", event.target.value)
                    }
                  />
                </ModelAppField>
                <ModelAppField label="访问令牌">
                  <input
                    aria-readonly={readOnlySource}
                    className={modelAppInputClassName}
                    readOnly={readOnlySource}
                    type={readOnlySource ? "text" : "password"}
                    value={
                      readOnlySource
                        ? tokenConfigured[index]
                          ? "已配置"
                          : "未配置"
                        : source.token
                    }
                    onChange={(event) =>
                      onCodeFieldChange("token", event.target.value)
                    }
                  />
                </ModelAppField>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export function ModelAppField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}
