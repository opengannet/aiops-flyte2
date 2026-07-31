# Cloud Storage Live Mount Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show whether each cloud storage PVC is referenced by a running Pod and replace the misleading namespace-based “挂载于” column with actual Pod names.

**Architecture:** Add one Console API route that lists running Pods once and returns storage-ID-to-Pod mappings for requested IDs. The client list page fetches this batch result after the CloudStorage RPC and renders live usage independently of the materialization status.

**Tech Stack:** Next.js App Router, TypeScript, Connect RPC, Kubernetes API, Vitest, React Testing Library.

## Global Constraints

- Creator values and creator rendering remain unchanged.
- A storage is “使用中” only when a `Running` Pod references its canonical `cs-<storage-id>` PVC.
- The former “挂载于” column is renamed “使用 Pod” and never displays the namespace.
- Kubernetes query failures render “未知”, not “未使用”.

---

### Task 1: Batch live mount API

**Files:**
- Create: `flyte_console/src/server/cloud-storage/live-mounts.ts`
- Create: `flyte_console/src/server/cloud-storage/live-mounts.test.ts`
- Create: `flyte_console/src/app/api/cloud-storages/mounts/route.ts`
- Create: `flyte_console/src/app/api/cloud-storages/mounts/route.test.ts`

**Interfaces:**
- Produces: `loadCloudStorageLiveMounts({ apiOrigin, namespace, token, ca, storageIds }): Promise<Record<string, string[]>>`
- HTTP: `POST /api/cloud-storages/mounts` with `{ storageIds: string[] }`, returning `{ status: 200, data: { mounts: Record<string, string[]> } }`.

- [ ] Write tests proving only Running Pod PVC references count, multiple Pod names are deduplicated/sorted, and invalid IDs return an empty list.
- [ ] Run the tests and verify they fail because the module and route do not exist.
- [ ] Implement one Kubernetes Pod list request, canonical PVC matching, request validation, and standard response envelopes.
- [ ] Run both test files and verify they pass.

### Task 2: Cloud storage list rendering

**Files:**
- Create: `flyte_console/src/components/pages/CloudStorage/ListPage.test.tsx`
- Modify: `flyte_console/src/components/pages/CloudStorage/ListPage.tsx`

**Interfaces:**
- Consumes: `POST /api/cloud-storages/mounts` response from Task 1.
- Produces: status text “使用中/未使用/未知” and “使用 Pod” cells with Pod names or `-`.

- [ ] Write a component test with three storages proving mounted, unused, and failed-query states; assert the “使用 Pod” heading and unchanged creator values.
- [ ] Run the component test and verify it fails on the existing “已挂载/挂载于” UI.
- [ ] Add mount state loading to `loadItems`, render the three status states, display comma-separated Pod names, and preserve creator output.
- [ ] Run the component test and verify it passes.

### Task 3: Verification and delivery

**Files:**
- Modify only generated-at-build files temporarily; restore them before commit.

- [ ] Run all Console Vitest tests.
- [ ] Run `tsc -p tsconfig.typecheck.json`.
- [ ] Run the production Next build and deployment script checks.
- [ ] Commit, push `main`, deploy with `scripts/deploy-flyte-console-source.sh`, and verify HTTP 200 plus the rendered list behavior.
