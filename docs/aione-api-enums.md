# AIONE API 枚举说明

本文档记录 AIONE 外部 API 返回值中使用的枚举和状态字段。

## 响应包裹层 status

AIONE API 响应最外层的 `status` 字段是写入 JSON body 的 HTTP 状态码，不是业务枚举。

示例：

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

常见值：

| 值 | 含义 |
| --- | --- |
| `200` | 请求成功，响应中包含 `data`。 |
| `204` | 请求成功，但没有响应数据。 |
| `400` | 请求参数或格式不正确，`message` 描述错误原因。 |
| `401` | 未授权。 |
| `404` | 请求的资源不存在。 |
| `500` | 服务端错误，能获取到错误原因时会写入 `message`。 |

## ActionPhase

`/v2/api/aione/instance/{id}/status` 和 `/v2/api/aione/task/{id}/status` 返回的
`data.phase` 字段是 Flyte 2 `flyteidl2.common.ActionPhase` 的数字枚举值。

枚举来源：

```text
flyte_console/gen/flyteidl2/common/phase_pb.ts
```

当前取值：

| 值 | 名称 | 含义 |
| --- | --- | --- |
| `0` | `UNSPECIFIED` | 未知状态或未设置状态。 |
| `1` | `QUEUED` | 已接收，等待调度。 |
| `2` | `WAITING_FOR_RESOURCES` | 已调度，正在等待计算资源。 |
| `3` | `INITIALIZING` | 资源已分配，正在初始化运行环境。 |
| `4` | `RUNNING` | 正在运行。 |
| `5` | `SUCCEEDED` | 已成功完成。 |
| `6` | `FAILED` | 执行失败。 |
| `7` | `ABORTED` | 被手动终止或取消。 |
| `8` | `TIMED_OUT` | 执行超时。 |
| `9` | `PAUSED` | 已暂停。 |

典型流转：

```text
QUEUED -> WAITING_FOR_RESOURCES -> INITIALIZING -> RUNNING -> {SUCCEEDED|FAILED|ABORTED|TIMED_OUT}
RUNNING <-> PAUSED
```

终态：

```text
SUCCEEDED, FAILED, ABORTED, TIMED_OUT
```

非终态：

```text
UNSPECIFIED, QUEUED, WAITING_FOR_RESOURCES, INITIALIZING, RUNNING, PAUSED
```

## 状态查询接口字段

`GET /v2/api/aione/instance/{id}/status` 和
`GET /v2/api/aione/task/{id}/status` 返回标准响应结构：

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

字段含义：

| 字段 | 含义 |
| --- | --- |
| `runId` | 状态接口实际读取的完整 Flyte run 标识，格式为 `org/project/domain/name`。 |
| `phase` | 数字 `ActionPhase` 值。例如 `4` 表示 `RUNNING`。 |
| `error` | 失败或终止时的错误信息。空字符串表示当前没有错误信息。 |
| `durationSeconds` | 已运行时长，单位为秒。优先使用 Flyte 返回的 `durationMs`；没有该值时，根据 `startTime` 到 `endTime` 或当前时间计算。 |

## 资源清理接口

AIONE 外部资源清理使用 `DELETE` 方法：

```text
DELETE /v2/api/aione/instance/{id}/clear
DELETE /v2/api/aione/task/{id}/clear
DELETE /v2/api/aione/store/{id}/clear
```

`instance` 和 `task` 只清理已停止后的运行期 Kubernetes 资源。运行中返回 `409`，需要先调用
对应 stop 接口。清理开发实例/训练任务时会删除匹配运行 label 的 `Secret`、`Service`、
`Ingress` 等运行资源，不删除 PVC。

`store` 按云存储 id 清理 `flyte` namespace 下带云存储 label 的 PVC，并清除
CloudStorage 物化记录。若 PVC 仍被非终态 Pod 引用，返回 `409`。

## 云存储容量接口

AIONE 外部云存储容量查询使用 `GET` 方法：

```text
GET /v2/api/aione/pvc/{id}/size
```

