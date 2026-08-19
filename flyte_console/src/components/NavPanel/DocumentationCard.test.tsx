/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { AIONE_API_DOCS_URL, FLYTE_DOCS_FLYTE2_URL } from "@/lib/constants";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentationCard } from "./DocumentationCard";

afterEach(cleanup);

const expectDocumentationLinks = () => {
  const userDocsLink = screen.getByRole("link", { name: "用户文档" });
  const apiDocsLink = screen.getByRole("link", { name: "API文档" });

  expect(userDocsLink).toHaveAttribute("href", FLYTE_DOCS_FLYTE2_URL);
  expect(apiDocsLink).toHaveAttribute("href", AIONE_API_DOCS_URL);

  for (const link of [userDocsLink, apiDocsLink]) {
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
};

describe("DocumentationCard", () => {
  it("shows both documentation links in one card in wide mode", () => {
    render(<DocumentationCard size="wide" />);

    const card = screen.getByRole("group", { name: "文档" });
    expect(card).toContainElement(
      screen.getByRole("link", { name: "用户文档" }),
    );
    expect(card).toContainElement(
      screen.getByRole("link", { name: "API文档" }),
    );
    expectDocumentationLinks();

    for (const label of ["用户文档", "API文档"]) {
      const link = screen.getByRole("link", { name: label });
      const labelElement = within(link).getByText(label);

      expect(link.children).toHaveLength(2);
      expect(link.firstElementChild).toHaveClass(
        "size-6",
        "rounded-full",
        "bg-(--union)",
      );
      expect(link.firstElementChild?.querySelectorAll("svg")).toHaveLength(1);
      expect(link.lastElementChild).toBe(labelElement);
      expect(link.querySelectorAll("svg")).toHaveLength(1);
    }
  });

  it("keeps both links available in thin mode", () => {
    render(<DocumentationCard size="thin" />);

    expectDocumentationLinks();

    for (const label of ["用户文档", "API文档"]) {
      const link = screen.getByRole("link", { name: label });

      expect(link.children).toHaveLength(1);
      expect(link.firstElementChild).toHaveClass(
        "size-6",
        "rounded-full",
        "bg-(--union)",
      );
      expect(link.querySelectorAll("svg")).toHaveLength(1);
    }
  });

  it.each(["用户文档", "API文档"])(
    "labels the %s thin-mode icon with a tooltip",
    async (label) => {
      const user = userEvent.setup();
      render(<DocumentationCard size="thin" />);

      await user.hover(screen.getByRole("link", { name: label }));
      expect(await screen.findByRole("tooltip")).toHaveTextContent(label);
    },
  );
});
