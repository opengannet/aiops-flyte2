import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const listAioneInstanceRunsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/aione/external-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/aione/external-api")
  >("@/server/aione/external-api");
  return {
    ...actual,
    listAioneInstanceRuns: listAioneInstanceRunsMock,
  };
});

describe("aione runs route type contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("EXTERNAL_API_KEYS", "external-key");
    listAioneInstanceRunsMock.mockResolvedValue({ total: 0, runs: [] });
  });

  it("continues to support instance run history", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/v2/api/aione/instance/ins-1/runs", {
        headers: { authorization: "Bearer external-key" },
      }),
      { params: Promise.resolve({ type: "instance", id: "ins-1" }) },
    );

    expect(response.status).toBe(200);
    expect(listAioneInstanceRunsMock).toHaveBeenCalledWith("ins-1");
    await expect(response.json()).resolves.toEqual({
      status: 200,
      data: { total: 0, runs: [] },
    });
  });

  it.each(["task", "model"])(
    "continues to reject %s run history",
    async (type) => {
      const { GET } = await import("./route");
      const response = await GET(
        new NextRequest(`http://localhost/v2/api/aione/${type}/x/runs`, {
          headers: { authorization: "Bearer external-key" },
        }),
        { params: Promise.resolve({ type, id: "x" }) },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        status: 400,
        message: "runs is only supported for instance",
      });
      expect(listAioneInstanceRunsMock).not.toHaveBeenCalled();
    },
  );
});
