/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
      token: "",
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
    vi.restoreAllMocks();
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

    await user.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(mocks.createModelApp).toHaveBeenCalledTimes(1));
    expect(
      mocks.createModelApp.mock.calls[0][0].model.cloudStorageMounts,
    ).toEqual([
      expect.objectContaining({
        cloudStorageId: "storage-new",
        mountPath: "/mnt/storage-new",
      }),
    ]);
  });

  it("preserves a quickly created storage when the initial list resolves later", async () => {
    let resolveInitialList: (value: unknown) => void = () => undefined;
    const initialList = new Promise((resolve) => {
      resolveInitialList = resolve;
    });
    mocks.listCloudStorages.mockReturnValueOnce(initialList);
    const user = userEvent.setup();
    render(<CreateModelAppPage />);

    await waitFor(() =>
      expect(mocks.listCloudStorages).toHaveBeenCalledTimes(1),
    );
    await user.click(screen.getByRole("button", { name: "快速新建" }));
    await user.type(screen.getByLabelText("云存储名称"), "新模型盘");
    await user.click(screen.getByRole("button", { name: "新建并选择" }));
    await waitFor(() =>
      expect(mocks.createCloudStorage).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      resolveInitialList({
        cloudStorages: [
          create(CloudStorageSchema, {
            id: { id: "storage-old" },
            name: "旧列表存储",
            sizeGb: 10,
            storageClassName: "standard",
          }),
        ],
        token: "",
      });
      await initialList;
    });

    expect(await screen.findByText("旧列表存储")).toBeVisible();
    expect(screen.getByText("新模型盘")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /新模型盘/ })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(mocks.createModelApp).toHaveBeenCalledTimes(1));
    expect(
      mocks.createModelApp.mock.calls[0][0].model.cloudStorageMounts,
    ).toEqual([
      expect.objectContaining({
        cloudStorageId: "storage-new",
        mountPath: "/mnt/storage-new",
      }),
    ]);
  });

  it("loads every cloud storage page and allows selecting a later page", async () => {
    mocks.listCloudStorages.mockImplementation((request) => {
      const token = request.request?.token ?? "";
      return Promise.resolve(
        token === "page-2"
          ? {
              cloudStorages: [
                create(CloudStorageSchema, {
                  id: { id: "storage-b" },
                  name: "第二页存储",
                  sizeGb: 40,
                  storageClassName: "standard",
                }),
              ],
              token: "",
            }
          : {
              cloudStorages: [
                create(CloudStorageSchema, {
                  id: { id: "storage-a" },
                  name: "第一页存储",
                  sizeGb: 20,
                  storageClassName: "fast-ssd",
                }),
              ],
              token: "page-2",
            },
      );
    });
    const user = userEvent.setup();
    render(<CreateModelAppPage />);

    expect(await screen.findByText("第一页存储")).toBeVisible();
    expect(await screen.findByText("第二页存储")).toBeVisible();
    expect(mocks.listCloudStorages).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("checkbox", { name: /第二页存储/ }));
    expect(screen.getByDisplayValue("/mnt/storage-b")).toBeVisible();
  });

  it("stops pagination when the server repeats a token", async () => {
    mocks.listCloudStorages
      .mockResolvedValueOnce({
        cloudStorages: [],
        token: "repeat-token",
      })
      .mockResolvedValueOnce({
        cloudStorages: [],
        token: "repeat-token",
      });

    render(<CreateModelAppPage />);

    await waitFor(() =>
      expect(mocks.listCloudStorages).toHaveBeenCalledTimes(2),
    );
  });

  it("stops pagination after unmount while the current page is pending", async () => {
    let resolveFirstPage: (value: unknown) => void = () => undefined;
    const firstPage = new Promise((resolve) => {
      resolveFirstPage = resolve;
    });
    mocks.listCloudStorages
      .mockReturnValueOnce(firstPage)
      .mockResolvedValue({ cloudStorages: [], token: "" });

    const { unmount } = render(<CreateModelAppPage />);
    await waitFor(() =>
      expect(mocks.listCloudStorages).toHaveBeenCalledTimes(1),
    );
    unmount();

    await act(async () => {
      resolveFirstPage({ cloudStorages: [], token: "page-2" });
      await firstPage;
      await Promise.resolve();
    });

    expect(mocks.listCloudStorages).toHaveBeenCalledTimes(1);
  });

  it("does not call project RPCs or enable creation before org is ready", async () => {
    mocks.org = "";
    render(<CreateModelAppPage />);

    await waitFor(() => expect(mocks.listCloudStorages).not.toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "创建" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "快速新建" })).toBeDisabled();
  });

  it("uses Enter in quick creation without submitting the model form", async () => {
    const user = userEvent.setup();
    render(<CreateModelAppPage />);

    await screen.findByText("模型缓存");
    await user.click(screen.getByRole("button", { name: "快速新建" }));
    await user.type(screen.getByLabelText("云存储名称"), "Enter 创建{Enter}");

    await waitFor(() =>
      expect(mocks.createCloudStorage).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createModelApp).not.toHaveBeenCalled();
  });

  it("disables model submission while quick creation is pending", async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    mocks.createCloudStorage.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<CreateModelAppPage />);

    await screen.findByText("模型缓存");
    await user.click(screen.getByRole("button", { name: "快速新建" }));
    await user.type(screen.getByLabelText("云存储名称"), "等待创建");
    await user.click(screen.getByRole("button", { name: "新建并选择" }));

    expect(screen.getByRole("button", { name: "创建" })).toBeDisabled();
    resolveCreate({
      cloudStorage: create(CloudStorageSchema, {
        id: { id: "storage-pending" },
        name: "等待创建",
        sizeGb: 1,
      }),
    });
    expect(await screen.findByText("等待创建")).toBeVisible();
  });

  it("does not show an empty state when loading cloud storage fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.listCloudStorages.mockRejectedValue(new Error("unavailable"));

    render(<CreateModelAppPage />);

    expect(await screen.findByText("加载云存储失败")).toBeVisible();
    expect(screen.queryByText("暂无可用云存储")).not.toBeInTheDocument();
  });
});
