import { describe, expect, it } from "vitest";
import {
  authenticateAioneRequest,
  buildAioneCreateInstanceResponse,
  buildAioneInstanceAccessInfo,
  buildAioneInstanceValues,
  buildDockerConfigJson,
  buildExternalSecretName,
  buildWorkspaceLabels,
} from "./helpers";

const basePayload = {
  org: "external-org",
  project: "aione",
  domain: "development",
  name: "开发实例一",
  id: "ins-og2bgwm130xq3o6uk3h4956la6",
  timeout: 1,
  imageType: "BASE" as const,
  baseImage: {
    image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
    imageKey: "gonglijie",
    imageSecret: "Founder123",
    mountPath: "/data/lib1",
  },
  codes: [
    {
      id: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
      branch: "master",
      path: "/data/js-sample",
      token: "repo-token",
    },
  ],
  datastores: [
    {
      id: "stg-2i63j4q0z319cb63mw90qnt2mt",
      path: "/data/mystore2",
      size: 2,
    },
  ],
  resourceDefinition: {
    cpu: "2",
    memory: "4Gi",
    gpu: 1,
    gpu_key: "nvidia.com/gpu.present",
  },
};

describe("aione external instance helpers", () => {
  it("maps the external payload without leaking source org or secrets into Flyte identifiers", () => {
    const mapped = buildAioneInstanceValues({
      payload: basePayload,
      nodePort: 31000,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
      runNameSuffix: "r1",
    });

    expect(mapped.runName).toMatch(/-r1$/);
    expect(mapped.runName.length).toBeLessThanOrEqual(30);
    expect(mapped.sourceInstanceId).toBe("ins-og2bgwm130xq3o6uk3h4956la6");
    expect(mapped.values.org).toBe("aione");
    expect(mapped.values.project).toBe("aione");
    expect(mapped.values.domain).toBe("development");
    expect(mapped.values.maxHours).toBe(1);
    expect(mapped.values.enableSsh).toBe(false);
    expect(mapped.values.authorizedKey).toBe("");
    expect(mapped.values.sshUser).toBe("flytekit");
    expect(mapped.values.image).toBe(
      "docker.fzyun.io/founder/aione.ide:1.0.0.60",
    );
    expect(mapped.values.baseImageMountPath).toBe("/data/lib1");
    expect(mapped.values.sourceOrg).toBe("external-org");
    expect(mapped.values.sourceInstanceId).toBe(
      "ins-og2bgwm130xq3o6uk3h4956la6",
    );
    expect(mapped.values).not.toHaveProperty("workspaceSize");
    expect(mapped.values).not.toHaveProperty("workspacePVCName");
    expect(mapped.values.imagePullSecretName).toBe(
      "aione-ins-og2bgwm130xq3o6uk3h4956la6-image",
    );
    expect(mapped.values.codeRepositorySecretName).toBe(
      "aione-ins-og2bgwm130xq3o6uk3h4956la6-code",
    );
    expect(mapped.values.codeRepositories?.[0]).toMatchObject({
      id: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
      repoUrl: "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
      branch: "master",
      mountPath: "/data/js-sample",
      token: "repo-token",
    });
    expect(mapped.codeRepositoriesWithTokens[0].token).toBe("repo-token");
    expect(mapped.values.cloudStorageMounts?.[0]).toMatchObject({
      cloudStorageId: "stg-2i63j4q0z319cb63mw90qnt2mt",
      pvcName: "ins-og2bgwm130xq3o6uk3h4956la6-stg-2i63j4q0z319cb63mw90qnt2mt",
      storageClass: "bj1-ebs",
      size: "2Gi",
      mountPath: "/data/mystore2",
    });
    expect(mapped.values.gpuNodeLabelKey).toBe("nvidia.com/gpu.present");
  });

  it("keeps stable instance resources while generating a unique Flyte run per start", () => {
    const first = buildAioneInstanceValues({
      payload: basePayload,
      nodePort: 31000,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
      runNameSuffix: "r1",
    });
    const second = buildAioneInstanceValues({
      payload: basePayload,
      nodePort: 31002,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
      runNameSuffix: "r2",
    });

    expect(first.sourceInstanceId).toBe(second.sourceInstanceId);
    expect(first.runName).not.toBe(second.runName);
    expect(first.runName).toMatch(/-r1$/);
    expect(second.runName).toMatch(/-r2$/);
    expect(first.values.cloudStorageMounts?.[0]?.pvcName).toBe(
      second.values.cloudStorageMounts?.[0]?.pvcName,
    );
    expect(first.values.imagePullSecretName).toBe(
      second.values.imagePullSecretName,
    );
    expect(first.values.codeRepositorySecretName).toBe(
      second.values.codeRepositorySecretName,
    );
    expect(first.runName.length).toBeLessThanOrEqual(30);
  });

  it("uses OWN image fields and the default authorized key when provided", () => {
    const mapped = buildAioneInstanceValues({
      payload: {
        ...basePayload,
        enableSsh: true,
        imageType: "OWN",
        image: "docker.fzyun.io/pytorch/pytorch:1.13.1",
        imageKey: "custom-user",
        imageSecret: "custom-secret",
      },
      nodePort: 31010,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-rsa BBBB user@example",
      runNameSuffix: "r1",
    });

    expect(mapped.values.image).toBe("docker.fzyun.io/pytorch/pytorch:1.13.1");
    expect(mapped.registryCredentials).toMatchObject({
      username: "custom-user",
      password: "custom-secret",
      image: "docker.fzyun.io/pytorch/pytorch:1.13.1",
    });
    expect(mapped.values.authorizedKey).toBe("ssh-rsa BBBB user@example");
  });

  it("rounds fractional external timeouts up to an integer hour", () => {
    const mapped = buildAioneInstanceValues({
      payload: {
        ...basePayload,
        timeout: 0.1,
      },
      nodePort: 31000,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
      runNameSuffix: "r1",
    });

    expect(mapped.values.maxHours).toBe(1);
  });

  it("maps external runtime datasets from ossDatas", () => {
    const mapped = buildAioneInstanceValues({
      payload: {
        ...basePayload,
        ossDatas: [
          {
            endpoint: "1.2.3.4",
            port: 111,
            accessKey: "ak",
            secretKey: "sk",
            targetPath: "/data/set1",
            bucket: "mybucket1",
            bucketPath: "sub-path/xxx",
          },
        ],
      },
      nodePort: 31000,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
      runNameSuffix: "r1",
    });

    expect(mapped.values.datasets?.[0]).toMatchObject({
      endpoint: "1.2.3.4",
      port: "111",
      accessKey: "ak",
      secretKey: "sk",
      targetPath: "/data/set1",
      bucket: "mybucket1",
      bucketPath: "sub-path/xxx",
    });
  });

  it("ignores noisy datasets when ossDatas is provided", () => {
    const mapped = buildAioneInstanceValues({
      payload: {
        ...basePayload,
        datasets: [
          {
            Endpoint: "wrong-field",
          },
        ],
        ossDatas: [
          {
            endpoint: "1.2.3.4",
            port: 111,
            accessKey: "ak",
            secretKey: "sk",
            targetPath: "/data/set1",
            bucket: "mybucket1",
          },
        ],
      } as never,
      nodePort: 31000,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
      runNameSuffix: "r1",
    });

    expect(mapped.values.datasets).toHaveLength(1);
    expect(mapped.values.datasets?.[0]?.endpoint).toBe("1.2.3.4");
  });

  it("ignores external datasets when ossDatas is omitted", () => {
    const mapped = buildAioneInstanceValues({
      payload: {
        ...basePayload,
        datasets: [
          {
            endpoint: "1.2.3.4",
            port: 111,
            accessKey: "ak",
            secretKey: "sk",
            targetPath: "/data/set1",
            bucket: "mybucket1",
          },
        ],
      },
      nodePort: 31000,
      internalOrg: "aione",
      defaultStorageClass: "bj1-ebs",
      defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
      runNameSuffix: "r1",
    });

    expect(mapped.values.datasets).toEqual([]);
  });

  it("rejects legacy endPoint on external ossDatas", () => {
    expect(() =>
      buildAioneInstanceValues({
        payload: {
          ...basePayload,
          ossDatas: [
            {
              endPoint: "1.2.3.4",
              port: 111,
              accessKey: "ak",
              secretKey: "sk",
              targetPath: "/data/set1",
              bucket: "mybucket1",
            },
          ],
        },
        nodePort: 31000,
        internalOrg: "aione",
        defaultStorageClass: "bj1-ebs",
        defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
        runNameSuffix: "r1",
      }),
    ).toThrow("ossDatas[0].endPoint is not supported; use endpoint");
  });

  it("rejects capitalized Endpoint on external ossDatas", () => {
    expect(() =>
      buildAioneInstanceValues({
        payload: {
          ...basePayload,
          ossDatas: [
            {
              Endpoint: "1.2.3.4",
              port: 111,
              accessKey: "ak",
              secretKey: "sk",
              targetPath: "/data/set1",
              bucket: "mybucket1",
            } as never,
          ],
        },
        nodePort: 31000,
        internalOrg: "aione",
        defaultStorageClass: "bj1-ebs",
        defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
        runNameSuffix: "r1",
      }),
    ).toThrow("ossDatas[0].Endpoint is not supported; use endpoint");
  });

  it("rejects snake case end_point on external ossDatas", () => {
    expect(() =>
      buildAioneInstanceValues({
        payload: {
          ...basePayload,
          ossDatas: [
            {
              end_point: "1.2.3.4",
              port: 111,
              accessKey: "ak",
              secretKey: "sk",
              targetPath: "/data/set1",
              bucket: "mybucket1",
            } as never,
          ],
        },
        nodePort: 31000,
        internalOrg: "aione",
        defaultStorageClass: "bj1-ebs",
        defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
        runNameSuffix: "r1",
      }),
    ).toThrow("ossDatas[0].end_point is not supported; use endpoint");
  });

  it("reports missing endpoint on external ossDatas", () => {
    expect(() =>
      buildAioneInstanceValues({
        payload: {
          ...basePayload,
          ossDatas: [
            {
              port: 111,
              accessKey: "ak",
              secretKey: "sk",
              targetPath: "/data/set1",
              bucket: "mybucket1",
            },
          ],
        },
        nodePort: 31000,
        internalOrg: "aione",
        defaultStorageClass: "bj1-ebs",
        defaultAuthorizedKey: "ssh-ed25519 AAAA user@example",
        runNameSuffix: "r1",
      }),
    ).toThrow("ossDatas[0].endpoint is required");
  });

  it("rejects SSH payloads without any SSH public key source", () => {
    expect(() =>
      buildAioneInstanceValues({
        payload: { ...basePayload, enableSsh: true },
        nodePort: 31000,
        internalOrg: "aione",
        defaultStorageClass: "bj1-ebs",
        defaultAuthorizedKey: "",
      }),
    ).toThrow("authorizedKey is required");
  });

  it("accepts bearer and x-api-key credentials", () => {
    expect(
      authenticateAioneRequest(
        new Headers({ authorization: "Bearer key-1" }),
        "key-1,key-2",
      ),
    ).toBe(true);
    expect(
      authenticateAioneRequest(new Headers({ "x-api-key": "key-2" }), [
        "key-1",
        "key-2",
      ]),
    ).toBe(true);
    expect(
      authenticateAioneRequest(new Headers({ authorization: "Bearer bad" }), [
        "key-1",
      ]),
    ).toBe(false);
  });

  it("builds docker registry auth without exposing raw credentials in labels", () => {
    const encoded = buildDockerConfigJson({
      image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
      username: "gonglijie",
      password: "Founder123",
    });
    const parsed = JSON.parse(encoded);

    expect(Object.keys(parsed.auths)).toEqual(["docker.fzyun.io"]);
    expect(parsed.auths["docker.fzyun.io"].username).toBe("gonglijie");
    expect(parsed.auths["docker.fzyun.io"].password).toBe("Founder123");
  });

  it("builds cleanup labels and bounded secret names", () => {
    expect(
      buildWorkspaceLabels({
        org: "aione",
        project: "aione",
        domain: "development",
        runName: "ins-og2bgwm130xq3o6uk3h4956la6",
      }),
    ).toMatchObject({
      "flyte.org/org": "aione",
      "flyte.org/project": "aione",
      "flyte.org/domain": "development",
      "flyte.org/run-name": "ins-og2bgwm130xq3o6uk3h4956la6",
    });
    expect(
      buildExternalSecretName(
        "aione",
        "this-is-a-very-long-instance-id-that-needs-to-be-truncated",
        "image",
      ).length,
    ).toBeLessThanOrEqual(63);
  });

  it("builds external SSH and code-server access information", () => {
    expect(
      buildAioneInstanceAccessInfo({
        runName: "ins-5ud29xk04tmc6e4ufe8083dvn0",
        sourceName: "开发实例一",
        enableSsh: true,
        sshUser: "dev",
        nodePort: 31004,
        cpu: "2",
        memory: "4Gi",
        gpuCount: 0,
        publicHost: "172.19.66.218",
        codeServerHost: "ins-5ud29xk04tmc6e4ufe8083dvn0-code.ops.fzyun.io",
      }),
    ).toEqual({
      id: "ins-5ud29xk04tmc6e4ufe8083dvn0",
      name: "开发实例一",
      status: "CREATED",
      ssh: {
        user: "dev",
        host: "172.19.66.218",
        port: 31004,
        command: "ssh -p 31004 dev@172.19.66.218",
      },
      codeServer: {
        host: "ins-5ud29xk04tmc6e4ufe8083dvn0-code.ops.fzyun.io",
        port: 443,
        url: "https://ins-5ud29xk04tmc6e4ufe8083dvn0-code.ops.fzyun.io",
        workspaceUrl:
          "https://ins-5ud29xk04tmc6e4ufe8083dvn0-code.ops.fzyun.io",
        available: true,
      },
      resources: {
        cpu: "2",
        memory: "4Gi",
        gpu: 0,
      },
    });
  });

  it("omits SSH access by default", () => {
    const access = buildAioneInstanceAccessInfo({
      runName: "ins-default",
      sourceName: "",
      enableSsh: false,
      sshUser: "dev",
      nodePort: 0,
      cpu: "2",
      memory: "4Gi",
      gpuCount: 0,
      codeServerHost: "ins-default-code.ops.fzyun.io",
    });

    expect(access.ssh).toBeUndefined();
    expect(access.codeServer.url).toBe("https://ins-default-code.ops.fzyun.io");
    expect(access.codeServer.workspaceUrl).toBe(
      "https://ins-default-code.ops.fzyun.io",
    );
    expect(access.resources).not.toHaveProperty("workspaceSize");
  });

  it("builds code-server access URLs from the workspace domain when provided", () => {
    const access = buildAioneInstanceAccessInfo({
      runName: "ins-domain-test-r1",
      sourceName: "",
      enableSsh: false,
      sshUser: "dev",
      nodePort: 31004,
      cpu: "2",
      memory: "4Gi",
      gpuCount: 0,
      codeServerHost: "ins-domain-test-r1-code.ops.fzyun.io",
      codeServerScheme: "https",
    });

    expect(access.codeServer).toMatchObject({
      host: "ins-domain-test-r1-code.ops.fzyun.io",
      port: 443,
      url: "https://ins-domain-test-r1-code.ops.fzyun.io",
      workspaceUrl: "https://ins-domain-test-r1-code.ops.fzyun.io",
      available: true,
    });
  });

  it("wraps successful create results in the external API response shape", () => {
    const info = buildAioneInstanceAccessInfo({
      runName: "ins-2024ad6h4e4x036u9u5j31ec89",
      sourceName: "实例2",
      enableSsh: true,
      sshUser: "dev",
      nodePort: 31006,
      cpu: "2",
      memory: "4Gi",
      gpuCount: 0,
      publicHost: "172.19.66.218",
      codeServerHost: "ins-2024ad6h4e4x036u9u5j31ec89-code.ops.fzyun.io",
    });

    expect(
      buildAioneCreateInstanceResponse({
        internalOrg: "aione",
        project: "aione",
        domain: "development",
        runName: "ins-2024ad6h4e4x036u9u5j31ec89",
        sourceOrg: "",
        sourceInstanceId: "ins-2024ad6h4e4x036u9u5j31ec89",
        info,
      }),
    ).toEqual({
      status: 200,
      data: {
        id: "ins-2024ad6h4e4x036u9u5j31ec89",
        run: {
          org: "aione",
          project: "aione",
          domain: "development",
          name: "ins-2024ad6h4e4x036u9u5j31ec89",
        },
        source: {
          org: "",
          id: "ins-2024ad6h4e4x036u9u5j31ec89",
        },
        info,
      },
    });
  });
});
