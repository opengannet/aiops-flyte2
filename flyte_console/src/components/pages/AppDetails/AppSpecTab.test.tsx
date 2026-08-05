/**
 * Copyright Union Systems Inc 2026. All rights reserved.
 */

import "@testing-library/jest-dom/vitest";
import { create } from "@bufbuild/protobuf";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppSchema } from "@/gen/flyteidl2/app/app_definition_pb";
import { K8sPodSchema } from "@/gen/flyteidl2/core/tasks_pb";
import { AppSpecTab } from "./AppSpecTab";

vi.mock("next/navigation", () => ({
  useParams: () => ({ domain: "development", project: "flytesnacks" }),
}));

describe("AppSpecTab model cloud storage", () => {
  afterEach(() => cleanup());

  it("shows cloud storage metadata and links its id to the existing detail page", () => {
    const app = create(AppSchema, {
      spec: {
        profile: { type: "VLLM" },
        appPayload: {
          case: "pod",
          value: create(K8sPodSchema, {
            primaryContainerName: "vllm",
            podSpec: {
              volumes: [
                {
                  name: "cloud-storage-0",
                  persistentVolumeClaim: { claimName: "cs-storage-a" },
                },
              ],
              containers: [
                {
                  name: "vllm",
                  volumeMounts: [
                    { name: "cloud-storage-0", mountPath: "/mnt/storage-a" },
                  ],
                },
              ],
            },
          }),
        },
      },
    });

    render(<AppSpecTab app={app} />);

    expect(screen.getByText("云存储")).toBeVisible();
    expect(screen.getByText("cs-storage-a")).toBeVisible();
    expect(screen.getByText("/mnt/storage-a")).toBeVisible();
    expect(screen.getByRole("link", { name: "storage-a" })).toHaveAttribute(
      "href",
      "/domain/development/project/flytesnacks/cloud-storages/storage-a",
    );
  });
});
