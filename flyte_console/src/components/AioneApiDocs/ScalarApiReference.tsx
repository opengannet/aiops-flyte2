"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import "./scalar-overrides.css";

export const aioneOpenApiUrl = "/v2/openapi/aione.yaml";

export function ScalarApiReference() {
  return (
    <ApiReferenceReact
      configuration={{
        url: aioneOpenApiUrl,
        theme: "purple",
        authentication: {
          preferredSecurityScheme: ["bearerAuth", "apiKeyAuth"],
        },
      }}
    />
  );
}
