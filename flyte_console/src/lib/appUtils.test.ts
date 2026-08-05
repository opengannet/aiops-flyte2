import { Status_DeploymentStatus } from "@/gen/flyteidl2/app/app_definition_pb";
import { describe, expect, it } from "vitest";
import { getStatus } from "./appUtils";

describe("getStatus", () => {
  it("returns unspecified when app conditions are absent or empty", () => {
    expect(getStatus(undefined)).toBe(Status_DeploymentStatus.UNSPECIFIED);
    expect(getStatus([])).toBe(Status_DeploymentStatus.UNSPECIFIED);
  });
});
