# Code Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-scoped code repository configuration and let users select repositories to download when creating development instances or creating/editing training tasks.

**Architecture:** Implement code repositories as an AiOps extension beside existing `cloudstorage`: protobuf and Connect service under `flyteidl2/aione/coderepository`, persistence under `runs/repository`, and Console pages under `CodeRepositories`. Selected repositories flow into `ssh_workspace` and `training_task` custom payloads as `codeRepositories`; runtime plugins create token Secrets and init containers that download GitLab archives before the main container starts.

**Tech Stack:** Go, ConnectRPC/protobuf, sqlx/PostgreSQL migrations, Kubernetes core/batch apps APIs, Next.js App Router, React, Heroicons, Vitest, buf, mockery, Playwright CLI.

---

## Baseline

Run these before implementation:

```powershell
cd D:\flyte-work
go test ./runs/aione/cloudstorage ./runs/repository/impl ./runs/service ./flyteplugins/aione/sshworkspace ./flyteplugins/aione/trainingtask -count=1
```

Expected: command exits `0`. If a pre-existing failure appears, record it before editing and keep new tests scoped to the code repository feature.

```powershell
cd D:\flyte-work\flyte_console
pnpm vitest src/components/pages/DevelopmentInstances/utils.test.ts src/components/pages/TrainingTasks/utils.test.ts --run
```

Expected: command exits `0`.

## File Structure

Create:

- `flyteidl2/aione/coderepository/code_repository_definition.proto`: identifiers, repository record, selected mount message.
- `flyteidl2/aione/coderepository/code_repository_service.proto`: CRUD/list service and input messages.
- `runs/migrations/sql/20260615170000_aione_code_repositories.sql`: repository table.
- `runs/repository/models/code_repository.go`: DB model, list input/result, training task selection JSON helpers.
- `runs/repository/interfaces/code_repository.go`: repository interface.
- `runs/repository/impl/code_repository.go`: sqlx CRUD/list implementation.
- `runs/repository/impl/code_repository_test.go`: persistence tests.
- `runs/aione/coderepository/service.go`: Connect service implementation and validation.
- `runs/aione/coderepository/service_test.go`: API validation and token masking tests.
- `runs/aione/coderepository/setup.go`: service mount helper.
- `flyteplugins/aione/coderepository/downloader.go`: shared config parsing and init container/secret helpers.
- `flyteplugins/aione/coderepository/downloader_test.go`: runtime helper tests.
- `flyte_console/src/components/pages/CodeRepositories/FormPage.tsx`: screenshot-matched editable repository page.
- `flyte_console/src/components/pages/CodeRepositories/utils.ts`: row validation and request helpers.
- `flyte_console/src/components/pages/CodeRepositories/utils.test.ts`: UI helper tests.
- `flyte_console/src/app/domain/[domain]/project/[project]/code-repositories/page.tsx`: route.

Modify:

- Generated output under `gen/go/flyteidl2/aione/coderepository`, `gen/ts/flyteidl2/aione/coderepository`, and `flyte_console/gen/flyteidl2/aione/coderepository`.
- `runs/repository/interfaces/repository.go`: add `CodeRepositoryRepo()`.
- `runs/repository/repository.go`: construct and expose code repository repo.
- `runs/setup.go`: mount `CodeRepositoryService`.
- `runs/repository/models/training_task.go`: add `CodeRepositoryMountsJSON`, `CodeRepositoryMounts`, encode/decode helpers.
- `runs/repository/impl/training_task.go`: persist `code_repository_mounts_json`.
- `runs/migrations/sql/20260615170100_training_task_code_repositories.sql`: add training task selected code repository JSON column.
- `runs/service/training_task_service.go`: accept selected code repositories, resolve token/repo data on start.
- `runs/service/training_task_task_spec.go`: include resolved repositories in `TaskTemplate.custom`.
- `flyteidl2/trainingtask/*.proto`: import code repository definition and add repeated selected repositories.
- `flyteplugins/aione/sshworkspace/config.go`: parse `codeRepositories`.
- `flyteplugins/aione/sshworkspace/resources.go`: add Secret/init container/volume mounts.
- `flyteplugins/aione/sshworkspace/resources_test.go`: cover code repository runtime resources.
- `flyteplugins/aione/trainingtask/config.go`: parse `codeRepositories`.
- `flyteplugins/aione/trainingtask/resources.go`: add Secret/init container/volume mounts.
- `flyteplugins/aione/trainingtask/resources_test.go`: cover code repository runtime resources.
- `flyte_console/src/lib/uiText.ts`: add `codeRepositories: "代码库"`.
- `flyte_console/src/components/NavPanel/NavItemConfigs.tsx`: add left-nav link.
- `flyte_console/src/components/pages/DevelopmentInstances/utils.ts`: add selected code repositories to request custom payload.
- `flyte_console/src/components/pages/DevelopmentInstances/utils.test.ts`: cover selected repositories.
- `flyte_console/src/components/pages/DevelopmentInstances/CreatePage.tsx`: load/list/select repositories.
- `flyte_console/src/components/pages/TrainingTasks/utils.ts`: validate and build selected repositories.
- `flyte_console/src/components/pages/TrainingTasks/utils.test.ts`: cover selected repositories.
- `flyte_console/src/components/pages/TrainingTasks/FormPage.tsx`: load/list/select repositories.

Do not manually edit generated files except through the generation commands.

## Task 1: Define Code Repository Protos

**Files:**
- Create: `flyteidl2/aione/coderepository/code_repository_definition.proto`
- Create: `flyteidl2/aione/coderepository/code_repository_service.proto`
- Modify: `flyteidl2/trainingtask/training_task_definition.proto`
- Modify: `flyteidl2/trainingtask/training_task_service.proto`
- Generated: `gen/go/flyteidl2/aione/coderepository/*`
- Generated: `gen/ts/flyteidl2/aione/coderepository/*`
- Generated: `flyte_console/gen/flyteidl2/aione/coderepository/*`

