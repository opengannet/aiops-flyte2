# 云存储真实挂载状态设计

## 目标

云存储列表不再把 `MATERIALIZED`（PVC 已物化）显示为“已挂载”。列表根据运行中 Pod 对规范 PVC `cs-<storage-id>` 的引用显示真实状态：有引用为“使用中”，无引用为“未使用”。创建人字段保持现有语义，不做修改。

## 界面

- “状态”列显示“使用中”“未使用”或查询失败时的“未知”。
- 原“挂载于”列改名为“使用 Pod”。
- “使用 Pod”显示引用该 PVC 的运行中 Pod 名称；没有引用或状态未知时显示 `-`。
- 刷新列表时同时刷新实时挂载数据。

## 数据流

新增 Console 服务端批量接口。接口读取 `flyte` 运行命名空间中的运行中 Pod，遍历 Pod volumes 的 `persistentVolumeClaim.claimName`，按规范 PVC 名反向映射出 Pod 名称。浏览器在取得云存储列表后一次性请求该接口，并把返回结果与云存储 ID 合并展示，避免逐条调用详情统计接口。

接口只返回请求中云存储 ID 对应的挂载信息，不改变现有 CloudStorage RPC 请求或响应结构。规范名称生成继续复用 `buildCloudStoragePVCName`。

## 错误处理

- Kubernetes 查询失败时接口返回错误，列表将所有挂载状态显示为“未知”，并显示加载失败提示。
- 非规范云存储 ID 不参与 PVC 匹配，对应状态显示“未知”。
- 只计算 `Running` Pod；`Succeeded`、`Failed`、`Pending` 等 Pod 不视为正在使用。

## 测试

- 服务端测试覆盖：运行中 Pod 引用主 PVC、无引用、终态/非运行 Pod 不计入、多个 Pod 引用同一 PVC。
- 列表组件测试覆盖：“使用中/未使用/未知”、真实 Pod 名称、列标题为“使用 Pod”。
- 运行 Console Vitest、TypeScript 类型检查和生产构建。
