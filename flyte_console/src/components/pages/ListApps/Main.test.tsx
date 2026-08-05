/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListAppsPage } from "./Main";

vi.mock("@/components/Button", () => ({
  Button: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/Header", () => ({ Header: () => <div /> }));
vi.mock("@/components/NavPanel/NavPanelLayout", () => ({
  NavPanelLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useApps", () => ({ useListApps: () => ({}) }));
vi.mock("@/hooks/useOrg", () => ({ useOrg: () => "flyte" }));
vi.mock("@/hooks/useQueryParamState", () => ({
  useSearchTerm: () => ({ searchTerm: "" }),
}));
vi.mock("@heroicons/react/20/solid", () => ({ PlusIcon: () => <svg /> }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ domain: "development", project: "flytesnacks" }),
}));
vi.mock("./ListAppsContent", () => ({ ListAppsContent: () => <div /> }));
vi.mock("./components", () => ({ ListAppsSearch: () => <div /> }));

describe("ListAppsPage", () => {
  afterEach(cleanup);

  it("shows a Simplified Chinese entry for creating a model app", () => {
    render(<ListAppsPage />);

    expect(
      screen.getByRole("link", { name: "创建模型应用" }),
    ).toHaveAttribute(
      "href",
      "/v2/domain/development/project/flytesnacks/apps/create",
    );
  });
});