- [ ] **Step 1: Write proto definitions**

Create `flyteidl2/aione/coderepository/code_repository_definition.proto`:

```proto
syntax = "proto3";

package flyteidl2.aione.coderepository;

import "buf/validate/validate.proto";
import "google/protobuf/timestamp.proto";

option go_package = "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository";

message CodeRepositoryIdentifier {
  string org = 1 [(buf.validate.field).string.min_len = 1];
  string project = 2 [(buf.validate.field).string.min_len = 1];
  string domain = 3 [(buf.validate.field).string.min_len = 1];
  string id = 4 [(buf.validate.field).string.min_len = 1];
}

message CodeRepository {
  CodeRepositoryIdentifier id = 1 [(buf.validate.field).required = true];
  string repo_url = 2 [(buf.validate.field).string.min_len = 1];
  string branch = 3 [(buf.validate.field).string.min_len = 1];
  string mount_path = 4 [(buf.validate.field).string.min_len = 1];
  string token = 5;
  string creator = 6;
  google.protobuf.Timestamp created_at = 7;
  google.protobuf.Timestamp updated_at = 8;
}

message CodeRepositoryMount {
  string code_repository_id = 1 [(buf.validate.field).string.min_len = 1];
  string mount_path = 2 [(buf.validate.field).string.min_len = 1];
}
```

Create `flyteidl2/aione/coderepository/code_repository_service.proto`:

```proto
syntax = "proto3";

package flyteidl2.aione.coderepository;

import "flyteidl2/aione/coderepository/code_repository_definition.proto";
import "flyteidl2/common/identifier.proto";
import "flyteidl2/common/list.proto";

option go_package = "github.com/flyteorg/flyte/v2/gen/go/flyteidl2/aione/coderepository";

service CodeRepositoryService {
  rpc CreateCodeRepository(CreateCodeRepositoryRequest) returns (CreateCodeRepositoryResponse) {}
  rpc UpdateCodeRepository(UpdateCodeRepositoryRequest) returns (UpdateCodeRepositoryResponse) {}
  rpc GetCodeRepository(GetCodeRepositoryRequest) returns (GetCodeRepositoryResponse) {
    option idempotency_level = NO_SIDE_EFFECTS;
  }
  rpc ListCodeRepositories(ListCodeRepositoriesRequest) returns (ListCodeRepositoriesResponse) {
    option idempotency_level = NO_SIDE_EFFECTS;
  }
  rpc DeleteCodeRepository(DeleteCodeRepositoryRequest) returns (DeleteCodeRepositoryResponse) {}
}

message CodeRepositoryInput {
  string repo_url = 1;
  string branch = 2;
  string mount_path = 3;
  string token = 4;
}

message CreateCodeRepositoryRequest {
  common.ProjectIdentifier project = 1;
  CodeRepositoryInput code_repository = 2;
  string creator = 3;
}

message CreateCodeRepositoryResponse {
  CodeRepository code_repository = 1;
}

message UpdateCodeRepositoryRequest {
  CodeRepositoryIdentifier id = 1;
  CodeRepositoryInput code_repository = 2;
}

message UpdateCodeRepositoryResponse {
  CodeRepository code_repository = 1;
}

message GetCodeRepositoryRequest {
  CodeRepositoryIdentifier id = 1;
}

message GetCodeRepositoryResponse {
  CodeRepository code_repository = 1;
}

message ListCodeRepositoriesRequest {
  common.ListRequest request = 1;
  common.ProjectIdentifier project = 2;
}

message ListCodeRepositoriesResponse {
  repeated CodeRepository code_repositories = 1;
  string token = 2;
  uint32 total = 3;
}

message DeleteCodeRepositoryRequest {
  CodeRepositoryIdentifier id = 1;
}

message DeleteCodeRepositoryResponse {}
```

Modify `flyteidl2/trainingtask/training_task_definition.proto`:

```proto
import "flyteidl2/aione/coderepository/code_repository_definition.proto";
```

Add to `TrainingTask` with the next available field number:

```proto
repeated aione.coderepository.CodeRepositoryMount code_repository_mounts = 20;
```

Modify `flyteidl2/trainingtask/training_task_service.proto`:

```proto
import "flyteidl2/aione/coderepository/code_repository_definition.proto";
```

Add to `TrainingTaskInput` with the next available field number:

```proto
repeated aione.coderepository.CodeRepositoryMount code_repository_mounts = 11;
```

- [ ] **Step 2: Generate Go and TypeScript**

Run:

```powershell
cd D:\flyte-work
buf generate --template buf.gen.go.yaml --path flyteidl2/aione/coderepository --path flyteidl2/trainingtask
buf generate --template buf.gen.ts.yaml --path flyteidl2/aione/coderepository --path flyteidl2/trainingtask
Copy-Item -Recurse -Force gen\ts\flyteidl2\aione\coderepository flyte_console\gen\flyteidl2\aione\
Copy-Item -Recurse -Force gen\ts\flyteidl2\trainingtask flyte_console\gen\flyteidl2\
```

Expected: generated Go and TS files include `CodeRepositoryService`, `CodeRepository`, and `CodeRepositoryMount`.

- [ ] **Step 3: Compile generated packages**

Run:

```powershell
cd D:\flyte-work
go test ./gen/go/flyteidl2/aione/coderepository/... ./gen/go/flyteidl2/trainingtask/... -count=1
```

Expected: PASS.

- [ ] **Step 4: Commit proto generation**

Run:

```powershell
cd D:\flyte-work
git add flyteidl2/aione/coderepository flyteidl2/trainingtask gen/go/flyteidl2/aione/coderepository gen/go/flyteidl2/trainingtask gen/ts/flyteidl2/aione/coderepository gen/ts/flyteidl2/trainingtask flyte_console/gen/flyteidl2/aione/coderepository flyte_console/gen/flyteidl2/trainingtask
git commit -m "Add code repository API definitions"
```

