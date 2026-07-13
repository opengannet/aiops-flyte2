# Datasets CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build real project-scoped dataset CRUD backed by a Go Connect service and rendered in the Flyte Console.

**Architecture:** Add an AiOps `DatasetService` parallel to `CloudStorageService` and `CodeRepositoryService`. Persist dataset metadata in Postgres, generate Go/TS protobuf clients, mount the service in `runs/setup.go`, then add Console list/create/detail/edit pages that call the Connect RPC directly.

**Tech Stack:** Go, Connect RPC, protobuf/buf, sqlx/Postgres migrations, Next.js App Router, React, Vitest, pnpm.

---

## File Structure

- Create `flyteidl2/aione/dataset/dataset_definition.proto`: dataset identifier and entity definitions.
- Create `flyteidl2/aione/dataset/dataset_service.proto`: CRUD RPC contract.
- Generate `gen/go/flyteidl2/aione/dataset/**`: Go protobuf and Connect handlers.
- Generate `gen/ts/flyteidl2/aione/dataset/**` and copy the matching generated files into `flyte_console/gen/flyteidl2/aione/dataset/**`.
- Create `runs/migrations/sql/20260628120000_aione_datasets.sql`: metadata table and indexes.
- Create `runs/repository/models/dataset.go`: DB model and list input/result types.
- Create `runs/repository/interfaces/dataset.go`: repository interface.
- Create `runs/repository/impl/dataset.go`: SQL implementation.
- Create `runs/repository/impl/dataset_test.go`: repository tests.
- Modify `runs/repository/interfaces/repository.go` and `runs/repository/repository.go`: expose `DatasetRepo()`.
- Create `runs/aione/dataset/service.go`, `service_test.go`, and `setup.go`: service validation, mapping, setup.
- Modify `runs/setup.go`: mount the dataset service.
- Create `flyte_console/src/components/pages/Datasets/{ListPage,FormPage,DetailPage,utils}.tsx?`: dataset pages and helpers.
- Create `flyte_console/src/components/pages/Datasets/*.test.tsx`: focused UI tests.
- Create Next routes under `flyte_console/src/app/domain/[domain]/project/[project]/datasets/**/page.tsx`.
- Modify `flyte_console/src/components/NavPanel/NavItemConfigs.tsx` and test: add `数据集`.
- Modify `flyte_console/src/lib/uiText.ts` or adjacent UI text map: add `datasets` label if needed.

## Task 1: Protobuf Contract And Generation

**Files:**
- Create: `flyteidl2/aione/dataset/dataset_definition.proto`
- Create: `flyteidl2/aione/dataset/dataset_service.proto`
- Generate: `gen/go/flyteidl2/aione/dataset/**`
- Generate: `gen/ts/flyteidl2/aione/dataset/**`
- Create/copy: `flyte_console/gen/flyteidl2/aione/dataset/**`

- [ ] **Step 1: Add dataset proto definitions**

`dataset_definition.proto` must define:

```proto
syntax = "proto3";

package flyteidl2.aione.dataset;

import "buf/validate/validate.proto";
import "google/protobuf/timestamp.proto";

option go_package = "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/dataset";

message DatasetIdentifier {
  string org = 1 [(buf.validate.field).string.min_len = 1];
  string project = 2 [(buf.validate.field).string.min_len = 1];
  string domain = 3 [(buf.validate.field).string.min_len = 1];
  string id = 4 [(buf.validate.field).string.min_len = 1];
}

message Dataset {
  DatasetIdentifier id = 1 [(buf.validate.field).required = true];
  string name = 2 [(buf.validate.field).string = {min_len: 1, max_len: 128}];
  string description = 3 [(buf.validate.field).string.max_len = 255];
  string end_point = 4 [(buf.validate.field).string.min_len = 1];
  string port = 5 [(buf.validate.field).string.min_len = 1];
  string access_key = 6 [(buf.validate.field).string.min_len = 1];
  string secret_key = 7;
  string target_path = 8 [(buf.validate.field).string.min_len = 1];
  string bucket = 9 [(buf.validate.field).string.min_len = 1];
  string bucket_path = 10;
  string creator = 11;
  google.protobuf.Timestamp created_at = 12;
  google.protobuf.Timestamp updated_at = 13;
}
```

`dataset_service.proto` must define `DatasetService` with create, update, get, list, and delete methods using `common.ProjectIdentifier` and `common.ListRequest`.

- [ ] **Step 2: Generate Go and TypeScript protobuf output**

Run:

