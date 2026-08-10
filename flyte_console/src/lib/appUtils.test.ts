import { create } from "@bufbuild/protobuf";
import {
  AppSchema,
  Status_DeploymentStatus,
} from "@/gen/flyteidl2/app/app_definition_pb";
import { describe, expect, it } from "vitest";
import { getLastDeployedData, getStatus } from "./appUtils";

describe("getStatus", () => {
  it("returns unspecified when app conditions are absent or empty", () => {
    expect(getStatus(undefined)).toBe(Status_DeploymentStatus.UNSPECIFIED);
    expect(getStatus([])).toBe(Status_DeploymentStatus.UNSPECIFIED);
  });
});

describe("getLastDeployedData", () => {
  it("falls back to the app creation time when the app is stopped", () => {
    const createdAt = { seconds: 1_700_000_000n, nanos: 0 };
    const app = create(AppSchema, {
      status: {
        createdAt,
        conditions: [
          { deploymentStatus: Status_DeploymentStatus.STOPPED },
        ],
      },
    });

    const result = getLastDeployedData(app);

    expect(result.deployedTimestamp).toMatchObject(createdAt);
    expect(result.relativeTime).not.toBe("-");
  });
});