Expected: commit succeeds.

## Task 2: Persist Project Code Repositories

**Files:**
- Create: `runs/migrations/sql/20260615170000_aione_code_repositories.sql`
- Create: `runs/repository/models/code_repository.go`
- Create: `runs/repository/interfaces/code_repository.go`
- Create: `runs/repository/impl/code_repository_test.go`
- Create: `runs/repository/impl/code_repository.go`
- Modify: `runs/repository/interfaces/repository.go`
- Modify: `runs/repository/repository.go`

- [ ] **Step 1: Write failing repository test**

Create `runs/repository/impl/code_repository_test.go`:

```go
package impl

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

func TestCodeRepositoryRepoCreateGetUpdateListDelete(t *testing.T) {
	ctx := context.Background()
	repo := NewCodeRepositoryRepo(testDB)
	key := models.CodeRepositoryKey{
		Org: "testorg", Project: "flytesnacks", Domain: "development", ID: "repo-1",
	}
	_ = repo.Delete(ctx, key)

	require.NoError(t, repo.Create(ctx, &models.CodeRepository{
		CodeRepositoryKey: key,
		RepoURL: "https://git.fzyun.io/serverless/aione.git",
		Branch: "main",
		MountPath: "/workspace/aione",
		AccessToken: "secret-token",
		Creator: "ljgong",
	}))

	got, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "main", got.Branch)
	require.Equal(t, "secret-token", got.AccessToken)

	got.Branch = "dev"
	got.AccessToken = "new-secret"
	require.NoError(t, repo.Update(ctx, got))
	updated, err := repo.Get(ctx, key)
	require.NoError(t, err)
	require.Equal(t, "dev", updated.Branch)
	require.Equal(t, "new-secret", updated.AccessToken)

	list, err := repo.List(ctx, models.CodeRepositoryListInput{
		Org: key.Org, Project: key.Project, Domain: key.Domain, Search: "aione", Limit: 20,
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 1)
	require.Equal(t, uint32(1), list.Total)

	require.NoError(t, repo.Delete(ctx, key))
	_, err = repo.Get(ctx, key)
	require.Error(t, err)
}
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
cd D:\flyte-work
go test ./runs/repository/impl -run TestCodeRepositoryRepoCreateGetUpdateListDelete -count=1
```

Expected: FAIL because `NewCodeRepositoryRepo` and model types do not exist.

- [ ] **Step 3: Implement migration and model**

Create migration:

```sql
CREATE TABLE IF NOT EXISTS aione_code_repositories (
  id TEXT NOT NULL,
  org TEXT NOT NULL,
  project TEXT NOT NULL,
  domain TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL,
  mount_path TEXT NOT NULL,
  access_token TEXT NOT NULL DEFAULT '',
  creator TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org, project, domain, id)
);

CREATE INDEX IF NOT EXISTS idx_aione_code_repositories_project_domain_created_at
  ON aione_code_repositories (org, project, domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_aione_code_repositories_project_domain_repo_url
  ON aione_code_repositories (org, project, domain, repo_url);
```

Create `runs/repository/models/code_repository.go`:

```go
package models

import "time"

type CodeRepositoryKey struct {
	Org     string `db:"org"`
	Project string `db:"project"`
	Domain  string `db:"domain"`
	ID      string `db:"id"`
}

type CodeRepository struct {
	CodeRepositoryKey
	RepoURL     string    `db:"repo_url"`
	Branch      string    `db:"branch"`
	MountPath   string    `db:"mount_path"`
	AccessToken string    `db:"access_token"`
	Creator     string    `db:"creator"`
	CreatedAt   time.Time `db:"created_at"`
	UpdatedAt   time.Time `db:"updated_at"`
}

type CodeRepositoryListInput struct {
	Org     string
	Project string
	Domain  string
	Search  string
	Limit   uint32
	Offset  uint32
}

type CodeRepositoryListResult struct {
	Items []*CodeRepository
	Total uint32
}
```

- [ ] **Step 4: Implement interface and repo**

Create `runs/repository/interfaces/code_repository.go`:

```go
package interfaces

import (
	"context"

	"github.com/flyteorg/flyte/v2/runs/repository/models"
)

type CodeRepositoryRepo interface {
	Create(ctx context.Context, repo *models.CodeRepository) error
	Get(ctx context.Context, key models.CodeRepositoryKey) (*models.CodeRepository, error)
	Update(ctx context.Context, repo *models.CodeRepository) error
	Delete(ctx context.Context, key models.CodeRepositoryKey) error
	List(ctx context.Context, input models.CodeRepositoryListInput) (*models.CodeRepositoryListResult, error)
}
```

Implement `runs/repository/impl/code_repository.go` with the same sqlx style as `cloud_storage.go`. The `Update` statement must set `repo_url`, `branch`, `mount_path`, `access_token`, and `updated_at = NOW()`. `List` filters by `LOWER(repo_url) LIKE $n OR LOWER(branch) LIKE $n`.

Modify `runs/repository/interfaces/repository.go`:

```go
CodeRepositoryRepo() CodeRepositoryRepo
```

Modify `runs/repository/repository.go` to hold and return `impl.NewCodeRepositoryRepo(db)`.

- [ ] **Step 5: Run repository test to verify GREEN**

Run:

