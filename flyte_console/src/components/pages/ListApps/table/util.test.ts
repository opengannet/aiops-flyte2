/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AppSchema } from "@/gen/flyteidl2/app/app_definition_pb";
import { formatAppForTable } from "./util";

describe("formatAppForTable", () => {
  it("uses the profile's friendly name while preserving the deployment ID", () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "model-a3ch31cd996ijy24lb8p3e7j" } },
      spec: { profile: { name: "Qwen2.5 1.5B Instruct" } },
    });

    expect(formatAppForTable(app).name.displayText).toBe(
      "Qwen2.5 1.5B Instruct",
    );
  });

  it("falls back to the deployment ID when no friendly name is available", () => {
    const app = create(AppSchema, {
      metadata: { id: { name: "qwen25-15b" } },
    });

    expect(formatAppForTable(app).name.displayText).toBe("qwen25-15b");
  });
});
