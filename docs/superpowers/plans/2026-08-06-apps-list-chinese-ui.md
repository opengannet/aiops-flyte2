# Apps 列表中文化与信息层级优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Apps 列表页面改为一致的简体中文界面，并让名称列只显示应用名称。

**Architecture:** 改动限定在 `ListApps` 前端页面与其表格、状态和菜单子组件。列表格式化、路由、API 与剪贴板写入行为保持不变；组件通过现有 React Testing Library 测试覆盖呈现与操作行为。

**Tech Stack:** Next.js、React、TypeScript、Tailwind CSS、Vitest、React Testing Library。

## Global Constraints

- 用户可见的 Apps 列表页固定文案使用简体中文。
- 名称列不得渲染访问地址、`Endpoint` 标签或链接组件。
- `VLLM` 等后端提供的技术类型值保持原样。
- 访问地址只能通过应用详情页或“复制访问地址”菜单项取得。
- 部署前必须提交并推送至 `origin/main`；远程检出仅可使用 `git pull --ff-only` 更新。

---

### Task 1: 为列表列定义补充中文显示测试

**Files:**
- Create: `flyte_console/src/components/pages/ListApps/table/listAppsColumns.test.tsx`
- Modify: `flyte_console/src/components/pages/ListApps/table/listAppsColumns.tsx`

**Interfaces:**
- Consumes: `baseColumns: ColumnDef<AppTableItem>[]` 以及 `AppTableItem.name` 的 `displayText`、`endpoint` 字段。
- Produces: 名称列只输出 `displayText`；列标题采用中文；副本数采用 `当前 / 最大`。

- [ ] **Step 1: Write the failing test**

```tsx
it('renders only the app display name in the name column', () => {
  const nameColumn = baseColumns.find((column) => column.id === 'name')!
  const cell = nameColumn.cell as (context: unknown) => React.ReactNode
  render(cell({ getValue: () => ({
    displayText: 'qwen25-15b',
    endpoint: 'https://model.example',
  }) }))

  expect(screen.getByText('qwen25-15b')).toBeInTheDocument()
  expect(screen.queryByText('https://model.example')).not.toBeInTheDocument()
  expect(screen.queryByText('Endpoint:')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/pages/ListApps/table/listAppsColumns.test.tsx`

Expected: FAIL because the current name cell renders the endpoint link.

- [ ] **Step 3: Write minimal implementation**

```tsx
helper.accessor('name', {
  cell: (info) => (
    <span className="truncate overflow-hidden text-sm whitespace-nowrap">
      {info.getValue().displayText}
    </span>
  ),
  header: '名称',
})
```

Change the other column headers to `状态`、`副本数`、`类型`、`最近部署` and render replicas as `{min} / {max}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/pages/ListApps/table/listAppsColumns.test.tsx`

Expected: PASS with the endpoint absent from the name cell.

- [ ] **Step 5: Commit**

```bash
git add flyte_console/src/components/pages/ListApps/table/listAppsColumns.tsx flyte_console/src/components/pages/ListApps/table/listAppsColumns.test.tsx
git commit -m "fix(console): simplify Apps list name column"
```

### Task 2: 中文化页面、状态与操作菜单

**Files:**
- Modify: `flyte_console/src/components/pages/ListApps/Main.tsx`
- Modify: `flyte_console/src/components/pages/ListApps/components/ListAppsSearch.tsx`
- Modify: `flyte_console/src/components/pages/ListApps/components/AppStatusBadge.tsx`
- Modify: `flyte_console/src/components/pages/ListApps/table/ListAppsOverflowActions.tsx`
- Modify: `flyte_console/src/components/pages/ListApps/Main.test.tsx`
- Modify: `flyte_console/src/components/pages/ListApps/table/ListAppsOverflowActions.test.tsx`