```powershell
cd D:\flyte-work
go test ./runs/repository/impl -run TestCodeRepositoryRepoCreateGetUpdateListDelete -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit persistence**

Run:

```powershell
cd D:\flyte-work
git add runs/migrations/sql/20260615170000_aione_code_repositories.sql runs/repository/models/code_repository.go runs/repository/interfaces/code_repository.go runs/repository/impl/code_repository.go runs/repository/impl/code_repository_test.go runs/repository/interfaces/repository.go runs/repository/repository.go
git commit -m "Add code repository persistence"
```

Expected: commit succeeds.

## Task 3: Add Code Repository Connect Service

**Files:**
- Create: `runs/aione/coderepository/service_test.go`
- Create: `runs/aione/coderepository/service.go`
- Create: `runs/aione/coderepository/setup.go`
- Modify: `runs/setup.go`

- [ ] **Step 1: Write failing service tests**

Create tests:

```go
func TestCodeRepositoryServiceRejectsInvalidURL(t *testing.T) {
	svc := NewService(newFakeCodeRepositoryRepo())
	_, err := svc.CreateCodeRepository(context.Background(), connect.NewRequest(&coderepositorypb.CreateCodeRepositoryRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		CodeRepository: &coderepositorypb.CodeRepositoryInput{
			RepoUrl: "git@git.fzyun.io:serverless/aione.git",
			Branch: "main",
			MountPath: "/workspace/aione",
		},
	}))
	require.Error(t, err)
	require.Contains(t, err.Error(), "repo url")
}

