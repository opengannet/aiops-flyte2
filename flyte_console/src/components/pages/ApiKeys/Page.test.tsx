import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeysPage } from "./Page";

vi.mock("@/components/Header", () => ({ Header: () => <div /> }));
vi.mock("@/components/NavPanel/NavPanelLayout", () => ({
  NavPanelLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("ApiKeysPage", () => {
  afterEach(() => cleanup());

  it("links to aione-api instead of creating model keys in Flyte", () => {
    render(<ApiKeysPage publicURL="https://gateway.example.test/" />);

    expect(
      screen.getByRole("link", {
        name: "Open publication and API key management",
      }),
    ).toHaveAttribute(
      "href",
      "https://gateway.example.test/models/deployments",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a configuration error when no public URL is configured", () => {
    render(<ApiKeysPage publicURL="" />);

    expect(
      screen.getByText("AIONE_PUBLIC_URL is not configured."),
    ).toBeVisible();
  });
});
