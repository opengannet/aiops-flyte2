# Flyte Console Agent Guide

本文件是 `flyte_console/` 子目录的 agent 指南，用于补充仓库根目录
`../AGENTS.md`。根目录指南仍然是部署、分支、提交和远端操作的最高优先级说明；
本文件只约束 Console 内的 Next.js 代码、对外 API route、响应结构和 smoke 测试写法。

## 目录边界

- Next.js App Router 的 HTTP 入口只放在 `src/app/api/**/route.ts`。
- `route.ts` 只负责 HTTP 边界：认证、解析请求、调用共享实现、返回统一响应。
- 共享实现、Kubernetes/Flyte 调用、状态读写、业务转换逻辑放在 `src/server/**`。
- 不要把可复用业务实现放在 `src/app/api/**` 下。
- 内部 server 代码不要通过 `fetch("/api/...")` 调用自己的 HTTP endpoint；应直接调用
  `src/server/**` 下的函数。

## 对外 API 响应格式

所有 `src/app/api/**` route 必须使用 `src/server/http/response.ts` 中的 helper 返回响应。

成功响应：

```ts
return okEnvelope(data);
```

返回 JSON：

```json
{
  "status": 200,
  "data": {}
}
```

无数据成功时，优先仍返回 `okEnvelope({})`。只有接口已经明确约定 HTTP `204` 时，才使用
`okEnvelope(data, 204)` 或等价实现。

失败响应：

```ts
return errorEnvelope(statusError("id is required", 400));
```

返回 JSON：

```json
{
  "status": 400,
  "message": "id is required"
}
```

禁止外层失败响应返回旧结构：

```json
{
  "ok": false,
  "error": "instance record not found"
}
```

批量操作的局部业务结果可以在 `data` 内表达单项失败，例如：

```json
{
  "status": 200,
  "data": {
    "deleted": [
      { "name": "svc-a", "ok": true },
      { "name": "svc-b", "ok": false, "error": "not found" }
    ]
  }
}
```

但外层响应仍必须是 `{ "status": number, "data": ... }` 或
`{ "status": number, "message": string }`。

## AIONE 外部 API 约定

- AIONE 外部 API 入口位于 `src/app/api/aione/**/route.ts`。
- 外部请求认证统一使用 `authenticateAioneRequest(...)`。
- 参数错误使用 `400`。
- 未授权使用 `401`。
- 资源不存在使用 `404`。
- 上游 Flyte、Kubernetes 或其他服务调用失败使用 `502`，除非错误本身已经能明确映射为
  `400` 或 `404`。
- 状态接口中的 `phase` 必须使用当前 Flyte `ActionPhase` 数字值，不要发明新的 phase
  sentinel 值。
- `ActionPhase` 枚举说明见 `../docs/aione-api-enums.md`。
- `runId` 如需返回，应表示接口实际读取的完整 Flyte run id，格式为
  `org/project/domain/name`。
- 外部 clear 接口使用 `DELETE /v2/api/aione/{type}/{id}/clear`。`type` 支持
  `instance`、`task`、`store`；其中 run/status/stop 仍只支持 `instance` 和 `task`。
- 外部云存储容量接口使用 `GET /v2/api/aione/pvc/{id}/size`，`id` 是云存储 id。
  成功时返回
  `{ status: 200, data: { used, provisioned, available, usagePercent, statsSource, statsTime } }`。
  `provisioned` 始终汇总 PVC provisioned 容量；用量优先使用完整 kubelet statfs，
  不完整或未挂载时整组回退 Hawk 最后完整历史样本。任一 PVC 无完整样本时，
  `used`、`available`、`usagePercent`、`statsTime` 返回 `null`，不得返回假 `0`。
  Hawk 的 `available` 是 `filesystem size - used` 推导值。