func TestCodeRepositoryServiceMasksTokenInResponse(t *testing.T) {
	repo := newFakeCodeRepositoryRepo()
	svc := NewService(repo)
	resp, err := svc.CreateCodeRepository(context.Background(), connect.NewRequest(&coderepositorypb.CreateCodeRepositoryRequest{
		Project: &common.ProjectIdentifier{Organization: "testorg", Name: "flytesnacks", Domain: "development"},
		Creator: "ljgong",
		CodeRepository: &coderepositorypb.CodeRepositoryInput{
			RepoUrl: "https://git.fzyun.io/serverless/aione.git",
			Branch: "main",
			MountPath: "/workspace/aione",
			Token: "secret-token",
		},
	}))
	require.NoError(t, err)
	require.Empty(t, resp.Msg.GetCodeRepository().GetToken())
	require.Equal(t, "secret-token", repo.items[resp.Msg.GetCodeRepository().GetId().GetId()].AccessToken)
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
cd D:\flyte-work
go test ./runs/aione/coderepository -count=1
```

Expected: FAIL because package does not exist.

- [ ] **Step 3: Implement service**

`buildModel` validation rules:

```go
if !strings.HasPrefix(repoURL, "http://") && !strings.HasPrefix(repoURL, "https://") {
	return nil, fmt.Errorf("repo url must start with http:// or https://")
}
if branch == "" {
	return nil, fmt.Errorf("branch is required")
}
if !strings.HasPrefix(mountPath, "/") {
	return nil, fmt.Errorf("mount path must be absolute")
}
```

Use IDs like:

```go
fmt.Sprintf("cr-%s-%d", rand.String(8), time.Now().Unix())
```

`modelToProto` must set `Token: ""`.

`UpdateCodeRepository` preserves the stored token when input token is blank:

```go
if input.GetToken() == "" {
	model.AccessToken = current.AccessToken
}
```

- [ ] **Step 4: Mount service**

Create `setup.go` like cloudstorage:

```go
func Setup(ctx context.Context, sc *app.SetupContext, repo interfaces.CodeRepositoryRepo, interceptor connect.Interceptor) {
	svc := NewService(repo)
	path, handler := coderepositoryconnect.NewCodeRepositoryServiceHandler(svc, connect.WithInterceptors(interceptor))
	sc.Mux.Handle(path, handler)
	logger.Infof(ctx, "Mounted Aione CodeRepositoryService at %s", path)
}
```

Modify `runs/setup.go` to call `aionecoderepository.Setup(ctx, sc, repo.CodeRepositoryRepo(), otelInterceptor)`.

- [ ] **Step 5: Run service tests to verify GREEN**

Run:

```powershell
cd D:\flyte-work
go test ./runs/aione/coderepository ./runs -run CodeRepository -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit service**

Run:

```powershell
cd D:\flyte-work
git add runs/aione/coderepository runs/setup.go
git commit -m "Add code repository service"
```

Expected: commit succeeds.

## Task 4: Store Selected Repositories On Training Tasks

**Files:**
- Modify: `runs/migrations/sql/20260615170100_training_task_code_repositories.sql`
- Modify: `runs/repository/models/training_task.go`
- Modify: `runs/repository/impl/training_task.go`
- Modify: `runs/repository/impl/training_task_test.go`
- Modify: `runs/service/training_task_service.go`
- Modify: `runs/service/training_task_service_test.go`
- Modify: `runs/service/training_task_task_spec.go`

- [ ] **Step 1: Write failing model and spec tests**

Add to `runs/service/training_task_service_test.go`:

```go
func TestBuildTrainingTaskSpecIncludesCodeRepositories(t *testing.T) {
	spec, err := BuildTrainingTaskSpec(&models.TrainingTask{
		TrainingTaskKey: models.TrainingTaskKey{ID: "train-1", Org: "testorg", Project: "flytesnacks", Domain: "development"},
		Name: "任务1",
		CPU: "2",
		Memory: "4Gi",
		Command: "echo hello",
		MaxRuntimeHours: 1,
		ImageURI: "busybox:1.36",
		CodeRepositoryMounts: []models.TrainingTaskCodeRepositoryMount{{
			CodeRepositoryID: "cr-1",
			RepoURL: "https://git.fzyun.io/serverless/aione.git",
			Branch: "main",
			MountPath: "/workspace/aione",
			AccessToken: "secret-token",
		}},
	})
	require.NoError(t, err)
	values := spec.GetTaskTemplate().GetCustom().GetFields()["codeRepositories"].GetListValue().GetValues()
	require.Len(t, values, 1)
	fields := values[0].GetStructValue().GetFields()
	require.Equal(t, "cr-1", fields["id"].GetStringValue())
	require.Equal(t, "https://git.fzyun.io/serverless/aione.git", fields["repoUrl"].GetStringValue())
	require.Equal(t, "main", fields["branch"].GetStringValue())
	require.Equal(t, "/workspace/aione", fields["mountPath"].GetStringValue())
	require.Equal(t, "secret-token", fields["token"].GetStringValue())
}
```

Add to `runs/repository/impl/training_task_test.go` an assertion that a task with `CodeRepositoryMountsJSON` round-trips.

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
cd D:\flyte-work
go test ./runs/service -run TestBuildTrainingTaskSpecIncludesCodeRepositories -count=1
go test ./runs/repository/impl -run TrainingTask -count=1
```

Expected: first command FAILS because model/spec fields do not exist; second FAILS after adding test because the DB column/model helper does not exist.

- [ ] **Step 3: Add DB column and model helpers**

Create migration:

```sql
ALTER TABLE training_tasks
  ADD COLUMN IF NOT EXISTS code_repository_mounts_json TEXT NOT NULL DEFAULT '[]';
```

Add to `TrainingTask`:

```go
CodeRepositoryMountsJSON string `db:"code_repository_mounts_json"`
CodeRepositoryMounts []TrainingTaskCodeRepositoryMount `db:"-"`
```

Add type:

```go
type TrainingTaskCodeRepositoryMount struct {
	CodeRepositoryID string `json:"codeRepositoryId"`
	RepoURL string `json:"repoUrl,omitempty"`
	Branch string `json:"branch,omitempty"`
	MountPath string `json:"mountPath"`
	AccessToken string `json:"accessToken,omitempty"`
}
```

Add `SelectedCodeRepositoryMounts`, `DecodeTrainingTaskCodeRepositoryMounts`, and `EncodeTrainingTaskCodeRepositoryMounts` mirroring cloud storage helpers.

Update training task repository SQL insert/update/select to include `code_repository_mounts_json`.

- [ ] **Step 4: Parse selected repositories from proto input**

In `training_task_service.go`, import `coderepositorypb`.

Add:

```go
func trainingTaskCodeRepositoryMountsFromProto(mounts []*coderepositorypb.CodeRepositoryMount) ([]models.TrainingTaskCodeRepositoryMount, error)
```

Validation:

- id required.
- mount path required.
- mount path starts with `/`.
- duplicate mount paths rejected.

Update `buildTrainingTaskModel` to encode `input.GetCodeRepositoryMounts()`.

Update `trainingTaskModelToProto` to return `CodeRepositoryMounts`.

- [ ] **Step 5: Resolve repository details on start**

Add `resolveTrainingTaskCodeRepositories(ctx, task)`:

```go
repo, err := s.repo.CodeRepositoryRepo().Get(ctx, models.CodeRepositoryKey{
	Org: task.Org, Project: task.Project, Domain: task.Domain, ID: mount.CodeRepositoryID,
})
```

Resolved mount uses stored URL/branch/token and selected mount path. Call it in `StartTrainingTask` before `BuildTrainingTaskSpec`.

- [ ] **Step 6: Add custom payload**

In `BuildTrainingTaskSpec`, append `codeRepositories`:

```go
map[string]any{
	"id": mount.CodeRepositoryID,
	"repoUrl": mount.RepoURL,
	"branch": mount.Branch,
	"mountPath": mount.MountPath,
	"token": mount.AccessToken,
}
```

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```powershell
cd D:\flyte-work
go test ./runs/repository/impl -run TrainingTask -count=1
go test ./runs/service -run "TrainingTask|CodeRepositories" -count=1
```

Expected: PASS.

- [ ] **Step 8: Commit training task selection support**

Run:

```powershell
cd D:\flyte-work
git add runs/migrations/sql/20260615170100_training_task_code_repositories.sql runs/repository/models/training_task.go runs/repository/impl/training_task.go runs/repository/impl/training_task_test.go runs/service/training_task_service.go runs/service/training_task_service_test.go runs/service/training_task_task_spec.go
git commit -m "Attach code repositories to training tasks"
```

Expected: commit succeeds.

## Task 5: Runtime Download Helpers And Plugin Integration

**Files:**
- Create: `flyteplugins/aione/coderepository/downloader.go`
- Create: `flyteplugins/aione/coderepository/downloader_test.go`
- Modify: `flyteplugins/aione/sshworkspace/config.go`
- Modify: `flyteplugins/aione/sshworkspace/resources.go`
- Modify: `flyteplugins/aione/sshworkspace/resources_test.go`
- Modify: `flyteplugins/aione/trainingtask/config.go`
- Modify: `flyteplugins/aione/trainingtask/resources.go`
- Modify: `flyteplugins/aione/trainingtask/resources_test.go`

- [ ] **Step 1: Write failing helper tests**

Create tests:

```go
func TestBuildDownloadScriptUsesGitLabArchiveAndSecretToken(t *testing.T) {
	script := BuildDownloadScript([]Repository{{
		ID: "cr-1",
		RepoURL: "https://git.fzyun.io/serverless/aione.git",
		Branch: "main",
		MountPath: "/workspace/aione",
		TokenEnvName: "AIONE_CODE_REPOSITORY_TOKEN_0",
	}})
	require.Contains(t, script, "https://git.fzyun.io/api/v4/projects/serverless%2Faione/repository/archive.zip?sha=main")
	require.Contains(t, script, "Private-Token: ${AIONE_CODE_REPOSITORY_TOKEN_0}")
	require.NotContains(t, script, "secret-token")
}

func TestBuildRuntimeResourcesCreatesSecretAndInitContainer(t *testing.T) {
	resources, err := BuildRuntimeResources("run-abc-code", []Repository{{
		ID: "cr-1", RepoURL: "https://git.fzyun.io/serverless/aione.git", Branch: "main", MountPath: "/workspace/aione", AccessToken: "secret-token",
	}}, []corev1.VolumeMount{{Name: "workspace", MountPath: "/workspace"}})
	require.NoError(t, err)
	require.NotNil(t, resources.Secret)
	require.Equal(t, "secret-token", string(resources.Secret.Data["token-0"]))
	require.Len(t, resources.InitContainers, 1)
	require.NotContains(t, strings.Join(resources.InitContainers[0].Args, " "), "secret-token")
}
```

- [ ] **Step 2: Run helper tests to verify RED**

Run:

```powershell
cd D:\flyte-work
go test ./flyteplugins/aione/coderepository -count=1
```

Expected: FAIL because package does not exist.

- [ ] **Step 3: Implement shared helper**

Implement:

```go
type Repository struct {
	ID string
	RepoURL string
	Branch string
	MountPath string
	AccessToken string
	TokenEnvName string
}

type RuntimeResources struct {
	Secret *corev1.Secret
	InitContainers []corev1.Container
}
```

`BuildDownloadScript` uses Python installed in the downloader image:

```sh
python3 - <<'PY'
...
PY
```

The script must parse URL, quote project path with `urllib.parse.quote(project_path, safe="")`, request archive with `urllib.request`, include `Private-Token` only when the env var has a value, strip top-level ZIP directory, and delete the archive.

Use init image `python:3.12-alpine` unless an existing project image constant is already available.

- [ ] **Step 4: Add parser support**

Add `CodeRepositories []coderepository.Repository` to both plugin config structs.

Parse `TaskTemplate.custom.codeRepositories` entries requiring:

- `id`
- `repoUrl`
- `branch`
- `mountPath`

`token` is optional.

- [ ] **Step 5: Add runtime resources to sshworkspace**

In `BuildResources`, after workspace/cloud storage mounts are known, call helper with the container's writable volume mounts. Append:

- `resources.Secret` to `WorkspaceResources`.
- init containers to `StatefulSet.Spec.Template.Spec.InitContainers`.
- secret volume/env references required by helper.

Update `WorkspaceResources`:

```go
CodeRepositorySecret *corev1.Secret
```

- [ ] **Step 6: Add runtime resources to trainingtask**

In `BuildResources`, after cloud storage mounts are known, call helper with the training container's writable volume mounts. Append:

- `resources.Secret` to `TrainingResources`.
- init containers to `Job.Spec.Template.Spec.InitContainers`.

Update `TrainingResources`:

```go
CodeRepositorySecret *corev1.Secret
```

- [ ] **Step 7: Run plugin tests to verify GREEN**

Run:

```powershell
cd D:\flyte-work
go test ./flyteplugins/aione/coderepository ./flyteplugins/aione/sshworkspace ./flyteplugins/aione/trainingtask -count=1
```

Expected: PASS.

- [ ] **Step 8: Commit runtime integration**

Run:

```powershell
cd D:\flyte-work
git add flyteplugins/aione/coderepository flyteplugins/aione/sshworkspace flyteplugins/aione/trainingtask
git commit -m "Download selected code repositories at runtime"
```

Expected: commit succeeds.

## Task 6: Development Instance Selection Flow

**Files:**
- Modify: `flyte_console/src/components/pages/DevelopmentInstances/utils.ts`
- Modify: `flyte_console/src/components/pages/DevelopmentInstances/utils.test.ts`
- Modify: `flyte_console/src/components/pages/DevelopmentInstances/CreatePage.tsx`

- [ ] **Step 1: Write failing utility test**

Add to `utils.test.ts`:

```ts
it("includes selected code repositories in ssh workspace custom payload", () => {
  const request = buildCreateDevelopmentInstanceRequest({
    org: "testorg",
    project: "flytesnacks",
    domain: "development",
    name: "devbox-code",
    image: "ubuntu:22.04",
    sshUser: "dev",
    authorizedKey: "ssh-rsa AAAA user@example",
    cpu: "2",
    memory: "4Gi",
    workspaceSize: "20Gi",
    nodePort: 31022,
    codeServerNodePort: 31023,
    maxHours: 24,
    codeRepositories: [{ codeRepositoryId: "cr-1", mountPath: "/workspace/aione" }],
  });
  if (request.task.case !== "taskSpec") throw new Error("expected task spec");
  expect(request.task.value.taskTemplate?.custom).toMatchObject({
    codeRepositories: [{ codeRepositoryId: "cr-1", mountPath: "/workspace/aione" }],
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm vitest src/components/pages/DevelopmentInstances/utils.test.ts --run
```

Expected: FAIL because `codeRepositories` is not in `DevelopmentInstanceFormValues`.

- [ ] **Step 3: Add request builder support**

Add:

```ts
codeRepositories?: { codeRepositoryId: string; mountPath: string }[];
```

Include in `custom`:

```ts
codeRepositories: values.codeRepositories ?? [],
```

- [ ] **Step 4: Add create page selection**

Use generated `CodeRepositoryService`:

```ts
const codeRepositoryClient = useConnectRpcClient(CodeRepositoryService);
```

Load repositories with `listCodeRepositories`. Add a `代码库` section mirroring cloud storage:

- checkbox per repository.
- display URL and branch.
- mount path input, defaulting to repository `mountPath`.
- reject selected duplicate mount paths.

Submit selected values to `buildCreateDevelopmentInstanceRequest`.

- [ ] **Step 5: Run frontend test to verify GREEN**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm vitest src/components/pages/DevelopmentInstances/utils.test.ts --run
```

Expected: PASS.

- [ ] **Step 6: Commit development instance flow**

Run:

```powershell
cd D:\flyte-work
git add flyte_console/src/components/pages/DevelopmentInstances
git commit -m "Select code repositories for development instances"
```

Expected: commit succeeds.

## Task 7: Training Task Selection Flow

**Files:**
- Modify: `flyte_console/src/components/pages/TrainingTasks/utils.ts`
- Modify: `flyte_console/src/components/pages/TrainingTasks/utils.test.ts`
- Modify: `flyte_console/src/components/pages/TrainingTasks/FormPage.tsx`

- [ ] **Step 1: Write failing utility tests**

Add:

```ts
it("includes selected code repositories in training task input", () => {
  const input = buildTrainingTaskInput({
    name: "任务1",
    description: "",
    resourceSpecId: DEFAULT_RESOURCE_SPEC_ID,
    command: "echo hello",
    maxRuntimeHours: 1,
    imageType: ImageType.OFFICIAL,
    officialImageId: DEFAULT_OFFICIAL_IMAGE_ID,
    imageName: "",
    imageUri: "",
    cloudStorageMounts: [],
    codeRepositoryMounts: [{ codeRepositoryId: "cr-1", mountPath: "/workspace/aione" }],
  });
  expect(input.codeRepositoryMounts).toMatchObject([
    { codeRepositoryId: "cr-1", mountPath: "/workspace/aione" },
  ]);
});

it("rejects duplicate code repository mount paths", () => {
  expect(validateTrainingTaskForm({
    name: "任务1",
    description: "",
    resourceSpecId: DEFAULT_RESOURCE_SPEC_ID,
    command: "echo hello",
    maxRuntimeHours: 1,
    imageType: ImageType.OFFICIAL,
    officialImageId: DEFAULT_OFFICIAL_IMAGE_ID,
    imageName: "",
    imageUri: "",
    cloudStorageMounts: [],
    codeRepositoryMounts: [
      { codeRepositoryId: "cr-1", mountPath: "/workspace/aione" },
      { codeRepositoryId: "cr-2", mountPath: "/workspace/aione" },
    ],
  })).toBe("代码库挂载路径不能重复");
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm vitest src/components/pages/TrainingTasks/utils.test.ts --run
```

Expected: FAIL because `codeRepositoryMounts` is not supported.

- [ ] **Step 3: Add utility support**

Add to `TrainingTaskFormValues`:

```ts
codeRepositoryMounts: { codeRepositoryId: string; mountPath: string }[];
```

In `validateTrainingTaskForm`, require absolute mount paths and reject duplicates.

In `buildTrainingTaskInput`, map to generated `CodeRepositoryMountSchema`.

- [ ] **Step 4: Add form selection**

Load code repositories in `FormPage.tsx` with `CodeRepositoryService`. Add a `代码库` section after cloud storage or before it:

- checkbox per repository.
- URL and branch display.
- mount path input.
- preserve selections when editing/copying by reading `task.codeRepositoryMounts`.

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm vitest src/components/pages/TrainingTasks/utils.test.ts --run
```

Expected: PASS.

- [ ] **Step 6: Commit training task flow**

Run:

```powershell
cd D:\flyte-work
git add flyte_console/src/components/pages/TrainingTasks
git commit -m "Select code repositories for training tasks"
```

Expected: commit succeeds.

## Task 8: Code Repository Console Page And Navigation

**Files:**
- Create: `flyte_console/src/components/pages/CodeRepositories/utils.ts`
- Create: `flyte_console/src/components/pages/CodeRepositories/utils.test.ts`
- Create: `flyte_console/src/components/pages/CodeRepositories/FormPage.tsx`
- Create: `flyte_console/src/app/domain/[domain]/project/[project]/code-repositories/page.tsx`
- Modify: `flyte_console/src/lib/uiText.ts`
- Modify: `flyte_console/src/components/NavPanel/NavItemConfigs.tsx`

- [ ] **Step 1: Write failing utility tests**

Create `utils.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateCodeRepositoryRows } from "./utils";

describe("code repository helpers", () => {
  it("rejects invalid repository urls", () => {
    expect(validateCodeRepositoryRows([{ repoUrl: "git@git.fzyun.io:a/b.git", branch: "main", mountPath: "/workspace/a", token: "" }])).toBe("请输入以 http:// 或 https:// 开头且有效的 Git 地址");
  });

  it("rejects relative mount paths", () => {
    expect(validateCodeRepositoryRows([{ repoUrl: "https://git.fzyun.io/a/b.git", branch: "main", mountPath: "workspace/a", token: "" }])).toBe("挂载路径必须为绝对路径");
  });

  it("rejects duplicate mount paths", () => {
    expect(validateCodeRepositoryRows([
      { repoUrl: "https://git.fzyun.io/a/b.git", branch: "main", mountPath: "/workspace/a", token: "" },
      { repoUrl: "https://git.fzyun.io/a/c.git", branch: "main", mountPath: "/workspace/a", token: "" },
    ])).toBe("挂载路径不能重复");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm vitest src/components/pages/CodeRepositories/utils.test.ts --run
```

Expected: FAIL because files do not exist.

- [ ] **Step 3: Implement utilities**

Export:

```ts
export type CodeRepositoryRow = {
  id?: string;
  repoUrl: string;
  branch: string;
  mountPath: string;
  token: string;
  deleted?: boolean;
};
```

`validateCodeRepositoryRows` ignores deleted rows, enforces URL/branch/mount path, and rejects duplicate mount paths.

- [ ] **Step 4: Implement page**

`FormPage.tsx` must:

- load `listCodeRepositories` for current project.
- render rows in a bordered section titled `代码库`.
- field labels exactly `地址`, `分支`, `挂载路径`, `Token`.
- placeholders exactly `请输入地址`, `请输入分支`, `请输入挂载路径`.
- show address helper text.
- use password input for token, with a visibility toggle button using Heroicons.
- `添加` appends a row with branch `main` and mount path blank.
- row `删除` marks saved rows for deletion or removes unsaved rows.
- `取消` reloads from service.
- `保存` calls delete/update/create in that order and then reloads.

- [ ] **Step 5: Add route and nav**

Create route page:

```tsx
import { CodeRepositoryFormPage } from "@/components/pages/CodeRepositories/FormPage";

export default function Page() {
  return <CodeRepositoryFormPage />;
}
```

Add `codeRepositories: "代码库"` to `uiText.ts`.

Add nav link:

```tsx
export const CodeRepositoriesLink: NavLinkType = {
  displayText: getUiText("codeRepositories"),
  makeHref: ({ project, domain }) => `/domain/${domain}/project/${project}/code-repositories`,
  icon: <CodeBracketSquareIcon className="size-4 min-w-4" />,
  type: "link",
};
```

Insert after `DevelopmentInstancesLink`.

- [ ] **Step 6: Run frontend tests to verify GREEN**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm vitest src/components/pages/CodeRepositories/utils.test.ts --run
```

Expected: PASS.

- [ ] **Step 7: Commit page and nav**

Run:

```powershell
cd D:\flyte-work
git add flyte_console/src/components/pages/CodeRepositories flyte_console/src/app/domain/[domain]/project/[project]/code-repositories flyte_console/src/lib/uiText.ts flyte_console/src/components/NavPanel/NavItemConfigs.tsx
git commit -m "Add code repository console page"
```

Expected: commit succeeds.

## Task 9: Local Verification

**Files:** all implementation files.

- [ ] **Step 1: Run backend verification**

Run:

```powershell
cd D:\flyte-work
go test ./runs/aione/coderepository -count=1
go test ./runs/repository/impl -run "CodeRepository|TrainingTask" -count=1
go test ./runs/service -run "CodeRepository|TrainingTask" -count=1
go test ./flyteplugins/aione/coderepository ./flyteplugins/aione/sshworkspace ./flyteplugins/aione/trainingtask -count=1
go test ./executor/pkg/plugin/k8s -count=1
bash deploy/tests/test_flyte_api_scripts.sh
bash deploy/tests/test_deploy_aiops_flyte.sh
```

Expected: every command exits `0`.

- [ ] **Step 2: Run frontend verification**

Run:

```powershell
cd D:\flyte-work\flyte_console
pnpm vitest src/components/pages/CodeRepositories/utils.test.ts src/components/pages/DevelopmentInstances/utils.test.ts src/components/pages/TrainingTasks/utils.test.ts --run
pnpm run build:prod
```

Expected: every command exits `0` and `public/monaco/vs` is generated but remains uncommitted.

- [ ] **Step 3: Check diffs**

Run:

```powershell
cd D:\flyte-work
git status --short
git diff --check
```

Expected: no whitespace errors; only intended source/generated files are changed.

## Task 10: Deployment And Browser Verification

**Files:** no source edits unless verification finds defects.

- [ ] **Step 1: Push committed branch**

Run:

```powershell
cd D:\flyte-work
git push origin codex/flyte-ssh-workspace
```

Expected: push succeeds.

- [ ] **Step 2: Deploy backend from remote git pull**

Run:

```bash
ssh aione-flyte2
cd /opt/aiops-flyte2
git pull --ff-only origin codex/flyte-ssh-workspace
docker build -f Dockerfile -t flyte-binary-v2:ssh-workspace .
docker save flyte-binary-v2:ssh-workspace | k3s ctr images import -
kubectl -n flyte rollout restart deploy/flyte-binary
kubectl -n flyte rollout status deploy/flyte-binary --timeout=10m
curl -I http://172.19.66.218:30080/v2/projects
```

Expected: rollout completes and curl returns `HTTP/1.1 200 OK`.

- [ ] **Step 3: Deploy frontend from remote git pull**

Run:

```bash
ssh aione-flyte2
cd /opt/aiops-flyte2
git pull --ff-only origin codex/flyte-ssh-workspace
COMMIT="$(git rev-parse --short HEAD)"
docker build -f flyte_console/Dockerfile -t "flyte-console-source:${COMMIT}" -t flyte-console-extracted:latest flyte_console
docker save "flyte-console-source:${COMMIT}" flyte-console-extracted:latest | k3s ctr images import -
kubectl apply -f deploy/ui/flyte-console-extracted.yaml
kubectl -n flyte rollout restart deploy/flyte-console-extracted
kubectl -n flyte rollout status deploy/flyte-console-extracted --timeout=180s
curl -I http://172.19.66.218:30081/v2/projects
```

Expected: rollout completes and curl returns `HTTP/1.1 200 OK`.

- [ ] **Step 4: Browser verify**

Run:

```powershell
cd D:\flyte-work
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify open http://172.19.66.218:30081/v2/projects
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify snapshot
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify console error
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify requests
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify screenshot --filename D:\flyte-work\output\playwright\code-repository-projects.png --full-page
```

Navigate to `flytesnacks/development`, open `代码库`, create a test repository, verify it appears in the dev instance and training task create forms, and save screenshots:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify screenshot --filename D:\flyte-work\output\playwright\code-repository-form.png --full-page
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify screenshot --filename D:\flyte-work\output\playwright\development-instance-code-repository-selection.png --full-page
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify screenshot --filename D:\flyte-work\output\playwright\training-task-code-repository-selection.png --full-page
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify console error
npx --yes --package @playwright/cli playwright-cli -s=code-repository-verify close
```

Expected:

- Page title remains `Projects | Flyte 2`.
- `代码库` appears in left navigation.
- repository page fields match screenshot labels and action placement.
- selected repositories appear in both create flows.
- console errors are `0`.
- relevant API requests return 200.

## Self-Review

- Spec coverage: project-level repository CRUD, screenshot fields, launch-time selection for development instances and training tasks, runtime archive download, token secret handling, validation, tests, local build, deploy, and browser verification are covered.
- Merge strategy: new code is isolated under `aione/coderepository`, with only small registration and form integration changes in shared files.
- TDD path: each production area starts with a failing test before implementation.
- Generated files: generated protobuf artifacts are created only by `buf generate` and copied into the console generated tree.
- Deployment rules: remote steps use committed code plus `git pull --ff-only`; no direct file copy to the remote checkout.
