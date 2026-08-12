"use client";

import { useEffect } from "react";

const swaggerUiBasePath = "/v2/swagger-ui";

function loadScript(source: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${source}`));
    document.head.appendChild(script);
  });
}

export function SwaggerUi() {
  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      await loadScript(`${swaggerUiBasePath}/swagger-ui-bundle.js`);
      await loadScript(`${swaggerUiBasePath}/swagger-ui-standalone-preset.js`);
      if (cancelled) {
        return;
      }
      window.SwaggerUIBundle({
        url: "/v2/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        persistAuthorization: true,
        presets: [
          window.SwaggerUIBundle.presets.apis,
          window.SwaggerUIStandalonePreset,
        ],
        layout: "StandaloneLayout",
      });
    };

    void initialize().catch((error: unknown) => {
      console.error("Failed to initialize Swagger UI", error);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <div id="swagger-ui" />;
}

declare global {
  interface Window {
    SwaggerUIBundle: {
      (options: Record<string, unknown>): void;
      presets: { apis: unknown };
    };
    SwaggerUIStandalonePreset: unknown;
  }
}