```powershell
cd D:\flyte-work
make buf-go
make buf-ts
```

Expected: new generated dataset files exist under `gen/go/flyteidl2/aione/dataset` and `gen/ts/flyteidl2/aione/dataset`.

- [ ] **Step 3: Copy generated TS into Console gen tree**

Run:

```powershell
Copy-Item -Recurse -Force D:\flyte-work\gen\ts\flyteidl2\aione\dataset D:\flyte-work\flyte_console\gen\flyteidl2\aione\dataset
```

Expected: Console imports can use `@/gen/flyteidl2/aione/dataset/dataset_service_pb`.

- [ ] **Step 4: Commit proto generated contract**

```powershell
git add flyteidl2/aione/dataset gen/go/flyteidl2/aione/dataset gen/ts/flyteidl2/aione/dataset flyte_console/gen/flyteidl2/aione/dataset
git commit -m "feat: add dataset protobuf contract"
```

## Task 2: Repository Persistence

**Files:**
- Create: `runs/migrations/sql/20260628120000_aione_datasets.sql`
- Create: `runs/repository/models/dataset.go`
- Create: `runs/repository/interfaces/dataset.go`
- Create: `runs/repository/impl/dataset_test.go`
- Create: `runs/repository/impl/dataset.go`
- Modify: `runs/repository/interfaces/repository.go`
- Modify: `runs/repository/repository.go`

- [ ] **Step 1: Write failing repository test**

Create `TestDatasetRepoCreateGetListUpdateAndDelete` that:

```go
repo := NewDatasetRepo(testDB)
key := models.DatasetKey{Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "ds-1"}
_ = repo.Delete(ctx, key)
require.NoError(t, repo.Create(ctx, &models.Dataset{DatasetKey: key, Name: "语音识别", CloudStorageID: "stg-1", FolderPath: "data/speech", Creator: "ljgong"}))
got, err := repo.Get(ctx, key)
require.NoError(t, err)
require.Equal(t, "语音识别", got.Name)
list, err := repo.List(ctx, models.DatasetListInput{Org: key.Org, Project: key.Project, Domain: key.Domain, Search: "语音", Limit: 20})
require.NoError(t, err)
require.Len(t, list.Items, 1)
got.Description = "updated"
got.ProjectPublic = true
require.NoError(t, repo.Update(ctx, got))
updated, err := repo.Get(ctx, key)
require.NoError(t, err)
require.True(t, updated.ProjectPublic)
require.NoError(t, repo.Delete(ctx, key))
_, err = repo.Get(ctx, key)
require.Error(t, err)
```

- [ ] **Step 2: Run repository test and verify it fails**

Run:

```powershell
go test ./runs/repository/impl -run Dataset -count=1
```

Expected: FAIL because `NewDatasetRepo` and dataset types do not exist.

- [ ] **Step 3: Add migration, model, interface, and SQL implementation**

Implement a table `aione_datasets` with project-scoped primary key and CRUD queries mirroring `code_repository.go`, with search over lowercased `name` and `description`.

- [ ] **Step 4: Expose `DatasetRepo()` on the root repository**

Add the repository field, constructor wiring, and interface method.

- [ ] **Step 5: Run repository test and verify it passes**

Run:

