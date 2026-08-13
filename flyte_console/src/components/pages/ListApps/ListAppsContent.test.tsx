/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListAppsContent } from "./ListAppsContent";

vi.mock("@codemirror/lang-python", () => ({ python: () => ({}) }));
vi.mock("@uiw/codemirror-theme-vscode", () => ({
  vscodeDark: {},
  vscodeLight: {},
}));
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value }: { value: string }) => <pre>{value}</pre>,
  EditorView: { lineWrapping: {} },
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ domain: "development", project: "flytesnacks" }),
}));
vi.mock("@/lib/windowUtils", () => ({
  flyteCliNeedsInsecure: () => true,
  getFlyteCliEndpointHost: () => "flyte.example.test",
  getLocation: () => ({ hostname: "flyte.example.test" }),
}));
vi.mock("./table/ListAppsTable", () => ({
  ListAppsTable: () => <div>应用表格</div>,
}));

const query = (overrides: Record<string, unknown> = {}) =>
  ({
    data: { apps: [] },
    isError: false,
    isLoading: false,
    ...overrides,
  }) as never;

describe("ListAppsContent", () => {
  afterEach(cleanup);

  it("shows the Apps empty state and onboarding help in Simplified Chinese", () => {
    render(<ListAppsContent listAppsQuery={query()} searchQuery="" />);

    expect(screen.getByText("暂无模型部署")).toBeInTheDocument();
    expect(
      screen.getByText(
        "应用让您能够构建和运行自己的 Web 应用，包括模型端点、AI 推理组件、交互式仪表板、连接器等。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "如何创建应用" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("如果本地没有 Flyte 配置，请先运行以下命令创建："),
    ).toBeInTheDocument();
    expect(
      screen.getByText("然后创建名为 app.py 的应用脚本："),
    ).toBeInTheDocument();
    expect(screen.getByText("然后运行应用：")).toBeInTheDocument();
    expect(
      screen.getByText(/# “App” 声明。[\s\S]*# 使用上面声明的 “ImageSpec”。/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /# 在此示例中，无需提供任何应用代码，[\s\S]*# 因为我们使用 Streamlit 内置的 “hello” 应用。/,
      ),
    ).toBeInTheDocument();
  });

  it("shows the Apps search-empty state in Simplified Chinese", () => {
    render(<ListAppsContent listAppsQuery={query()} searchQuery="qwen" />);

    expect(screen.getByText("未找到模型部署")).toBeInTheDocument();
    expect(screen.getByText("qwen").parentElement).toHaveTextContent(
      "未找到匹配 qwen 的模型部署",
    );
  });

  it("shows the Apps error state in Simplified Chinese", () => {
    render(
      <ListAppsContent
        listAppsQuery={query({ isError: true })}
        searchQuery=""
      />,
    );

    expect(screen.getByText("加载失败")).toBeInTheDocument();
    expect(screen.getByText("加载模型部署时遇到问题")).toBeInTheDocument();
  });
});
