/**
 * © Copyright Union Systems Inc 2026. All rights reserved.
 */

import { getUiText } from "@/lib/uiText";
import { describe, expect, it } from "vitest";
import {
  useDefaultItems as getDefaultItems,
  useDefaultOrgItems as getDefaultOrgItems,
} from "./NavItemConfigs";

describe("default navigation items", () => {
  it("places training tasks directly after development instances", () => {
    expect(getDefaultItems().map((item) => item.displayText)).toEqual([
      getUiText("runs"),
      getUiText("developmentInstances"),
      getUiText("trainingTasks"),
      getUiText("datasets"),
      getUiText("codeRepositories"),
      getUiText("cloudStorage"),
      getUiText("triggers"),
      getUiText("tasks"),
      getUiText("apiKeys"),
      getUiText("apps"),
    ]);
  });

  it("uses one unified documentation widget for organization navigation", () => {
    expect(getDefaultOrgItems()).toEqual([
      expect.objectContaining({
        displayText: getUiText("documentation"),
        type: "widget",
      }),
    ]);
  });
});
