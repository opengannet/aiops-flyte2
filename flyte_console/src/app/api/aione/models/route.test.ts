/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listModelsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/aione/external-api", () => ({
  listAioneModelApps: listModelsMock,
}));

describe("aione model list route", () => {
  beforeEach(() => {
    process.env.EXTERNAL_API_KEYS = "valid-key";
    listModelsMock.mockReset();
    listModelsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });

  afterEach(() => {
    delete process.env.EXTERNAL_API_KEYS;
  });

  it.each([undefined, "wrong-key"])(
    "rejects a missing or incorrect API key",
    async (apiKey) => {
      const { GET } = await import("./route");
      const headers = apiKey ? { "X-API-Key": apiKey } : undefined;
      const response = await GET(
        new NextRequest(
          "http://localhost/v2/api/aione/models?project=aione&domain=development",
          { headers },
        ),
      );
      expect(response.status).toBe(401);
      expect(listModelsMock).not.toHaveBeenCalled();
    },
  );

  it("passes project, domain, filters, and pagination to the list service", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "http://localhost/v2/api/aione/models?project=aione&domain=development&p=2&page_size=10&keyword=qwen&status=ACTIVE",
        { headers: { "X-API-Key": "valid-key" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(listModelsMock).toHaveBeenCalledWith({
      project: "aione",
      domain: "development",
      page: 2,
      pageSize: 10,
      keyword: "qwen",
      status: "ACTIVE",
    });
  });
});
