import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudStorageSchema } from "@/gen/flyteidl2/aione/cloudstorage/cloud_storage_definition_pb";
import { create } from "@bufbuild/protobuf";
import { CloudStorageListPage } from "./ListPage";

const mocks = vi.hoisted(() => ({
  deleteCloudStorage: vi.fn(),
  listCloudStorages: vi.fn(),
}));

vi.mock("@/components/Header", () => ({ Header: () => <div /> }));
vi.mock("@/components/NavPanel/NavPanelLayout", () => ({
  NavPanelLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/hooks/useConnectRpc", () => ({
  useConnectRpcClient: () => mocks,
}));
vi.mock("@/hooks/useOrg", () => ({ useOrg: () => "aione" }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ domain: "development", project: "aione" }),
}));

describe("CloudStorageListPage live mount status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listCloudStorages.mockResolvedValue({
      cloudStorages: [
        create(CloudStorageSchema, {
          id: { id: "stg-used" },
          name: "used-store",
          creator: "external-api",
        }),
        create(CloudStorageSchema, {
          id: { id: "stg-unused" },
          name: "unused-store",
          creator: "external-system",
        }),
      ],
    });
  });

  it("shows running Pod usage instead of the materialization namespace", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { mounts: { "stg-used": ["writer-pod"], "stg-unused": [] } },
        }),
    });
    vi.stubGlobal(
      "fetch",
      fetchMock,
    );

    render(<CloudStorageListPage />);

    expect(
      await screen.findByRole("columnheader", { name: "使用 Pod" }),
    ).toBeVisible();
    expect(screen.queryByText("挂载于")).not.toBeInTheDocument();
    expect(await screen.findByText("使用中")).toBeVisible();
    expect(screen.getByText("未使用")).toBeVisible();
    expect(screen.getByText("writer-pod")).toBeVisible();
    expect(screen.getByText("external-api")).toBeVisible();
    expect(screen.getByText("external-system")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/v2/api/cloud-storages/mounts",
      expect.any(Object),
    );
  });

  it("shows unknown instead of unused when the live query fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<CloudStorageListPage />);

    expect(await screen.findAllByText("未知")).toHaveLength(2);
  });
});