**Interfaces:**
- Consumes: `App` metadata, ingress URL, deployment status and existing start/stop mutations.
- Produces: 全部页面固定文案使用简体中文，保留原有路由、菜单 id 与 clipboard 写入值。

- [ ] **Step 1: Write the failing tests**

```tsx
expect(screen.getByRole('heading', { name: '应用' })).toBeInTheDocument()
expect(screen.getByRole('link', { name: '创建模型应用' })).toHaveAttribute(
  'href',
  '/v2/domain/development/project/flytesnacks/apps/create',
)

expect(screen.getByRole('button', { name: '查看应用详情' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '复制访问地址' })).toBeInTheDocument()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/pages/ListApps/Main.test.tsx src/components/pages/ListApps/table/ListAppsOverflowActions.test.tsx`

Expected: FAIL because the existing menu and page title use English labels.

- [ ] **Step 3: Write minimal implementation**

```tsx
<h1 className="text-xl font-medium">应用</h1>
<SearchBar placeholder="搜索应用" ... />
{ id: 'app-details', label: '查看应用详情', onClick: ... }
{ id: 'copy-endpoint', label: '复制访问地址', onClick: ... }
```

Translate the fixed status strings to `运行中`、`已分配`、`部署中`、`失败`、`等待中`、`缩容中`、`扩容中`、`已停止`、`未启用` and `未指定`; translate start/stop, edit and copy-name menu labels without changing their ids or callbacks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/pages/ListApps/Main.test.tsx src/components/pages/ListApps/table/ListAppsOverflowActions.test.tsx`

Expected: PASS with Chinese controls and unchanged navigation behavior.

- [ ] **Step 5: Commit**

```bash
git add flyte_console/src/components/pages/ListApps/Main.tsx flyte_console/src/components/pages/ListApps/components/ListAppsSearch.tsx flyte_console/src/components/pages/ListApps/components/AppStatusBadge.tsx flyte_console/src/components/pages/ListApps/table/ListAppsOverflowActions.tsx flyte_console/src/components/pages/ListApps/Main.test.tsx flyte_console/src/components/pages/ListApps/table/ListAppsOverflowActions.test.tsx
git commit -m "fix(console): localize Apps list controls"
```

### Task 3: 全量验证、推送与远程部署

**Files:**
- Modify: none

**Interfaces:**
- Consumes: `origin/main` 上已提交的前端改动与远程 `/opt/aiops-flyte2` 检出。
- Produces: 使用新镜像运行的 `flyte-console-extracted` 部署，以及可访问的 Apps 页面。

- [ ] **Step 1: Run local validation**

```bash
cd flyte_console
pnpm vitest run src/components/pages/ListApps
pnpm run build:prod
```

Expected: relevant tests and production build pass.

- [ ] **Step 2: Check the diff and commit state**

```bash
cd ..
git diff --check
git status --short
git log -2 --oneline
```

Expected: no unintended generated Monaco assets and no uncommitted source changes.

- [ ] **Step 3: Push committed changes**

```bash
git push origin main
```

Expected: `origin/main` contains both Apps list commits.

- [ ] **Step 4: Deploy from the remote checkout**

```bash
ssh aione-flyte2 'cd /opt/aiops-flyte2 && git pull --ff-only origin main && git log -1 --oneline'
cd /mnt/d/flyte-work
bash scripts/deploy-flyte-console-source.sh
```

Expected: remote checkout advances only via fast-forward pull and source-built frontend rollout completes.

- [ ] **Step 5: Verify the deployed UI**

```bash
curl -I http://172.19.66.218:30081/v2/projects
npx --yes --package @playwright/cli playwright-cli -s=flyte-console-verify open http://172.19.66.218:30081/v2/projects
npx --yes --package @playwright/cli playwright-cli -s=flyte-console-verify console error
npx --yes --package @playwright/cli playwright-cli -s=flyte-console-verify close
```

Expected: HTTP 200, no browser console errors, and the Apps list shows Chinese labels without an endpoint in the name column.
