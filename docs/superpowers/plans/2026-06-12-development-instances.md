# Development Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a Flyte Console "开发实例" workflow that creates, stops, and deletes SSH workspace pods.

**Architecture:** Represent development instances as Flyte `ssh_workspace` runs. Extend the existing plugin cleanup for Ingress, add Console utilities and pages for listing/creating instances, and use a Console server route for explicit Kubernetes resource cleanup while preserving PVCs.

**Tech Stack:** Go plugin code, Kubernetes client-go/controller-runtime, Next.js App Router, React Query, Connect RPC, Vitest, Playwright CLI.

---

### Task 1: Backend Cleanup Support

**Files:**
- Modify: `flyteplugins/aione/sshworkspace/resources.go`
- Modify: `flyteplugins/aione/sshworkspace/plugin.go`
- Modify: `flyteplugins/aione/sshworkspace/resources_test.go`
- Modify: `flyteplugins/aione/sshworkspace/plugin_test.go`

- [ ] **Step 1: Add failing tests for Ingress cleanup**

Add tests that expect `BuildResources` to include an optional Ingress when requested and expect `Abort` to delete the Ingress while retaining PVC.

- [ ] **Step 2: Run backend tests and verify red**

Run: `go test ./flyteplugins/aione/sshworkspace -count=1`

Expected: FAIL because Ingress resources are not yet modeled or deleted.

- [ ] **Step 3: Implement Ingress resource support**

Add a plugin custom field such as `ingressHost` or `ingressEnabled` only if needed. Always make `Abort` delete matching Ingress objects by workspace labels so existing resources are cleaned even if creation did not happen through the plugin.

- [ ] **Step 4: Run backend tests and verify green**

Run: `go test ./flyteplugins/aione/sshworkspace -count=1`

Expected: PASS.

### Task 2: Development Instance Utilities

**Files:**
- Create: `flyte_console/src/components/pages/DevelopmentInstances/utils.ts`
- Create: `flyte_console/src/components/pages/DevelopmentInstances/utils.test.ts`

- [ ] **Step 1: Add failing utility tests**

Cover NodePort allocation, `ssh_workspace` task payload construction, run-to-row mapping, resource summary formatting, SSH command formatting, and deleted marker detection.

- [ ] **Step 2: Run frontend unit tests and verify red**

Run: `cd flyte_console; pnpm test:unit src/components/pages/DevelopmentInstances/utils.test.ts`

Expected: FAIL because utilities do not exist yet.

- [ ] **Step 3: Implement utilities**

Create pure functions for:

- `allocateNodePort(existingPorts, start, end)`
- `buildDevelopmentInstanceTaskSpec(form, scope)`
- `buildCreateDevelopmentInstanceRequest(form, scope, existingPorts)`
- `developmentInstanceFromRun(run)`
- `isDevelopmentInstanceDeleted(run)`
- `formatSshCommand({ host, port, user })`

- [ ] **Step 4: Run frontend unit tests and verify green**

Run: `cd flyte_console; pnpm test:unit src/components/pages/DevelopmentInstances/utils.test.ts`

Expected: PASS.

### Task 3: Console Cleanup Route

**Files:**
- Create: `flyte_console/src/app/api/development-instances/delete/route.ts`
- Create: `flyte_console/src/app/api/development-instances/delete/route.test.ts`

- [ ] **Step 1: Add failing route tests**

Test that the route rejects invalid payloads and builds Kubernetes API delete requests for StatefulSet, Pod, Secret, Service, and Ingress label selectors while excluding PVC.

- [ ] **Step 2: Run route tests and verify red**

Run: `cd flyte_console; pnpm test:unit src/app/api/development-instances/delete/route.test.ts`

Expected: FAIL because the route does not exist yet.

- [ ] **Step 3: Implement route**

Implement a Node runtime route handler that uses the in-cluster service account token and Kubernetes API server env vars. Delete by label selector:

`flyte.org/run-name=<run>,flyte.org/project=<project>,flyte.org/domain=<domain>,flyte.org/org=<org>`

Delete resource kinds:

- `apps/v1/statefulsets`
- `v1/pods`
- `v1/secrets`
- `v1/services`
- `networking.k8s.io/v1/ingresses`

- [ ] **Step 4: Run route tests and verify green**

Run: `cd flyte_console; pnpm test:unit src/app/api/development-instances/delete/route.test.ts`

Expected: PASS.

### Task 4: Console UI

**Files:**
- Modify: `flyte_console/src/lib/uiText.ts`
- Modify: `flyte_console/src/components/NavPanel/NavItemConfigs.tsx`
- Create: `flyte_console/src/app/domain/[domain]/project/[project]/development-instances/page.tsx`
- Create: `flyte_console/src/app/domain/[domain]/project/[project]/development-instances/create/page.tsx`
- Create: `flyte_console/src/components/pages/DevelopmentInstances/ListPage.tsx`
- Create: `flyte_console/src/components/pages/DevelopmentInstances/CreatePage.tsx`

- [ ] **Step 1: Add navigation text and route**

Add `developmentInstances: '开发实例'` and a nav link after Runs.

- [ ] **Step 2: Build the list page**

Use `useWatchRuns` with task name filter `ssh_workspace`. Render a screenshot-matching toolbar, search, table, selection, stop/delete/start buttons, refresh, and create link.

- [ ] **Step 3: Build the create page**

Render the basic info and image sections from the screenshot, with controlled fields and validation. On submit, call `RunService.CreateRun`, then route back to the list.

- [ ] **Step 4: Wire stop and delete**

Stop calls `RunService.AbortRun`. Delete calls abort and the cleanup route; deleted rows are removed from the current list view after success.

- [ ] **Step 5: Run targeted frontend tests**

Run: `cd flyte_console; pnpm test:unit src/components/pages/DevelopmentInstances/utils.test.ts src/app/api/development-instances/delete/route.test.ts`

Expected: PASS.

### Task 5: Kubernetes Manifest Permissions

**Files:**
- Modify: `deploy/ui/flyte-console-extracted.yaml`

- [ ] **Step 1: Add service account and RBAC**

Grant the source-built console permission in namespace `flyte` to delete and list:

- pods
- secrets
- services
- statefulsets
- ingresses

- [ ] **Step 2: Attach service account**

Set `serviceAccountName` on `flyte-console-extracted`.

### Task 6: Verification and Deployment

**Files:**
- No source changes expected unless verification finds defects.

- [ ] **Step 1: Run backend checks**

Run:

```powershell
go test ./flyteplugins/aione/sshworkspace -count=1
go test ./executor/pkg/plugin/k8s -count=1
```

- [ ] **Step 2: Run frontend checks**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm test:unit src/components/pages/DevelopmentInstances/utils.test.ts src/app/api/development-instances/delete/route.test.ts
pnpm run build:prod
```

- [ ] **Step 3: Deploy backend**

Run backend deployment/update from `D:\flyte-work` per `AGENTS.md`, including chart update if manifests changed.

- [ ] **Step 4: Deploy frontend**

Build the remote source console image, import it into k3s, apply `deploy/ui/flyte-console-extracted.yaml`, restart `flyte-console-extracted`, and verify `curl -I http://172.19.66.218:30081/v2/projects` returns HTTP 200.

- [ ] **Step 5: Playwright verification**

Use the Playwright CLI to open the deployed list and create pages, verify the menu and page title, check console errors and requests, and save screenshots under `output/playwright/`.
