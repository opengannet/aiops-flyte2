/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CreateModelAppPage } from "./CreateModelAppPage";

const mocks = vi.hoisted(() => {
  const createModelApp = vi.fn();
  const listCloudStorages = vi.fn();
  const createCloudStorage = vi.fn();
  return {
    appClient: { createModelApp },
    cloudStorageClient: { createCloudStorage, listCloudStorages },
    createModelApp,
    createCloudStorage,
    invalidateQueries: vi.fn(),
    listCloudStorages,
    org: "aione",
    push: vi.fn(),
  };
});

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
  useParams: () => ({ domain: "development", project: "flytesnacks" }),
  useRouter: () => ({ push: mocks.push }),
}));

describe("CreateModelAppPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.org = "aione";
    mocks.listCloudStorages.mockResolvedValue({
      cloudStorages: [],
      token: "",
    });
    mocks.createModelApp.mockResolvedValue({
      app: { metadata: { id: { name: "qwen-vllm" } } },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not expose cloud storage controls and submits without mounts", async () => {
    const user = userEvent.setup();
    render(<CreateModelAppPage />);
    expect(screen.getByLabelText("模型缓存 PVC 容量 (Gi)")).toHaveValue(80);

    expect(screen.getByRole("heading", { name: "创建模型应用" })).toBeVisible();
    expect(screen.getByText("模型信息")).toBeVisible();
    expect(screen.getByText("资源配置")).toBeVisible();
    expect(screen.getByText("模型来源")).toBeVisible();
    expect(screen.queryByText("云存储")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "管理云存储" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "快速新建" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("挂载路径")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(mocks.createModelApp).toHaveBeenCalledTimes(1));
    expect(mocks.listCloudStorages).not.toHaveBeenCalled();
    expect(mocks.createCloudStorage).not.toHaveBeenCalled();
    expect(mocks.createModelApp.mock.calls[0][0].model.modelCacheSize).toBe(
      "80Gi",
    );
    expect(
      mocks.createModelApp.mock.calls[0][0].model.cloudStorageMounts,
    ).toEqual([]);
  });

  it("keeps focus while typing a complete model repository URL", async () => {
    const user = userEvent.setup();
    render(<CreateModelAppPage />);

    const repositoryUrl = screen.getByLabelText("仓库地址");
    const value = "http://gitea.ops.fzyun.io/aione/Qwen2.5-1.5B-Instruct.git";
    await user.type(repositoryUrl, value);

    expect(repositoryUrl).toHaveValue(value);
  });

  it("does not call project RPCs or enable creation before org is ready", async () => {
    mocks.org = "";
    render(<CreateModelAppPage />);

    await waitFor(() => expect(mocks.listCloudStorages).not.toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "创建" })).toBeDisabled();
  });
});
