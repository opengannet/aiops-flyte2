import { describe, expect, it } from "vitest";

import {
  buildAioneModelContainerIdRegex,
  normalizeExternalModelAppName,
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
    ).toBe("^/k8s/flyte\\.prod/qwen\\+app-[^/-]+-[^/-]+/vllm$");
  });
});