```powershell
go test ./runs/repository/impl -run Dataset -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```powershell
git add runs/migrations/sql/20260628120000_aione_datasets.sql runs/repository/models/dataset.go runs/repository/interfaces/dataset.go runs/repository/impl/dataset.go runs/repository/impl/dataset_test.go runs/repository/interfaces/repository.go runs/repository/repository.go
git commit -m "feat: persist datasets"
```

## Task 3: Backend Dataset Service

**Files:**
- Create: `runs/aione/dataset/service_test.go`
- Create: `runs/aione/dataset/service.go`
- Create: `runs/aione/dataset/setup.go`
- Modify: `runs/setup.go`

- [ ] **Step 1: Write failing service tests**

Tests must cover:

- create trims and normalizes `bucket_path` from `/data/speech/` to `data/speech/`
- create rejects missing name
- create rejects missing object storage fields
- create encrypts `secret_key` before persistence and does not return plaintext
- update with empty `secret_key` keeps the existing encrypted value
- list supports search
- delete removes metadata

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```powershell
go test ./runs/aione/dataset -count=1
```

Expected: FAIL because package implementation does not exist.

- [ ] **Step 3: Implement service**

Implement validation with exact user-facing errors:

- `project is required`
- `name is required`
- `name must be at most 128 characters`
- `description must be at most 255 characters`
- `cloud storage id is required`
- `folder path cannot contain .., backslash, or URL scheme`
- `project public datasets cannot be made private`

Use `connect.CodeInvalidArgument`, `connect.CodeNotFound`, and `connect.CodeInternal` consistently with nearby services.

- [ ] **Step 4: Mount service in setup**

Create `runs/aione/dataset/setup.go` with `datasetconnect.NewDatasetServiceHandler`, then call it from `runs/setup.go`.

- [ ] **Step 5: Run service tests and setup compile tests**

Run:

```powershell
go test ./runs/aione/dataset -count=1
go test ./runs -run TestNonExistent -count=0
```

Expected: PASS or compile-only success for `./runs`.

- [ ] **Step 6: Commit backend service**

```powershell
git add runs/aione/dataset runs/setup.go
git commit -m "feat: add dataset service"
```

## Task 4: Console Dataset Pages And Navigation

**Files:**
- Create: `flyte_console/src/components/pages/Datasets/utils.ts`
- Create: `flyte_console/src/components/pages/Datasets/ListPage.tsx`
- Create: `flyte_console/src/components/pages/Datasets/FormPage.tsx`
- Create: `flyte_console/src/components/pages/Datasets/DetailPage.tsx`
- Create: `flyte_console/src/components/pages/Datasets/*.test.tsx`
- Create: dataset route `page.tsx` files under `flyte_console/src/app/domain/[domain]/project/[project]/datasets/**`
- Modify: `flyte_console/src/components/NavPanel/NavItemConfigs.tsx`
- Modify: `flyte_console/src/components/NavPanel/NavItemConfigs.test.tsx`
- Modify: `flyte_console/src/lib/uiText.ts`

- [ ] **Step 1: Write failing UI helper and nav tests**

Add tests for `buildDatasetDetailHref`, `normalizeDatasetFolderPath`, invalid path detection, and nav order including `datasets`.

- [ ] **Step 2: Run UI tests and verify they fail**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm.cmd exec vitest run "src/components/pages/Datasets/*.test.ts*" "src/components/NavPanel/NavItemConfigs.test.tsx"
```

Expected: FAIL because Dataset helpers and nav label do not exist.

- [ ] **Step 3: Implement helpers, pages, routes, and navigation**

List page must match the screenshot columns and actions. Form page must load cloud storages, support create/edit, lock public datasets as public, and redirect after save. Detail page must show basic metadata and support refresh/edit/delete.

- [ ] **Step 4: Run UI tests and typecheck**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm.cmd exec vitest run "src/components/pages/Datasets/*.test.ts*" "src/components/NavPanel/NavItemConfigs.test.tsx"
pnpm.cmd exec tsc --project tsconfig.typecheck.json --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit Console implementation**

```powershell
git add flyte_console/src/components/pages/Datasets flyte_console/src/app/domain/[domain]/project/[project]/datasets flyte_console/src/components/NavPanel/NavItemConfigs.tsx flyte_console/src/components/NavPanel/NavItemConfigs.test.tsx flyte_console/src/lib/uiText.ts
git commit -m "feat: add dataset console pages"
```

## Task 5: Final Verification And Deployment

**Files:**
- All files touched above.

- [ ] **Step 1: Run targeted backend tests**

```powershell
cd D:\flyte-work
go test ./runs/repository/impl -run Dataset -count=1
go test ./runs/aione/dataset -count=1
go test ./runs -run TestNonExistent -count=0
```

- [ ] **Step 2: Run targeted frontend tests and typecheck**

```powershell
cd D:\flyte-work\flyte_console
pnpm.cmd exec vitest run "src/components/pages/Datasets/*.test.ts*" "src/components/NavPanel/NavItemConfigs.test.tsx"
pnpm.cmd exec tsc --project tsconfig.typecheck.json --noEmit
```

- [ ] **Step 3: Run repo checks**

```powershell
cd D:\flyte-work
git diff --check
git status --short
```

- [ ] **Step 4: Push and deploy**

After tests pass, push `main`, then on `aione-flyte2` use only `git pull --ff-only origin main`. Because this changes backend and frontend, deploy backend and source-built console following root `AGENTS.md`.

- [ ] **Step 5: Browser/live verification**

Verify:

- `http://172.19.66.218:30081/v2/domain/development/project/<project>/datasets` loads.
- Dataset create succeeds with an existing cloud storage.
- List shows the dataset.
- Edit updates description/path/public flag.
- Delete removes the row.
