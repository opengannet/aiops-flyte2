/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CloudStorageSchema } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import { CreateModelAppPage } from "./CreateModelAppPage";

const mocks = vi.hoisted(() => {
  const createCloudStorage = vi.fn();
  const createModelApp = vi.fn();
  const listCloudStorages = vi.fn();
  return {
    appClient: { createModelApp },
    cloudStorageClient: { createCloudStorage, listCloudStorages },
    createCloudStorage,
    createModelApp,
    invalidateQueries: vi.fn(),
    listCloudStorages,
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
vi.mock("@/hooks/useOrg", () => ({ useOrg: () => "aione" }));
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
    mocks.listCloudStorages.mockResolvedValue({
      cloudStorages: [
        create(CloudStorageSchema, {
          id: { id: "storage-a" },
          name: "模型缓存",
          description: "共享模型权重",
          sizeGb: 20,
          storageClassName: "fast-ssd",
          targetNamespace: "flyte",
          pvcName: "cs-storage-a",
          creator: "tester",
        }),
      ],
    });
    mocks.createModelApp.mockResolvedValue({
      app: { metadata: { id: { name: "qwen-vllm" } } },
    });
    mocks.createCloudStorage.mockResolvedValue({
      cloudStorage: create(CloudStorageSchema, {
        id: { id: "storage-new" },
        name: "新模型盘",
        description: "快速创建",
        sizeGb: 50,
        storageClassName: "",
        targetNamespace: "flyte",
        pvcName: "cs-storage-new",
        creator: "tester",
      }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("uses Chinese labels and submits a selected existing cloud storage", async () => {
    const user = userEvent.setup();
    render(<CreateModelAppPage />);

    expect(screen.getByRole("heading", { name: "创建模型应用" })).toBeVisible();
    expect(screen.getByText("模型信息")).toBeVisible();
    expect(screen.getByText("资源配置")).toBeVisible();
    expect(screen.getByText("模型来源")).toBeVisible();
    expect(screen.getByLabelText("应用名称")).toBeVisible();
    expect(screen.getByLabelText("应用 ID")).toBeVisible();
    expect(screen.getByLabelText("GPU 资源键")).toBeVisible();
    expect(screen.getByRole("button", { name: "创建" })).toBeVisible();

    expect(await screen.findByText("模型缓存")).toBeVisible();
    expect(screen.getByText("storage-a")).toBeVisible();
    expect(screen.getByText("20 GB")).toBeVisible();
    expect(screen.getByText("fast-ssd")).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: /模型缓存/ }));
    expect(screen.getByDisplayValue("/mnt/storage-a")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(mocks.createModelApp).toHaveBeenCalledTimes(1));
    expect(
      mocks.createModelApp.mock.calls[0][0].model.cloudStorageMounts,
    ).toEqual([
      expect.objectContaining({
        cloudStorageId: "storage-a",
        mountPath: "/mnt/storage-a",
      }),
    ]);
  });

  it("automatically selects cloud storage created from the quick form", async () => {
    const user = userEvent.setup();
    render(<CreateModelAppPage />);

    await screen.findByText("模型缓存");
    await user.click(screen.getByRole("button", { name: "快速新建" }));
    await user.type(screen.getByLabelText("云存储名称"), "新模型盘");
    await user.type(screen.getByLabelText("云存储描述"), "快速创建");
    await user.clear(screen.getByLabelText("容量（GB）"));
    await user.type(screen.getByLabelText("容量（GB）"), "50");
    await user.click(screen.getByRole("button", { name: "新建并选择" }));

    await waitFor(() =>
      expect(mocks.createCloudStorage).toHaveBeenCalledTimes(1),
    );
    expect(
      mocks.createCloudStorage.mock.calls[0][0].cloudStorage,
    ).toMatchObject({
      name: "新模型盘",
      description: "快速创建",
      sizeGb: 50,
      storageClassName: "",
    });
    expect(await screen.findByDisplayValue("/mnt/storage-new")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /新模型盘/ })).toBeChecked();
  });
});
