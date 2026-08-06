/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelAppConfigSchema } from "@/gen/flyteidl2/app/app_payload_pb";
import { EditModelAppPage } from "./EditModelAppPage";

const mocks = vi.hoisted(() => ({
  appClient: {
    getModelAppConfig: vi.fn(),
    updateModelApp: vi.fn(),
  },
  cloudStorageClient: { listCloudStorages: vi.fn() },
  invalidateQueries: vi.fn(),
  org: "aione",
  params: {
    appId: "qwen25-15b",
    domain: "development",
    project: "aione",
  },
  push: vi.fn(),
}));

vi.mock("@/components/Header", () => ({ Header: () => <div /> }));
vi.mock("@/components/NavPanel/NavPanelLayout", () => ({
  NavPanelLayout: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/hooks/useConnectRpc", () => ({
  useConnectRpcClient: (service: { typeName?: string }) =>
    service.typeName?.includes("CloudStorageService")
      ? mocks.cloudStorageClient
      : mocks.appClient,
}));
vi.mock("@/hooks/useOrg", () => ({ useOrg: () => mocks.org }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => mocks.params,
  useRouter: () => ({ push: mocks.push }),
}));

function modelConfig(
  appId = "qwen25-15b",
  codes = [
    {
      id: "http://gitea.ops.fzyun.io/aione/Qwen2.5-1.5B-Instruct.git",
      branch: "main",
      path: "/models/qwen25-15b",
      tokenConfigured: true,
    },
  ],
) {
  return create(ModelAppConfigSchema, {
    appId: {
      org: "aione",
      project: "aione",
      domain: "development",
      name: appId,
    },
    name: "Qwen2.5 1.5B Instruct",
    code: "qwen25-15b",
    image: "vllm",
    param:
      "--served-model-name\nqwen25-15b\n--max-num-seqs\n16\n--max-model-len\n8192\n--enforce-eager",
    codes,
    resourceDefinition: {
      cpu: "4",
      memory: "16Gi",
      gpu: 1,
      gpuKey: "nvidia.com/gpu",
    },
    modelCachePvc: {
      name: "qwen25-15b-aione-development-model-cache",
      storageClassName: "bj1-ebs",
      requestedSize: "80Gi",
      capacity: "80Gi",
      expandable: true,
    },
  });
}

