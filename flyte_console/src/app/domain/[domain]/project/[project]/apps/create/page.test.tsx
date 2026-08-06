/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { describe, expect, it } from "vitest";

import { metadata } from "./page";

describe("CreateModelApp route", () => {
  it("uses Simplified Chinese metadata", () => {
    expect(metadata.title).toBe("创建模型应用");
  });
});
