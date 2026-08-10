/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppSchema } from "@/gen/flyteidl2/app/app_definition_pb";
import { ListAppsTable } from "./ListAppsTable";

vi.mock("@/components/Tables", () => ({
  VirtualizedTable: ({
    data,
    getRowHref,
  }: {
    data: Array<{ name: { displayText: string } }>;
    getRowHref: (row: { name: { displayText: string } }) => string;
  }) => (
    <div>
      {data.map((row) => (
        <a href={getRowHref(row)} key={row.name.displayText}>
          {row.name.displayText}
        </a>
      ))}
    </div>
  ),
}));

describe("ListAppsTable", () => {
  it("links VLLM apps to their edit page and other apps to details", () => {
    const vllmApp = create(AppSchema, {
      metadata: {
        id: {
          domain: "development",
          project: "flytesnacks",
          name: "qwen25-15b",
        },
      },
      spec: {
        profile: {
          type: "VLLM",
          name: "Qwen2.5 1.5B Instruct",
        },
      },
    });
    const streamlitApp = create(AppSchema, {
      metadata: {
        id: {
          domain: "development",
          project: "flytesnacks",
          name: "dashboard",
        },
      },
      spec: { profile: { type: "STREAMLIT" } },
    });
    const legacyVllmApp = create(AppSchema, {
      metadata: {
        id: {
          domain: "development",
          project: "flytesnacks",
          name: "legacy-qwen",
        },
      },
      spec: { profile: { type: "vllm" } },
    });

    render(<ListAppsTable data={[vllmApp, streamlitApp, legacyVllmApp]} />);

    expect(
      screen.getByRole("link", { name: "Qwen2.5 1.5B Instruct" }),
    ).toHaveAttribute(
      "href",
      "/domain/development/project/flytesnacks/apps/qwen25-15b/edit",
    );
    expect(screen.getByRole("link", { name: "dashboard" })).toHaveAttribute(
      "href",
      "/domain/development/project/flytesnacks/apps/dashboard",
    );
    expect(screen.getByRole("link", { name: "legacy-qwen" })).toHaveAttribute(
      "href",
      "/domain/development/project/flytesnacks/apps/legacy-qwen/edit",
    );
  });
});
