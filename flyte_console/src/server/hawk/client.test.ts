import { afterEach, describe, expect, it, vi } from "vitest";

import {
  escapePrometheusLabelValue,
  queryHawkRange,
} from "@/server/hawk/client";

describe("Hawk Prometheus client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("escapes Prometheus label values", () => {
    expect(escapePrometheusLabelValue('pv-"a\\b"')).toBe(
      'pv-\\"a\\\\b\\"',
    );
  });

  it("queries Hawk with API-key authentication and an abort signal", async () => {
    vi.stubEnv("HAWK_API_URL", "https://hawk.example.test/");
    vi.stubEnv("HAWK_API_KEY", "secret-key");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        status: "success",
        data: { resultType: "matrix", result: [] },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await queryHawkRange({
      query: 'metric{volume="pv-a"}',
      start: 100,
      end: 200,
      step: 60,
      signal: controller.signal,
    });

    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.pathname).toBe("/api/v1/query_range");
    expect(url.searchParams.get("query")).toBe('metric{volume="pv-a"}');
    expect(url.searchParams.get("start")).toBe("100");
    expect(url.searchParams.get("end")).toBe("200");
    expect(url.searchParams.get("step")).toBe("60");
    expect(options).toMatchObject({
      headers: { "X-API-Key": "secret-key" },
      cache: "no-store",
      signal: controller.signal,
    });
  });
});
