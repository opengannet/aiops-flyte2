import { describe, expect, it, vi } from "vitest";

import {
  getHawkPvcHistoryDays,
  loadHawkPvcHistory,
  type HawkPvcHistoryQuery,
} from "@/server/cloud-storage/hawk-history";

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

function matrix(
  volume: string,
  sizeValues: Array<[number, string]>,
  usedValues: Array<[number, string]>,
) {
  return {
    resultType: "matrix",
    result: [
      {
        metric: {
          __name__: "container_resources_disk_size_bytes",
          volume,
          container_id: "container-a",
        },
        values: sizeValues,
      },
      {
        metric: {
          __name__: "container_resources_disk_used_bytes",
          volume,
          container_id: "container-a",
        },
        values: usedValues,
      },
    ],
  };
}

describe("Hawk PVC history", () => {
  it("returns the newest complete sample without querying older windows", async () => {
    const queryRange = vi.fn<HawkPvcHistoryQuery>(async () =>
      matrix(
        "pv-a",
        [
          [NOW - 120, "1000"],
          [NOW - 60, "1100"],
        ],
        [
          [NOW - 120, "200"],
          [NOW - 60, "275"],
        ],
      ),
    );

    const result = await loadHawkPvcHistory({
      volumeName: "pv-a",
      nowSeconds: NOW,
      historyDays: 30,
      queryRange,
    });

    expect(result).toEqual({
      filesystemCapacityBytes: 1100,
      usedBytes: 275,
      availableBytes: 825,
      usagePercent: 25,
      statsTime: new Date((NOW - 60) * 1000).toISOString(),
    });
    expect(queryRange).toHaveBeenCalledTimes(1);
    expect(queryRange.mock.calls[0][0]).toMatchObject({
      query:
        '{__name__=~"container_resources_disk_(size|used)_bytes",volume="pv-a"}',
      start: NOW - 7 * DAY,
      end: NOW,
      step: 60,
    });
  });

  it("queries seven-day windows newest-first with a sixty-second overlap", async () => {
    const queryRange = vi
      .fn<HawkPvcHistoryQuery>()
      .mockResolvedValueOnce({ resultType: "matrix", result: [] })
      .mockResolvedValueOnce(
        matrix(
          "pv-a",
          [[NOW - 8 * DAY, "1000"]],
          [[NOW - 8 * DAY, "250"]],
        ),
      );

    const result = await loadHawkPvcHistory({
      volumeName: "pv-a",
      nowSeconds: NOW,
      historyDays: 30,
      queryRange,
    });

    expect(result?.usedBytes).toBe(250);
    expect(queryRange).toHaveBeenCalledTimes(2);
    expect(queryRange.mock.calls[1][0]).toMatchObject({
      start: NOW - 14 * DAY,
      end: NOW - 7 * DAY + 60,
      step: 60,
    });
  });

  it("covers thirty days with four seven-day windows and one final two-day window", async () => {
    const queryRange = vi.fn<HawkPvcHistoryQuery>(async () => ({
      resultType: "matrix",
      result: [],
    }));

    await loadHawkPvcHistory({
      volumeName: "pv-a",
      nowSeconds: NOW,
      historyDays: 30,
      queryRange,
    });

    expect(queryRange).toHaveBeenCalledTimes(5);
    expect(queryRange.mock.calls[4][0]).toMatchObject({
      start: NOW - 30 * DAY,
      end: NOW - 28 * DAY + 60,
      step: 60,
    });
  });

  it("uses the maximum value for duplicate series at the newest timestamp", async () => {
    const queryRange = vi.fn<HawkPvcHistoryQuery>(async () => ({
      resultType: "matrix",
      result: [
        ...matrix(
          "pv-a",
          [[NOW - 60, "1000"]],
          [[NOW - 60, "200"]],
        ).result!,
        ...matrix(
          "pv-a",
          [[NOW - 60, "1000"]],
          [[NOW - 60, "300"]],
        ).result!,
      ],
    }));

    const result = await loadHawkPvcHistory({
      volumeName: "pv-a",
      nowSeconds: NOW,
      queryRange,
    });

    expect(result).toMatchObject({
      filesystemCapacityBytes: 1000,
      usedBytes: 300,
      availableBytes: 700,
      usagePercent: 30,
    });
  });

  it("rejects samples for another PV and samples observed too far apart", async () => {
    const queryRange = vi.fn<HawkPvcHistoryQuery>(async () => ({
      resultType: "matrix",
      result: [
        ...matrix(
          "pv-other",
          [[NOW - 60, "2000"]],
          [[NOW - 60, "500"]],
        ).result!,
        ...matrix(
          "pv-a",
          [[NOW - 60, "1000"]],
          [[NOW - 240, "250"]],
        ).result!,
      ],
    }));

    const result = await loadHawkPvcHistory({
      volumeName: "pv-a",
      nowSeconds: NOW,
      historyDays: 1,
      queryRange,
    });

    expect(result).toBeNull();
  });

  it("escapes the PV name and never queries by PVC name", async () => {
    const queryRange = vi.fn<HawkPvcHistoryQuery>(async () => ({
      resultType: "matrix",
      result: [],
    }));

    await loadHawkPvcHistory({
      volumeName: 'pv-"a\\b"',
      nowSeconds: NOW,
      historyDays: 1,
      queryRange,
    });

    expect(queryRange.mock.calls[0][0].query).toBe(
      '{__name__=~"container_resources_disk_(size|used)_bytes",volume="pv-\\"a\\\\b\\""}',
    );
  });

  it("defaults invalid history-day configuration to thirty days", () => {
    expect(getHawkPvcHistoryDays(undefined)).toBe(30);
    expect(getHawkPvcHistoryDays("0")).toBe(30);
    expect(getHawkPvcHistoryDays("91")).toBe(30);
    expect(getHawkPvcHistoryDays("30.5")).toBe(30);
    expect(getHawkPvcHistoryDays("45")).toBe(45);
  });

  it("aborts all remaining windows when the per-PVC deadline expires", async () => {
    vi.useFakeTimers();
    try {
      const queryRange = vi.fn<HawkPvcHistoryQuery>(
        ({ signal }) =>
          new Promise((_, reject) => {
            signal?.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      );

      const pending = loadHawkPvcHistory({
        volumeName: "pv-a",
        nowSeconds: NOW,
        timeoutMs: 10,
        queryRange,
      });
      const rejection = expect(pending).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(10);
      await rejection;

      expect(queryRange).toHaveBeenCalledTimes(1);
      expect(queryRange.mock.calls[0][0].signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
