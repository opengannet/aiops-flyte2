import { describe, expect, it } from "vitest";
import {
  buildCloudStorageDetailHref,
  formatBytes,
  formatNullablePercent,
  formatStatsSource,
} from "./utils";

describe("CloudStorage UI utils", () => {
  it("builds detail links with encoded storage ids", () => {
    expect(
      buildCloudStorageDetailHref("development", "aione", "stg/abc"),
    ).toBe("/domain/development/project/aione/cloud-storages/stg%2Fabc");
  });

  it("formats nullable byte and percent values for stats rows", () => {
    expect(formatBytes(1048576)).toBe("1.0 MiB");
    expect(formatBytes(null)).toBe("未知");
    expect(formatNullablePercent(0.05)).toBe("0.05%");
    expect(formatNullablePercent(null)).toBe("未知");
  });

  it("labels real-time, Hawk history, and unavailable stats sources", () => {
    expect(formatStatsSource("kubelet")).toBe("实时");
    expect(formatStatsSource("hawk_history")).toBe("Hawk 历史");
    expect(formatStatsSource("unavailable")).toBe("未知");
  });
});
