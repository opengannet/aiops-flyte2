import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
  DEFAULT_NODE_PORT_RANGE,
  DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES,
  DEVELOPMENT_INSTANCE_RESOURCE_SPECS,
  DELETED_DEVELOPMENT_INSTANCE_REASON,
  buildCreateDevelopmentInstanceRequest,
  buildDevelopmentInstanceRunName,
  buildGeneratedDevelopmentInstanceSourceId,
  buildRunIdentifier,
  formatDevelopmentInstance,
  getNextDevelopmentInstanceRunGeneration,
  getNextNodePort,
  isTerminalPhase,
} from "./utils";
import { ActionPhase } from "@/gen/flyteidl2/common/phase_pb";
import { create } from "@bufbuild/protobuf";
import {
  AbortInfoSchema,
  ActionDetailsSchema,
  ActionMetadataSchema,
  ActionSchema,
  RunSchema,
} from "@/gen/flyteidl2/workflow/run_definition_pb";
import {
  RunIdentifierSchema,
  UserIdentifierSchema,
} from "@/gen/flyteidl2/common/identifier_pb";
import { TaskTemplateSchema } from "@/gen/flyteidl2/core/tasks_pb";
import {
  EnrichedIdentitySchema,
  UserSchema,
  UserSpecSchema,
} from "@/gen/flyteidl2/common/identity_pb";

