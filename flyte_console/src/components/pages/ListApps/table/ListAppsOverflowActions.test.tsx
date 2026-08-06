/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppSchema } from "@/gen/flyteidl2/app/app_definition_pb";
import { ListAppsOverflowActions } from "./ListAppsOverflowActions";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@/components/Popovers", () => ({
  PopoverMenu: ({ items }: { items: Array<Record<string, unknown>> }) => (
    <div>
      {items
        .filter((item) => item.type !== "divider")
        .map((item) => (
          <button key={String(item.id)} onClick={item.onClick as () => void}>
            {String(item.label)}
          </button>
        ))}
    </div>
  ),
}));
vi.mock("@/hooks/useApps", () => ({
  useStartApp: () => ({ mutate: mocks.start }),
  useStopApp: () => ({ mutate: mocks.stop }),
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
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

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

  it("shows Simplified Chinese labels for app details and copying the endpoint", () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "qwen25-15b" } },
      status: { ingress: { publicUrl: "https://apps.example.test/qwen25-15b" } },
    });
    render(<ListAppsOverflowActions app={app} />);

    expect(
      screen.getByRole("button", { name: "查看应用详情" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制访问地址" }),
    ).toBeInTheDocument();
  });
});