- 外部 GPU 使用量接口使用 `GET /v2/api/aione/gpus?keys=<gpu-resource-keys>`，
  `keys` 是逗号拼接的 Kubernetes GPU resource key 或 GPU 型号标签 key。成功时返回
  `{ status: 200, data: { [key]: { total, allocated } } }`。`total` 来自全集群
  Node `status.allocatable`，`allocated` 来自全集群已调度且非终态 Pod 的 GPU request。
  如果 key 不是 allocatable resource，但节点存在同名 `true` 标签，例如
  `nvidia.com/t4=true`、`nvidia.com/3090=true`，则按这些节点上的 `nvidia.com/gpu`
  allocatable/request 统计。
- `instance/task clear` 必须先确认最新 run 不处于非终态，再删除匹配 label 的运行期
  Kubernetes 资源，包括 Secret、Service、Ingress；不得删除 PVC。
- `store clear` 必须按 `flyte.org/cloud-storage=true` 和
  `flyte.org/cloud-storage-id=<id>` 查找并删除 PVC；不得按 PVC 名推导云存储。

示例状态响应：

```json
{
  "status": 200,
  "data": {
    "runId": "aione/aione/development/aione-supertest-r3",
    "phase": 4,
    "error": "",
    "durationSeconds": 9048
  }
}
```

## Route 单测要求

每个新增或修改的 route 都应有同目录 `route.test.ts`，覆盖以下场景：

- 成功响应，断言完整 JSON，包括外层 `status` 和 `data`。
- 未授权响应，断言 `{ status: 401, message: "unauthorized" }`。
- 参数错误，断言 `{ status: 400, message: "..." }`。
- 资源不存在，断言 `{ status: 404, message: "..." }`。
- 上游或 Kubernetes 操作失败，断言统一错误 envelope。

测试必须断言完整返回结构，不只断言某个字段存在。修改响应结构时，同步更新对应
`route.test.ts` 和 `tests_smoke/` 下的脚本或脚本测试。

常用命令：

```powershell
cd D:\flyte-work\flyte_console

pnpm exec vitest run "src/app/api/aione/[type]/[id]/status/route.test.ts"
pnpm exec vitest run "src/app/api/aione/[type]/run/route.test.ts" "src/app/api/aione/[type]/[id]/status/route.test.ts" "src/app/api/aione/[type]/[id]/stop/route.test.ts" "src/app/api/aione/[type]/[id]/clear/route.test.ts"
pnpm exec tsc --project tsconfig.typecheck.json --noEmit
pnpm run build:prod
```

提交前从仓库根目录检查：

```powershell
cd D:\flyte-work
git diff --check
git status --short
```

## Smoke 测试约定

对外 API 的 smoke 脚本放在仓库根目录 `tests_smoke/`，不要放在 `flyte_console/` 内。

smoke 脚本约定：

- 从 `tests_smoke/.env` 读取配置。
- 至少包含 `ENDPOINT`、`AIONE_API_KEY`、接口 path template 和必要业务参数。
- 请求前打印最终 URL，格式为 `URL: <url>`。
- 成功时 pretty-print JSON，保留中文和 UTF-8 内容。
- HTTP 失败时打印 `ERROR: HTTP <code>: <body>` 到 stderr，并返回非 0。
- 本地输入缺失、`.env` 缺失、必要 key 缺失时，也打印 `ERROR: ...` 并返回非 0。

状态接口 smoke 示例：

```powershell
cd D:\flyte-work
C:\Users\admin\AppData\Local\Programs\Python\Python312\python.exe D:\flyte-work\tests_smoke\instance_status_smoke.py
```

预期成功响应结构：

```json
{
  "status": 200,
  "data": {
    "runId": "aione/aione/development/aione-supertest-r3",
    "phase": 4,
    "error": "",
    "durationSeconds": 9048
  }
}
```

如果修改了 API path、认证方式、请求体或响应结构，必须同步更新：

- 对应 `tests_smoke/*_smoke.py`。
- `tests_smoke/test_instance_smoke_cli.py` 中的脚本行为测试。
- `tests_smoke/test_task_smoke_cli.py` 和 `tests_smoke/test_store_smoke_cli.py` 中的脚本行为测试。
- 相关 `route.test.ts`。