describe("EditModelAppPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.org = "aione";
    mocks.params = {
      appId: "qwen25-15b",
      domain: "development",
      project: "aione",
    };
    mocks.appClient.getModelAppConfig.mockResolvedValue({
      model: modelConfig(),
    });
    mocks.appClient.updateModelApp.mockResolvedValue({ app: {} });
    mocks.cloudStorageClient.listCloudStorages.mockResolvedValue({
      cloudStorages: [],
      token: "",
    });
  });
  afterEach(cleanup);

  it("loads live parameters and keeps identity and source fields read-only", async () => {
    render(<EditModelAppPage />);

    expect(
      await screen.findByRole("heading", { name: "编辑模型应用" }),
    ).toBeVisible();
    expect(screen.getByLabelText("应用 ID")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("应用 ID")).toHaveAttribute(
      "aria-readonly",
      "true",
    );
    expect(screen.getByLabelText("模型代码")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("仓库地址")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("分支")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("目标路径")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("访问令牌")).toHaveValue("已配置");
    expect(screen.getByLabelText("访问令牌")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("GPU")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("GPU")).toHaveAttribute("min", "0");
    expect(screen.getByLabelText("GPU")).toHaveAttribute("step", "1");
    expect(screen.getByLabelText("模型缓存 PVC 容量 (Gi)")).toHaveValue(80);
    expect(
      screen.getByText("PVC: qwen25-15b-aione-development-model-cache"),
    ).toBeVisible();
    expect(screen.getByText("StorageClass: bj1-ebs")).toBeVisible();
    expect(screen.getByText(/80Gi/)).toBeVisible();
    const param = screen.getByLabelText("启动参数") as HTMLTextAreaElement;
    expect(param.value).toContain("--max-num-seqs\n16");
    expect(param.value).toContain("--max-model-len\n8192");
    expect(param.value).toContain("--enforce-eager");
    expect(param).toHaveAttribute("rows", "8");
  });

  it("submits editable fields and navigates to app details", async () => {
    const user = userEvent.setup();
    render(<EditModelAppPage />);

    const name = await screen.findByLabelText("应用名称");
    await user.clear(name);
    await user.type(name, "Qwen updated");
    const modelCacheSize = screen.getByLabelText("模型缓存 PVC 容量 (Gi)");
    await user.clear(modelCacheSize);
    await user.type(modelCacheSize, "120");
    await user.click(screen.getByRole("button", { name: "保存并重启" }));

    await waitFor(() =>
      expect(mocks.appClient.updateModelApp).toHaveBeenCalledTimes(1),
    );
    const request = mocks.appClient.updateModelApp.mock.calls[0][0];
    expect(request).toMatchObject({
      appId: { name: "qwen25-15b" },
      name: "Qwen updated",
      image: "vllm",
      param: expect.stringContaining("--max-model-len\n8192"),
      resourceDefinition: {
        cpu: "4",
        memory: "16Gi",
        gpu: 1,
        gpuKey: "nvidia.com/gpu",
      },
      modelCacheSize: "120Gi",
    });
    expect(request).not.toHaveProperty("code");
    expect(request).not.toHaveProperty("codes");
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["apps", "aione", "aione", "development"],
    });
    expect(mocks.push).toHaveBeenCalledWith(
      "/domain/development/project/aione/apps/qwen25-15b",
    );
  });

  it("blocks shrinking the model-cache PVC before calling the API", async () => {
    const user = userEvent.setup();
    render(<EditModelAppPage />);

    const modelCacheSize =
      await screen.findByLabelText("模型缓存 PVC 容量 (Gi)");
    await user.clear(modelCacheSize);
    await user.type(modelCacheSize, "79");
    await user.click(screen.getByRole("button", { name: /保存/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "模型缓存 PVC 容量只能增大，不能变小",
    );
    expect(mocks.appClient.updateModelApp).not.toHaveBeenCalled();
  });

  it("disables model-cache PVC size edits when the StorageClass is not expandable", async () => {
    const config = modelConfig();
    config.modelCachePvc = {
      name: "qwen25-15b-aione-development-model-cache",
      storageClassName: "local-path",
      requestedSize: "80Gi",
      capacity: "80Gi",
      expandable: false,
    };
    mocks.appClient.getModelAppConfig.mockResolvedValue({ model: config });

    render(<EditModelAppPage />);

    expect(
      await screen.findByLabelText("模型缓存 PVC 容量 (Gi)"),
    ).toBeDisabled();
    expect(
      screen.getByText("当前 PVC 不支持在线扩容，需要迁移或重建"),
    ).toBeVisible();
  });

  it("shows a blocking error when config loading fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.appClient.getModelAppConfig.mockRejectedValue(
      new Error("not a VLLM app"),
    );
    render(<EditModelAppPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/加载模型应用配置失败/);
    expect(alert).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button", { name: "保存并重启" })).toBeDisabled();
    expect(mocks.appClient.updateModelApp).not.toHaveBeenCalled();
  });

  it("shows every redacted source and its own token status", async () => {
    mocks.appClient.getModelAppConfig.mockResolvedValue({
      model: modelConfig("qwen25-15b", [
        {
          id: "https://gitea.example/aione/model.git",
          branch: "main",
          path: "weights/model",
          tokenConfigured: true,
        },
        {
          id: "https://gitlab.example/aione/tokenizer.git",
          branch: "release",
          path: "assets/tokenizer",
          tokenConfigured: false,
        },
      ]),
    });

    render(<EditModelAppPage />);

    expect(
      await screen.findByDisplayValue("https://gitea.example/aione/model.git"),
    ).toHaveAttribute("readonly");
    expect(
      screen.getByDisplayValue("https://gitlab.example/aione/tokenizer.git"),
    ).toHaveAttribute("readonly");
    expect(screen.getAllByLabelText("访问令牌")).toHaveLength(2);
    expect(screen.getAllByLabelText("访问令牌")[0]).toHaveValue("已配置");
    expect(screen.getAllByLabelText("访问令牌")[1]).toHaveValue("未配置");
  });

  it("clears stale config when route params change and the new load fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejectSecondLoad: (error: Error) => void = () => undefined;
    const secondLoad = new Promise((_, reject) => {
      rejectSecondLoad = reject;
    });
    mocks.appClient.getModelAppConfig
      .mockResolvedValueOnce({ model: modelConfig() })
      .mockReturnValueOnce(secondLoad);

    const { rerender } = render(<EditModelAppPage />);
    expect(await screen.findByLabelText("应用 ID")).toHaveValue("qwen25-15b");

    mocks.params = {
      appId: "other-model",
      domain: "development",
      project: "aione",
    };
    rerender(<EditModelAppPage />);

    await act(async () => {
      rejectSecondLoad(new Error("not found"));
      await secondLoad.catch(() => undefined);
    });

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByRole("button", { name: "保存并重启" })).toBeDisabled();
    expect(screen.queryByDisplayValue("qwen25-15b")).not.toBeInTheDocument();
  });

  it("ignores a late response from the previous route", async () => {
    let resolveFirstLoad: (response: unknown) => void = () => undefined;
    const firstLoad = new Promise((resolve) => {
      resolveFirstLoad = resolve;
    });
    mocks.appClient.getModelAppConfig
      .mockReturnValueOnce(firstLoad)
      .mockRejectedValueOnce(new Error("not found"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { rerender } = render(<EditModelAppPage />);
    await waitFor(() =>
      expect(mocks.appClient.getModelAppConfig).toHaveBeenCalledTimes(1),
    );
    mocks.params = {
      appId: "other-model",
      domain: "development",
      project: "aione",
    };
    rerender(<EditModelAppPage />);
    expect(await screen.findByRole("alert")).toBeVisible();

    await act(async () => {
      resolveFirstLoad({ model: modelConfig() });
      await firstLoad;
    });

    expect(screen.getByRole("button", { name: "保存并重启" })).toBeDisabled();
    expect(screen.queryByDisplayValue("qwen25-15b")).not.toBeInTheDocument();
  });
});
