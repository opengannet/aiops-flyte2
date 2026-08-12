/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { AIONE_API_DOCS_URL, FLYTE_DOCS_FLYTE2_URL } from "@/lib/constants";
import { cleanup, render, screen } from "@testing-library/react";
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
  });

  it("keeps both links available in thin mode", () => {
    render(<DocumentationCard size="thin" />);

    expectDocumentationLinks();
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
