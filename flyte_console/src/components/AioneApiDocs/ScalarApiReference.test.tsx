import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@scalar/api-reference-react", () => ({
  ApiReferenceReact: ({ configuration }: { configuration: Record<string, unknown> }) => (
    <div
      data-authentication={JSON.stringify(configuration.authentication)}
      data-testid="scalar-api-reference"
      data-url={String(configuration.url)}
    />
  ),
}));

import { aioneOpenApiUrl, ScalarApiReference } from "./ScalarApiReference";

describe("ScalarApiReference", () => {
  it("loads the bundled YAML contract and does not prefill credentials", () => {
    render(<ScalarApiReference />);

    const reference = screen.getByTestId("scalar-api-reference");
    expect(aioneOpenApiUrl).toBe("/v2/openapi/aione.yaml");
    expect(reference).toHaveAttribute("data-url", aioneOpenApiUrl);
    expect(reference.getAttribute("data-authentication")).toBe(
      JSON.stringify({ preferredSecurityScheme: ["bearerAuth", "apiKeyAuth"] }),
    );
  });
});
