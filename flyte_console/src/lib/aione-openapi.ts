/**
 * Public contract for the AIONE REST endpoints. Keep this document in sync
 * with the AIONE API route handlers; it is served at /v2/openapi.json.
 */

type OpenApiDocument = Record<string, unknown>;

const protectedOperation = [{ bearerAuth: [] }, { apiKeyAuth: [] }];

const errorResponse = {
  description: "请求失败",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorEnvelope" },
      example: { status: 401, message: "unauthorized" },
    },
  },
};

const jsonResponse = (description: string, example: unknown) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/SuccessEnvelope" },
      example: { status: 200, data: example },
    },
  },
});

const identifierParameter = {
  name: "id",
  in: "path",
  required: true,
  description: "外部系统中的实例、任务或云存储 ID。",
  schema: { type: "string", minLength: 1 },
};

const executionTypeParameter = {
  name: "type",
  in: "path",
  required: true,
  description: "实例或训练任务类型。",
  schema: { type: "string", enum: ["instance", "task"] },
};

const runTypeParameter = {
  name: "type",
  in: "path",
  required: true,
  description: "要启动的资源类型。",
  schema: { type: "string", enum: ["instance", "task", "model"] },
};

export const aioneOpenApi: OpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "AIONE 外部 REST API",
    version: "v2",
    description:
      "用于从外部系统创建和管理 AIONE 开发实例、训练任务及模型应用的 REST API。除模型 API Key 路由外，所有接口均需提供 Bearer Token 或 X-API-Key。",
  },
  servers: [
    {
      url: "/v2",
      description: "当前 Flyte Console 服务",
    },
  ],
  tags: [
    { name: "运行", description: "创建实例、任务或模型应用。" },
    { name: "执行管理", description: "查询、停止、清理运行时资源。" },
    { name: "可观测性", description: "读取日志、监控数据和 GPU 使用量。" },
    { name: "存储", description: "读取云存储 PVC 容量。" },
    { name: "模型", description: "获取模型调用 API Key。" },
  ],
  paths: {
    "/api/aione/{type}/run": {
      post: {
        tags: ["运行"],
        summary: "创建或启动实例、训练任务或模型应用",
        description:
          "instance 支持 SSH 开发环境，task 创建或重启训练任务，model 按已配置的运行时 profile 启动模型应用。该操作会创建计算资源。",
        security: protectedOperation,
        parameters: [runTypeParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/InstanceRunRequest" },
                  { $ref: "#/components/schemas/TaskRunRequest" },
                  { $ref: "#/components/schemas/ModelRunRequest" },
                ],
              },
              examples: {
                instance: {
                  summary: "带 SSH 的开发实例",
                  value: {
                    project: "aione",
                    domain: "development",
                    id: "notebook-01",
                    name: "Notebook 01",
                    imageType: "OWN",
                    image: "docker.fzyun.io/founder/aione.ide:1.0.0.60",
                    enableSsh: true,
                    authorizedKey: "ssh-ed25519 AAAA... user@example",
                    resourceDefinition: { cpu: "2", memory: "4Gi", gpu: 0 },
                  },
                },
                task: {
                  summary: "训练任务",
                  value: {
                    project: "aione",
                    domain: "development",
                    id: "train-01",
                    name: "训练任务 01",
                    image: "python:3.12-slim",
                    command: ["python", "train.py"],
                    resourceDefinition: { cpu: "2", memory: "4Gi", gpu: 1 },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": jsonResponse("已创建或启动", { runId: "aione/aione/development/notebook-01-r1" }),
          "400": errorResponse,
          "401": errorResponse,
          "409": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/aione/model/{id}/run": {
      post: {
        tags: ["运行"],
        summary: "按模型 ID 启动模型应用",
        description: "路径中的模型 ID 会写入请求体；若 body.id 同时存在，必须与路径一致。该操作会创建计算资源。",
        security: protectedOperation,
        parameters: [identifierParameter],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ModelRunRequest" } } },
        },
        responses: {
          "200": jsonResponse("模型应用已创建", { name: "qwen-app", code: "qwen", profile: "VLLM", url: "https://qwen.example" }),
          "400": errorResponse,
          "401": errorResponse,
          "409": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/aione/{type}/{id}/status": {
      get: {
        tags: ["执行管理"],
        summary: "查询实例或任务状态",
        security: protectedOperation,
        parameters: [executionTypeParameter, identifierParameter],
        responses: {
          "200": jsonResponse("当前执行状态", { runId: "aione/aione/development/train-01", phase: 4, error: "", durationSeconds: 120 }),
          "400": errorResponse,
          "401": errorResponse,
          "404": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/aione/{type}/{id}/stop": {
      post: {
        tags: ["执行管理"],
        summary: "停止实例或训练任务",
        description: "停止当前运行，但不会删除运行时资源；使用 clear 删除终态资源。",
        security: protectedOperation,
        parameters: [executionTypeParameter, identifierParameter],
        responses: { "200": jsonResponse("已请求停止", {}), "400": errorResponse, "401": errorResponse, "404": errorResponse, "502": errorResponse },
      },
    },
    "/api/aione/{type}/{id}/clear": {
      delete: {
        tags: ["执行管理"],
        summary: "清理终态运行时资源或云存储 PVC",
        description: "type 可为 instance、task 或 store。instance/task 仅可清理终态运行；store 会删除匹配云存储 ID 的 PVC。此操作不可逆。",
        security: protectedOperation,
        parameters: [
          { ...executionTypeParameter, description: "instance、task 或 store。", schema: { type: "string", enum: ["instance", "task", "store"] } },
          identifierParameter,
        ],
        responses: { "200": jsonResponse("资源已清理", {}), "400": errorResponse, "401": errorResponse, "404": errorResponse, "409": errorResponse, "502": errorResponse },
      },
    },
    "/api/aione/{type}/{id}/runs": {
      get: {
        tags: ["执行管理"],
        summary: "列出开发实例的运行历史",
        description: "仅支持 type=instance。",
        security: protectedOperation,
        parameters: [executionTypeParameter, identifierParameter],
        responses: {
          "200": jsonResponse("实例运行记录", { total: 1, runs: [{ instanceId: "notebook-01", runName: "notebook-01-r1", status: 4, nodePort: 30022, startedAt: "2026-08-12T01:00:00.000Z", endedAt: "" }] }),
          "400": errorResponse,
          "401": errorResponse,
          "404": errorResponse,
          "502": errorResponse,
        },
      },
    },
    "/api/aione/{type}/{id}/log": {
      get: {
        tags: ["可观测性"],
        summary: "读取实例或任务日志",
        security: protectedOperation,
        parameters: [
          executionTypeParameter,
          identifierParameter,
          { name: "page", in: "query", description: "从 1 开始，默认 1。", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "size", in: "query", description: "每页记录数，默认 200，最大 1000。", schema: { type: "integer", minimum: 1, maximum: 1000, default: 200 } },
        ],
        responses: { "200": jsonResponse("日志分页结果", { page: 1, size: 200, total: 1, lines: [{ time: "2026-08-12T01:00:00.000Z", message: "training started" }] }), "400": errorResponse, "401": errorResponse, "404": errorResponse, "502": errorResponse },
      },
    },
    "/api/aione/{type}/{id}/monitor": {
      get: {
        tags: ["可观测性"],
        summary: "读取 CPU、内存或 GPU 监控序列",
        security: protectedOperation,
        parameters: [
          executionTypeParameter,
          identifierParameter,
          { name: "mode", in: "query", required: true, description: "单个查询参数，可用逗号组合 cpu、memory、gpu。", schema: { type: "string", example: "cpu,memory,gpu" } },
          { name: "period", in: "query", required: true, description: "单个持续时间，单位 m 或 h，最大 24h。", schema: { type: "string", pattern: "^[1-9]\\d*(m|h)$", example: "1h" } },
        ],
        responses: { "200": jsonResponse("监控数据点", [{ time: "2026-08-12T01:00:00.000Z", cpu: 52.1, memory: 38.4, gpu: { gpu: 66.2, vram: 42.0 } }]), "400": errorResponse, "401": errorResponse, "404": errorResponse, "502": errorResponse },
      },
    },
    "/api/aione/gpus": {
      get: {
        tags: ["可观测性"],
        summary: "查询指定 GPU 资源的总量和已分配量",
        security: protectedOperation,
        parameters: [{ name: "keys", in: "query", required: true, description: "逗号分隔的 Kubernetes GPU resource key 或 GPU 型号标签 key。", schema: { type: "string", example: "nvidia.com/gpu,nvidia.com/3090" } }],
        responses: { "200": jsonResponse("GPU 使用量", { "nvidia.com/gpu": { total: 4, allocated: 1 }, "nvidia.com/3090": { total: 2, allocated: 0 } }), "400": errorResponse, "401": errorResponse, "502": errorResponse },
      },
    },
    "/api/aione/pvc/{id}/size": {
      get: {
        tags: ["存储"],
        summary: "查询云存储 PVC 容量与使用量",
        security: protectedOperation,
        parameters: [identifierParameter],
        responses: { "200": jsonResponse("PVC 容量统计", { used: 123, provisioned: 456, available: 333, usagePercent: 26.97, statsSource: "hawk_history", statsTime: "2026-08-12T01:00:00.000Z" }), "400": errorResponse, "401": errorResponse, "404": errorResponse, "502": errorResponse },
      },
    },
    "/api/aione/apikey/{modelCode}": {
      post: {
        tags: ["模型"],
        summary: "获取模型 API Key",
        description: "modelCode 可包含斜杠，例如 sakamakismile/Qwen3.6-27B-NVFP4。此路由当前不使用 AIONE 外部 API key 认证。",
        security: [],
        parameters: [{ name: "modelCode", in: "path", required: true, description: "模型代码，可包含 /。", schema: { type: "string", minLength: 1 } }],
        responses: { "200": jsonResponse("模型调用 key", "sk-example"), "400": errorResponse, "502": errorResponse },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API key", description: "在 Authorization header 中发送 Bearer <key>。" },
      apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key", description: "作为 Authorization 的替代方式。" },
    },
    schemas: {
      SuccessEnvelope: { type: "object", required: ["status", "data"], properties: { status: { type: "integer", example: 200 }, data: {} } },
      ErrorEnvelope: { type: "object", required: ["status", "message"], properties: { status: { type: "integer", example: 400 }, message: { type: "string", example: "id is required" } } },
      InstanceRunRequest: { type: "object", required: ["project", "domain"], properties: { org: { type: "string", description: "外部来源组织。" }, project: { type: "string" }, domain: { type: "string" }, id: { type: "string" }, name: { type: "string" }, imageType: { type: "string", enum: ["BASE", "OWN"] }, image: { type: "string" }, baseImage: { type: "object", properties: { image: { type: "string" } } }, enableSsh: { type: "boolean" }, authorizedKey: { type: "string" }, resourceDefinition: { type: "object", properties: { cpu: { type: "string" }, memory: { type: "string" }, gpu: { type: "integer", minimum: 0 }, gpu_key: { type: "string" } } } } },
      TaskRunRequest: { type: "object", required: ["project", "domain", "id", "name"], properties: { org: { type: "string" }, project: { type: "string" }, domain: { type: "string" }, id: { type: "string" }, name: { type: "string" }, image: { type: "string" }, command: { type: "array", items: { type: "string" } }, resourceDefinition: { type: "object" } } },
      ModelRunRequest: { type: "object", properties: { id: { type: "string", description: "使用路径路由时可省略。" }, name: { type: "string" }, code: { type: "string" }, profile: { type: "string", enum: ["VLLM"] }, resourceDefinition: { type: "object" } } },
    },
  },
};
