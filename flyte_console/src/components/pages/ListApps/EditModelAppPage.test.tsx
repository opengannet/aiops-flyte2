/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  useParams: () => ({
    appId: "qwen25-15b",
    domain: "development",
    project: "aione",
  }),
  useRouter: () => ({ push: mocks.push }),
}));

function modelConfig() {
  return create(ModelAppConfigSchema, {
    appId: {
      org: "aione",
      project: "aione",
      domain: "development",
      name: "qwen25-15b",
    },
    name: "Qwen2.5 1.5B Instruct",
    code: "qwen25-15b",
    image: "vllm",
    param:
      "--served-model-name\nqwen25-15b\n--max-num-seqs\n16\n--max-model-len\n8192\n--enforce-eager",
    codes: [
      {
        id: "http://gitea.ops.fzyun.io/aione/Qwen2.5-1.5B-Instruct.git",
        branch: "main",
        path: "/models/qwen25-15b",
        tokenConfigured: true,
      },
    ],
    resourceDefinition: {
      cpu: "4",
      memory: "16Gi",
      gpu: 1,
      gpuKey: "nvidia.com/gpu",
    },
  });
}

describe("EditModelAppPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.org = "aione";
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
    expect(screen.getByLabelText("应用 ID")).toBeDisabled();
    expect(screen.getByLabelText("模型代码")).toBeDisabled();
    expect(screen.getByLabelText("仓库地址")).toBeDisabled();
    expect(screen.getByLabelText("分支")).toBeDisabled();
    expect(screen.getByLabelText("目标路径")).toBeDisabled();
    expect(screen.getByLabelText("访问令牌")).toHaveValue("已配置");
    expect(screen.getByLabelText("访问令牌")).toBeDisabled();
    const param = screen.getByLabelText("启动参数") as HTMLTextAreaElement;
    expect(param.value).toContain("--max-num-seqs\n16");
    expect(param.value).toContain("--max-model-len\n8192");
    expect(param.value).toContain("--enforce-eager");
  });

  it("submits editable fields and navigates to app details", async () => {
    const user = userEvent.setup();
    render(<EditModelAppPage />);

    const name = await screen.findByLabelText("应用名称");
    await user.clear(name);
    await user.type(name, "Qwen updated");
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

  it("shows a blocking error when config loading fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.appClient.getModelAppConfig.mockRejectedValue(
      new Error("not a VLLM app"),
    );
    render(<EditModelAppPage />);

    expect(await screen.findByText(/加载模型应用配置失败/)).toBeVisible();
    expect(screen.getByRole("button", { name: "保存并重启" })).toBeDisabled();
    expect(mocks.appClient.updateModelApp).not.toHaveBeenCalled();
  });
});