`id` 是云存储 id。接口使用 AIONE 外部 API 认证，认证方式与实例、任务、资源清理接口一致。

成功响应：

```json
{
  "status": 200,
  "data": {
    "used": 123,
    "provisioned": 456,
    "available": 333,
    "usagePercent": 26.97,
    "statsSource": "hawk_history",
    "statsTime": "2026-07-30T08:00:00.000Z"
  }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `used` | PVC 已使用字节数。完整 kubelet statfs 优先，否则使用 Hawk 最近历史完整样本；无完整样本时为 `null`。 |
| `provisioned` | PVC 已分配字节数。优先来自 PVC `status.capacity.storage`，没有时使用 PVC request storage。 |
| `available` | PVC 可用字节数。kubelet 来源使用直接值；Hawk 历史来源使用 `filesystem size - used` 推导；无完整样本时为 `null`。 |
| `usagePercent` | `sum(used) / sum(filesystem capacity) × 100`；无完整样本时为 `null`。 |
| `statsSource` | `kubelet`、`hawk_history`、`mixed` 或 `unavailable`。 |
| `statsTime` | 全部 PVC 数据可用时取最早的最后观测时间，否则为 `null`。Hawk 时间是 Prometheus range query 的最后观测步点近似值。 |

如果同一个云存储 id 对应多个 PVC，`provisioned` 始终汇总 PVC provisioned
容量。只有所有 PVC 都有完整用量与文件系统容量时，才汇总 `used` 和
`available`；任一 PVC 不可用时，所有聚合用量字段及 `statsTime` 都返回 `null`。
接口不会为未挂载 PVC 创建临时探测 Pod。

## GPU 使用量接口

AIONE 外部 GPU 使用量查询使用 `GET` 方法：

```text
GET /v2/api/aione/gpus?keys=nvidia.com/gpu,nvidia.com/3090
```

`keys` 是逗号拼接的 Kubernetes GPU resource key 或 GPU 型号标签 key。接口只返回
`keys` 中传入的 GPU 类型，重复 key 会去重，未知 key 返回 `0`。

成功响应：

```json
{
  "status": 200,
  "data": {
    "nvidia.com/gpu": { "total": 1, "allocated": 1 },
    "nvidia.com/3090": { "total": 4, "allocated": 2 }
  }
}
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `total` | 集群 Node `status.allocatable` 中该 GPU resource key 的总量。 |
| `allocated` | 集群已调度且非终态 Pod 中该 GPU resource key 的有效 request 总量。 |

如果 key 不是节点 allocatable resource，但节点存在同名标签且值为 `true`，例如
`nvidia.com/t4=true` 或 `nvidia.com/3090=true`，接口会把它当作 GPU 型号标签统计：
`total` 使用这些节点上的 `nvidia.com/gpu` allocatable，`allocated` 使用调度到这些节点的
Pod `nvidia.com/gpu` request。

`allocated` 表示 Kubernetes 已分配/请求的 GPU 数量，不表示 DCGM 或 GPU metrics 中的实时利用率。

## OpenAPI 与 Swagger UI

外部 AIONE REST API 提供 OpenAPI 3.1 规范和 Swagger UI 在线文档：

- OpenAPI JSON：`http://172.19.66.218:30081/v2/openapi.json`
- Swagger UI：`http://172.19.66.218:30081/v2/api-docs`

Swagger UI 页面和 OpenAPI JSON 可公开访问；绝大多数外部接口仍需要 API key。可在 Swagger UI 的 **Authorize** 中填写 `Bearer Token` 或 `X-API-Key`，也可在脚本中使用：

```bash
curl -fsS \
  -H "Authorization: Bearer $AIONE_API_KEY" \
  "http://172.19.66.218:30081/v2/api/aione/gpus?keys=nvidia.com/gpu"
```

在线调试中的创建、停止和清理操作会影响真实计算资源。页面输入的 key 只保存在浏览器的 Swagger UI 会话中，不会写进服务端日志或规范文件。
