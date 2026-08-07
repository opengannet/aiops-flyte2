# VLLM 应用列表行编辑导航设计

## 目标

在应用列表中，点击 VLLM 模型应用的任意非菜单区域时，直接进入该应用的编辑页。

## 交互

- 当应用类型为 `VLLM` 时，整行链接指向
  `/domain/:domain/project/:project/apps/:appId/edit`。
- 其他应用类型继续指向现有详情页
  `/domain/:domain/project/:project/apps/:appId`。
- 右侧溢出菜单维持现有行为。菜单容器继续拦截点击事件，因此选择编辑、启停、复制等菜单项不会触发行链接。

## 实现边界

仅修改 `ListAppsTable` 的行链接生成逻辑；不修改编辑页面、详情页面、应用数据模型或菜单能力。

## 验证

新增列表表格回归测试，覆盖：

1. VLLM 行生成编辑页链接。
2. 非 VLLM 行继续生成详情页链接。

现有相关组件测试与 TypeScript 检查应继续通过。
