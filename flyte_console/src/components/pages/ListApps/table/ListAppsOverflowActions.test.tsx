/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { cleanup, render, screen, within } from "@testing-library/react";
import { type ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppSchema,
  Status_DeploymentStatus,
} from "@/gen/flyteidl2/app/app_definition_pb";
import { ListAppsOverflowActions } from "./ListAppsOverflowActions";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  delete: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@/components/Popovers", () => ({
  PopoverMenu: ({
    items,
    triggerAriaLabel,
    triggerTooltip,
  }: {
    items: Array<Record<string, unknown>>;
    triggerAriaLabel?: string;
    triggerTooltip?: string;
  }) => (
    <div>
      <button aria-label={triggerAriaLabel} title={triggerTooltip} />
      {items
        .filter((item) => item.type !== "divider")
        .map((item) => (
          <button
            key={String(item.id)}
            disabled={item.disabled as boolean | undefined}
            onClick={item.onClick as () => void}
          >
            {String(item.label)}
          </button>
        ))}
    </div>
  ),
}));
vi.mock("@/hooks/useApps", () => ({
  useDeleteApp: () => ({ mutateAsync: mocks.delete, isPending: false }),
  useStartApp: () => ({ mutate: mocks.start }),
  useStopApp: () => ({ mutate: mocks.stop }),
}));
vi.mock("@/components/SimpleDialog", () => ({
  SimpleDialog: ({
    buttons,
    content,
    headerText,
    isOpen,
  }: {
    buttons: Array<{
      disabled?: boolean;
      displayText: string;
      onClick: () => void;
    }>;
    content: ReactNode;
    headerText: ReactNode;
    isOpen: boolean;
  }) =>
    isOpen ? (
      <div data-testid="delete-dialog">
        <h2>{headerText}</h2>
        {content}
        {buttons.map((button) => (
          <button
            key={button.displayText}
            disabled={button.disabled}
            onClick={button.onClick}
          >
            {button.displayText}
          </button>
        ))}
      </div>
    ) : null,
}));
vi.mock("@/lib/windowUtils", () => ({
  getLocation: () => ({
    pathname: "/v2/domain/development/project/aione/apps",
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

describe("ListAppsOverflowActions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });
  afterEach(cleanup);

  it("labels the overflow trigger as more actions", () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "qwen25-15b" } },
    });
    render(<ListAppsOverflowActions app={app} />);

    expect(screen.getByRole("button", { name: "更多操作" })).toHaveAttribute(
      "title",
      "更多操作",
    );
  });

  it("shows Edit for VLLM apps and navigates to the edit route", async () => {
    const app = create(AppSchema, {
      metadata: {
        id: {
          org: "aione",
          project: "aione",
          domain: "development",
          name: "qwen25-15b",
        },
      },
      spec: { profile: { type: "VLLM" } },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/domain/development/project/aione/apps/qwen25-15b/edit",
    );
  });

  it("shows Edit for lowercase vllm apps", () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "legacy-qwen" } },
      spec: { profile: { type: "vllm" } },
    });
    render(<ListAppsOverflowActions app={app} />);

    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
  });

  it("does not show Edit for non-VLLM apps", () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "streamlit-app" } },
      spec: { profile: { type: "STREAMLIT" } },
    });
    render(<ListAppsOverflowActions app={app} />);

    expect(
      screen.queryByRole("button", { name: "编辑" }),
    ).not.toBeInTheDocument();
  });

  it("navigates to the exact app details route", async () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "qwen25-15b" } },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "查看应用详情" }));

    expect(mocks.push).toHaveBeenCalledWith(
      "/domain/development/project/aione/apps/qwen25-15b",
    );
  });

  it("starts a stopped app without calling the stop mutation", async () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "stopped-app" } },
      status: {
        conditions: [{ deploymentStatus: Status_DeploymentStatus.STOPPED }],
      },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "启动应用" }));

    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("stops an active app without calling the start mutation", async () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "active-app" } },
      status: {
        conditions: [{ deploymentStatus: Status_DeploymentStatus.ACTIVE }],
      },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "停止应用" }));

    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("shows an enabled Delete action for a stopped app and asks for confirmation", async () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "stopped-app" } },
      status: {
        conditions: [{ deploymentStatus: Status_DeploymentStatus.STOPPED }],
      },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "删除" }));

    expect(screen.getByTestId("delete-dialog")).toHaveTextContent(
      "删除 stopped-app？",
    );
    expect(screen.getByTestId("delete-dialog")).toHaveTextContent(
      "删除后无法恢复",
    );
  });

  it("does not delete when the confirmation dialog is cancelled", async () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "failed-app" } },
      status: {
        conditions: [{ deploymentStatus: Status_DeploymentStatus.FAILED }],
      },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(mocks.delete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("delete-dialog")).not.toBeInTheDocument();
  });

  it("deletes an eligible app after confirmation", async () => {
    mocks.delete.mockResolvedValueOnce({});
    const app = create(AppSchema, {
      metadata: { id: { name: "failed-app" } },
      status: {
        conditions: [{ deploymentStatus: Status_DeploymentStatus.FAILED }],
      },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await userEvent.click(
      within(screen.getByTestId("delete-dialog")).getByRole("button", {
        name: "删除",
        exact: true,
      }),
    );

    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("delete-dialog")).not.toBeInTheDocument();
  });

  it("keeps Delete disabled for an active app with an explanation", () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "active-app" } },
      status: {
        conditions: [{ deploymentStatus: Status_DeploymentStatus.ACTIVE }],
      },
    });
    render(<ListAppsOverflowActions app={app} />);

    expect(
      screen.getByRole("button", { name: "删除（请先停止应用）" }),
    ).toBeDisabled();
  });

  it("keeps the dialog open and shows the deletion error", async () => {
    mocks.delete.mockRejectedValueOnce(new Error("app is not in a deletable state"));
    const app = create(AppSchema, {
      metadata: { id: { name: "stopped-app" } },
      status: {
        conditions: [{ deploymentStatus: Status_DeploymentStatus.STOPPED }],
      },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    await userEvent.click(
      within(screen.getByTestId("delete-dialog")).getByRole("button", {
        name: "删除",
        exact: true,
      }),
    );

    expect(screen.getByTestId("delete-dialog")).toHaveTextContent(
      "app is not in a deletable state",
    );
  });

  it("copies the exact app name and endpoint values", async () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "qwen25-15b" } },
      status: {
        ingress: { publicUrl: "https://apps.example.test/qwen25-15b" },
      },
    });
    render(<ListAppsOverflowActions app={app} />);

    await userEvent.click(screen.getByRole("button", { name: "复制应用名称" }));
    await userEvent.click(screen.getByRole("button", { name: "复制访问地址" }));

    expect(mocks.writeText).toHaveBeenNthCalledWith(1, "qwen25-15b");
    expect(mocks.writeText).toHaveBeenNthCalledWith(
      2,
      "https://apps.example.test/qwen25-15b",
    );
  });
});