describe("development instance helpers", () => {
  it("offers resource specs without workspace capacity", () => {
    expect(DEVELOPMENT_INSTANCE_RESOURCE_SPECS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cpu: "1",
          memory: "2Gi",
          gpuCount: 0,
          label: "1vCPU, 2GiB RAM",
        }),
        expect.objectContaining({
          cpu: "1",
          memory: "2Gi",
          gpuCount: 1,
          gpuModel: "NVIDIA T4",
          label: "1vCPU, 2GiB RAM, 1*NVIDIA T4",
        }),
      ]),
    );
    expect(
      DEVELOPMENT_INSTANCE_RESOURCE_SPECS.some((spec) =>
        spec.label.includes("工作区"),
      ),
    ).toBe(false);
  });

  it("allocates the first unused default NodePort", () => {
    expect(getNextNodePort([31000, 31001], DEFAULT_NODE_PORT_RANGE)).toBe(
      31002,
    );
  });

  it("wraps NodePort allocation when the lower range has gaps", () => {
    expect(getNextNodePort([31000, 31002], DEFAULT_NODE_PORT_RANGE)).toBe(
      31001,
    );
  });

  it("throws when the NodePort range is exhausted", () => {
    expect(() =>
      getNextNodePort([31000, 31001], { min: 31000, max: 31001 }),
    ).toThrow("No available NodePort");
  });

  it("builds an ssh_workspace CreateRun request and preserves custom fields", () => {
    const request = buildCreateDevelopmentInstanceRequest({
      org: "testorg",
      project: "flytesnacks",
      domain: "development",
      name: "devbox-a",
      description: "for notebooks",
      owner: "ljgong",
      imageType: "custom",
      officialImageId: DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
      image: "ubuntu:22.04",
      enableSsh: true,
      sshUser: "dev",
      authorizedKey: "ssh-rsa AAAA user@example",
      cpu: "2",
      memory: "4Gi",
      gpuCount: 1,
      gpuModel: "NVIDIA T4",
      nodePort: 31022,
      maxHours: 24,
      cloudStorageMounts: [
        {
          cloudStorageId: "cs-1",
          pvcName: "cs-cs-1",
          storageClass: "bj1-ebs",
          size: "100Gi",
          mountPath: "/mnt/storage",
        },
      ],
      codeRepositories: [
        {
          id: "repo-1",
          repoUrl: "https://git.fzyun.io/serverless/aione.git",
          branch: "main",
          mountPath: "/home/flytekit/aione",
          token: "",
        },
      ],
    });

    expect(request.id.case).toBe("runId");
    expect(request.task.case).toBe("taskSpec");
    expect(request.inputWrapper.case).toBe("inputs");
    if (request.task.case !== "taskSpec") {
      throw new Error("expected task spec");
    }
    expect(request.task.value.taskTemplate?.type).toBe("ssh_workspace");
    expect(request.task.value.taskTemplate?.custom).toMatchObject({
      image: "ubuntu:22.04",
      sshUser: "dev",
      authorizedKeys: ["ssh-rsa AAAA user@example"],
      cpu: "2",
      memory: "4Gi",
      gpuCount: 1,
      gpuModel: "NVIDIA T4",
      serviceType: "NodePort",
      nodePort: 31022,
      codeServerHost: "devbox-a-code.ops.fzyun.io",
      codeServerUrl: "https://devbox-a-code.ops.fzyun.io",
      codeServerWorkspaceUrl: "https://devbox-a-code.ops.fzyun.io",
      description: "for notebooks",
      owner: "ljgong",
      maxHours: 24,
      cloudStorageMounts: [
        {
          id: "cs-1",
          pvcName: "cs-cs-1",
          storageClass: "bj1-ebs",
          size: "100Gi",
          mountPath: "/mnt/storage",
        },
      ],
      codeRepositories: [
        {
          id: "repo-1",
          repoUrl: "https://git.fzyun.io/serverless/aione.git",
          branch: "main",
          mountPath: "/home/flytekit/aione",
          token: "",
        },
      ],
    });
    expect(request.task.value.taskTemplate?.custom).not.toHaveProperty(
      "workspaceSize",
    );
    expect(request.task.value.taskTemplate?.custom).not.toHaveProperty(
      "workspacePVCName",
    );
    expect(request.task.value.taskTemplate?.metadata?.timeout?.seconds).toBe(
      86400n,
    );
  });

  it("stores Chinese display names separately from ASCII run names", () => {
    const sourceInstanceId =
      buildGeneratedDevelopmentInstanceSourceId("4a458z341d7k5o");
    const runName = buildDevelopmentInstanceRunName(sourceInstanceId, 1);

    const request = buildCreateDevelopmentInstanceRequest({
      org: "testorg",
      project: "flytesnacks",
      domain: "development",
      name: runName,
      sourceName: "中文实例",
      sourceInstanceId,
      description: "用于调试",
      owner: "ljgong",
      imageType: "official",
      officialImageId: DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
      image: "",
      enableSsh: false,
      sshUser: "dev",
      authorizedKey: "ssh-rsa AAAA user@example",
      cpu: "2",
      memory: "4Gi",
      gpuCount: 0,
      nodePort: 31022,
      maxHours: 24,
    });

    expect(sourceInstanceId).toMatch(/^ins-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(sourceInstanceId).toHaveLength(27);
    expect(runName).toMatch(/^ins-[a-z0-9]+-[a-f0-9]{8}-r1$/);
    expect(runName.length).toBeLessThanOrEqual(30);
    expect(request.id.case).toBe("runId");
    if (request.id.case !== "runId" || request.task.case !== "taskSpec") {
      throw new Error("expected run id and task spec");
    }
    expect(request.id.value.name).toBe(runName);
    expect(request.task.value.taskTemplate?.custom).toMatchObject({
      sourceName: "中文实例",
      sourceInstanceId,
      description: "用于调试",
    });
    expect(request.task.value.taskTemplate?.custom).not.toHaveProperty(
      "workspacePVCName",
    );
  });

  it("uses the official IDE image by default", () => {
    const defaultOfficialImage = DEVELOPMENT_INSTANCE_OFFICIAL_IMAGES.find(
      (image) => image.id === DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
    );

    expect(defaultOfficialImage).toMatchObject({
      name: "官方编辑器",
      imageUri: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
    });

    const request = buildCreateDevelopmentInstanceRequest({
      org: "testorg",
      project: "flytesnacks",
      domain: "development",
      name: "devbox-a",
      description: "",
      owner: "ljgong",
      imageType: "official",
      officialImageId: "",
      image: "",
      enableSsh: false,
      sshUser: "dev",
      authorizedKey: "ssh-rsa AAAA user@example",
      cpu: "2",
      memory: "4Gi",
      gpuCount: 0,
      nodePort: 31022,
      maxHours: 24,
    });

    if (request.task.case !== "taskSpec") {
      throw new Error("expected task spec");
    }
    expect(request.task.value.taskTemplate?.custom).toMatchObject({
      image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
      imageType: "official",
      officialImageId: DEFAULT_DEVELOPMENT_INSTANCE_OFFICIAL_IMAGE_ID,
      imageName: "官方编辑器",
    });
  });

  it("formats run metadata into a development instance row", () => {
    const run = create(RunSchema, {
      action: create(ActionSchema, {
        id: {
          run: create(RunIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            name: "devbox-a",
          }),
        },
        status: {
          phase: ActionPhase.RUNNING,
          startTime: { seconds: BigInt(1781254800), nanos: 0 },
        },
        metadata: create(ActionMetadataSchema, {
          executedBy: create(EnrichedIdentitySchema, {
            principal: {
              case: "user",
              value: create(UserSchema, {
                id: create(UserIdentifierSchema, { subject: "ljgong" }),
                spec: create(UserSpecSchema, { userHandle: "ljgong" }),
              }),
            },
          }),
        }),
      }),
    });

    const instance = formatDevelopmentInstance(run);

    expect(instance?.name).toBe("devbox-a");
    expect(instance?.owner).toBe("ljgong");
    expect(instance?.status).toBe(ActionPhase.RUNNING);
  });

  it("formats display name and run ID as separate columns", () => {
    const sourceInstanceId = "ins-4a458z341d7k5o-5fef0df9";
    const runName = `${sourceInstanceId}-r1`;
    const run = create(RunSchema, {
      action: create(ActionSchema, {
        id: {
          run: create(RunIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            name: runName,
          }),
        },
      }),
    });
    const actionDetails = create(ActionDetailsSchema, {
      spec: {
        case: "task",
        value: {
          taskTemplate: create(TaskTemplateSchema, {
            custom: {
              sourceName: "中文实例",
              sourceInstanceId,
              description: "用于调试",
            },
          }),
        },
      },
    });

    const instance = formatDevelopmentInstance(run, actionDetails);

    expect(instance?.name).toBe("中文实例");
    expect(instance?.runName).toBe(runName);
    expect(instance?.sourceInstanceId).toBe(sourceInstanceId);
    expect(instance?.description).toBe("用于调试");
  });

  it("falls back to the run ID for legacy rows without source metadata", () => {
    const run = create(RunSchema, {
      action: create(ActionSchema, {
        id: {
          run: create(RunIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            name: "legacy-devbox",
          }),
        },
      }),
    });

    const instance = formatDevelopmentInstance(run);

    expect(instance?.name).toBe("legacy-devbox");
    expect(instance?.runName).toBe("legacy-devbox");
    expect(instance?.sourceInstanceId).toBe("legacy-devbox");
  });

  it("defaults formatted run SSH commands to flytekit", () => {
    const run = create(RunSchema, {
      action: create(ActionSchema, {
        id: {
          run: create(RunIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            name: "devbox-flytekit",
          }),
        },
      }),
    });
    const actionDetails = create(ActionDetailsSchema, {
      spec: {
        case: "task",
        value: {
          taskTemplate: create(TaskTemplateSchema, {
            custom: {
              nodePort: 31000,
            },
          }),
        },
      },
    });

    const instance = formatDevelopmentInstance(run, actionDetails);

    expect(instance?.sshCommand).toBe("ssh -p 31000 flytekit@172.19.66.218");
  });

  it("generates the next restart run suffix for the same source instance", () => {
    const sourceInstanceId = "ins-4a458z341d7k5o-5fef0df9";

    expect(
      getNextDevelopmentInstanceRunGeneration(
        [
          {
            sourceInstanceId,
            runName: `${sourceInstanceId}-r1`,
          },
          {
            sourceInstanceId,
            runName: `${sourceInstanceId}-r2`,
          },
          {
            sourceInstanceId: "ins-other12345678-5fef0df9",
            runName: "ins-other12345678-5fef0df9-r9",
          },
        ],
        sourceInstanceId,
      ),
    ).toBe(3);
  });

  it("shows requested GPU count without workspace capacity", () => {
    const run = create(RunSchema, {
      action: create(ActionSchema, {
        id: {
          run: create(RunIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            name: "devbox-gpu",
          }),
        },
      }),
    });
    const actionDetails = create(ActionDetailsSchema, {
      spec: {
        case: "task",
        value: {
          taskTemplate: create(TaskTemplateSchema, {
            custom: {
              cpu: "1",
              memory: "2Gi",
              gpuCount: 1,
              gpuModel: "",
              workspaceSize: "20Gi",
            },
          }),
        },
      },
    });

    const instance = formatDevelopmentInstance(run, actionDetails);

    expect(instance?.resourceSummary).toBe("1vCPU, 2Gi, 1*GPU");
  });

  it("hides runs marked as deleted by the development instance console", () => {
    const run = create(RunSchema, {
      action: create(ActionSchema, {
        id: {
          run: create(RunIdentifierSchema, {
            org: "testorg",
            project: "flytesnacks",
            domain: "development",
            name: "devbox-a",
          }),
        },
      }),
    });
    const actionDetails = create(ActionDetailsSchema, {
      result: {
        case: "abortInfo",
        value: create(AbortInfoSchema, {
          reason: DELETED_DEVELOPMENT_INSTANCE_REASON,
        }),
      },
    });

    expect(formatDevelopmentInstance(run, actionDetails)).toBeNull();
  });

  it("detects terminal phases and builds run identifiers", () => {
    expect(isTerminalPhase(ActionPhase.ABORTED)).toBe(true);
    expect(isTerminalPhase(ActionPhase.RUNNING)).toBe(false);
    expect(
      buildRunIdentifier("testorg", "flytesnacks", "development", "run-a"),
    ).toMatchObject({
      org: "testorg",
      project: "flytesnacks",
      domain: "development",
      name: "run-a",
    });
  });
});
