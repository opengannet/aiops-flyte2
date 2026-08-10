/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { baseColumns } from "./listAppsColumns";

describe("baseColumns", () => {
  it("labels the app timestamp column as creation time", () => {
    const creationTimeColumn = baseColumns.find(
      (column) =>
        "accessorKey" in column && column.accessorKey === "lastDeployed",
    );

    if (!creationTimeColumn || typeof creationTimeColumn.header !== "function") {
      throw new Error("Expected a creation-time column header");
    }

    render(creationTimeColumn.header({} as never));

    expect(screen.getByText("创建时间")).toBeInTheDocument();
  });

  it("renders only the display name in the name cell", () => {
    const nameColumn = baseColumns.find(
      (column) => "accessorKey" in column && column.accessorKey === "name",
    );

    if (!nameColumn || typeof nameColumn.cell !== "function") {
      throw new Error("Expected a name column with a cell renderer");
    }

    render(
      nameColumn.cell({
        getValue: () => ({
          displayText: "qwen25-15b",
          endpoint: "https://model.example",
        }),
      } as never),
    );

    expect(screen.getByText("qwen25-15b")).toBeInTheDocument();
    expect(screen.queryByText("https://model.example")).not.toBeInTheDocument();
    expect(screen.queryByText(/Endpoint:/)).not.toBeInTheDocument();
  });
});
