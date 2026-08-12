import { describe, expect, it } from "vitest";
import type { App } from "@/gen/flyteidl2/app/app_definition_pb";

import {
  buildAioneModelContainerIdRegex,
  externalModelIdentifier,
  normalizeExternalModelAppName,
  selectAioneModelApps,
} from "@/server/aione/external-api";

describe("AIONE external model identifiers", () => {
  it("uses the CreateModelApp DNS normalization rules", () => {
    expect(normalizeExternalModelAppName("  Qwen__2.5 / Coder  ")).toBe(
      "qwen-2-5-coder",
    );
  });

  it("uses a stable hash suffix when the normalized id exceeds 30 chars", () => {
    expect(
      normalizeExternalModelAppName(
        "This Is A Very Long Model Identifier That Exceeds Thirty Characters",
      ),
    ).toBe("this-is-a-very-long-m-b55ee51c");
  });

  it.each(["", "   ", "___///..."])(
    "rejects an empty normalized model id (%j)",
    (id) => {
      expect(() => normalizeExternalModelAppName(id)).toThrow();
    },
  );

  it("escapes Kubernetes target components in the container regex", () => {
    expect(
      buildAioneModelContainerIdRegex({
        namespace: "flyte.prod",
        serviceName: "qwen+app",
      }),
    ).toBe("^/k8s/flyte\\.prod/qwen\\+app-[^/-]+(-[^/-]+)?/vllm$");
  });

  it("matches both standard and truncated Kubernetes Pod suffixes", () => {
    const containerPattern = new RegExp(
      buildAioneModelContainerIdRegex({
        namespace: "flyte",
        serviceName: "mod-a3ch31cd996ij1y24lb8p3e7j7-aione-development",
      }),
    );

    expect(
      containerPattern.test(
        "/k8s/flyte/mod-a3ch31cd996ij1y24lb8p3e7j7-aione-development-75c977664l-xj52/vllm",
      ),
    ).toBe(true);
    expect(
      containerPattern.test(
        "/k8s/flyte/mod-a3ch31cd996ij1y24lb8p3e7j7-aione-development-75c977664lxj52/vllm",
      ),
    ).toBe(true);
  });
});

describe("AIONE external model listing", () => {
  const app = ({
    id,
    name = id,
    code = id,
    status = 7,
    created = 1,
    type = "VLLM",
  }: {
    id: string;
    name?: string;
    code?: string;
    status?: number;
    created?: number;
    type?: string;
  }) =>
    ({
      metadata: {
        id: { org: "aione", project: "aione", domain: "development", name: id },
      },
      spec: {
        profile: { type },
        inputs: {
          items: [
            { name: "name", value: { case: "stringValue", value: name } },
            { name: "code", value: { case: "stringValue", value: code } },
            { name: "image", value: { case: "stringValue", value: "vllm" } },
          ],
        },
      },
      status: {
        createdAt: { seconds: BigInt(created), nanos: 0 },
        conditions: [{ deploymentStatus: status }],
      },
    }) as unknown as App;

  const select = (
    apps: App[],
    options: {
      keyword?: string;
      status?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    selectAioneModelApps(apps, {
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 20,
      keyword: options.keyword,
      status: options.status,
    });

  it("filters non-VLLM apps and searches name, id, and model code", () => {
    const apps = [
      app({ id: "model-id", name: "Friendly Name", code: "qwen-coder" }),
      app({ id: "other-id", name: "Other", code: "deepseek" }),
      app({ id: "web-app", type: "WEB_APP" }),
    ];

    expect(select(apps).items.map((item) => item.id)).toEqual([
      "model-id",
      "other-id",
    ]);
    expect(select(apps, { keyword: "friendly" }).items[0]?.id).toBe("model-id");
    expect(select(apps, { keyword: "model-id" }).items[0]?.id).toBe("model-id");
    expect(select(apps, { keyword: "coder" }).items[0]?.id).toBe("model-id");
  });

  it("keeps same-name applications isolated by organization, project, and domain", () => {
    const previousOrg = process.env.EXTERNAL_API_FLYTE_ORG;
    process.env.EXTERNAL_API_FLYTE_ORG = "tenant-org";
    const development = externalModelIdentifier({
      id: "shared-model",
      project: "aione",
      domain: "development",
    });
    const production = externalModelIdentifier({
      id: "shared-model",
      project: "aione",
      domain: "production",
    });
    if (previousOrg === undefined) {
      delete process.env.EXTERNAL_API_FLYTE_ORG;
    } else {
      process.env.EXTERNAL_API_FLYTE_ORG = previousOrg;
    }

    expect(development).toMatchObject({
      org: "tenant-org",
      project: "aione",
      domain: "development",
      name: "shared-model",
    });
    expect(production).toMatchObject({
      org: "tenant-org",
      project: "aione",
      domain: "production",
      name: "shared-model",
    });
    expect(development).not.toEqual(production);
  });

  it("filters deployment status by enum name, prefixed name, and numeric value", () => {
    const apps = [
      app({ id: "active", status: 7 }),
      app({ id: "stopped", status: 4 }),
    ];

    expect(
      select(apps, { status: "ACTIVE" }).items.map((item) => item.id),
    ).toEqual(["active"]);
    expect(
      select(apps, { status: "DEPLOYMENT_STATUS_STOPPED" }).items.map(
        (item) => item.id,
      ),
    ).toEqual(["stopped"]);
    expect(select(apps, { status: "4" }).items.map((item) => item.id)).toEqual([
      "stopped",
    ]);
    expect(() => select(apps, { status: "UNKNOWN_STATUS" })).toThrow(
      "status is invalid",
    );
  });

  it("sorts by creation time before computing total and slicing pages", () => {
    const apps = [
      app({ id: "oldest", created: 100 }),
      app({ id: "newest", created: 300 }),
      app({ id: "middle", created: 200 }),
    ];

    const first = select(apps, { page: 1, pageSize: 2 });
    expect(first.total).toBe(3);
    expect(first.items.map((item) => item.id)).toEqual(["newest", "middle"]);
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(2);
    expect(
      select(apps, { page: 2, pageSize: 2 }).items.map((item) => item.id),
    ).toEqual(["oldest"]);
  });
});
