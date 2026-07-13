# Datasets CRUD Design

## Goal

Add project-level dataset management to AiOps Flyte 2. Users can create, list, view, edit, and delete datasets that point to a folder inside an existing object storage resource.

This is a real backend resource, not a Console-only placeholder. The implementation should follow the existing AiOps resource pattern used by cloud storage and code repositories: protobuf contract, Go Connect service, repository persistence, generated clients, and Console pages.

## Visual Source

The dataset list and create screens match the provided screenshots.

List page:

- Title: `数据集 (<count>)`
- Search placeholder: `按关键词搜索`
- Actions: refresh icon, `删除`, orange `创建`
- Columns: checkbox, `名称`, `描述`, `可见范围`, `创建人`, `创建时间`
- Dataset names are links.
- Visibility values are `私有` and `项目内公开`.

Create and edit page:

- Breadcrumb: `机器学习 > 数据集 > 创建` for create, and `机器学习 > 数据集 > 编辑` for edit.
- Title: `创建数据集` or `编辑数据集`
- Section title: `基本信息`
- Fields:
  - `名称`, placeholder `请输入名称`, help `1-128 个字符。`
  - `描述 - 可选`, placeholder `请输入描述`, help `最多 255 个字符。`
  - `存储桶`, a select populated from existing object storage resources, help `选择“对象存储”中的存储桶。`
  - `文件夹路径 - 可选`, placeholder `请输入文件夹路径`, help `输入对应存储桶内的文件夹，如 data/sub-path/。`
  - `项目内公开`, switch, help `数据集默认其他项目成员不可见。如果开启项目内公开，则其他项目成员都可以访问。数据集公开后，不可转为私有。`
- Footer actions: `取消` and orange primary `创建` or `保存`.

The UI should reuse the restrained table/form styling already used by `CloudStorage`, `CodeRepositories`, and `TrainingTasks`.

## Architecture

Add an AiOps dataset subsystem with the same boundaries as nearby resources.

New files and directories:

- Protos: `flyteidl2/aione/dataset/`
- Generated Go: `gen/go/flyteidl2/aione/dataset/`
- Generated TS package output: `gen/ts/flyteidl2/aione/dataset/`
- Console generated TS copy: `flyte_console/gen/flyteidl2/aione/dataset/`
- Backend service: `runs/aione/dataset/`
- Persistence model, interface, implementation: `runs/repository/models`, `runs/repository/interfaces`, `runs/repository/impl`
- SQL migration: `runs/migrations/sql/<timestamp>_aione_datasets.sql`
- Console components: `flyte_console/src/components/pages/Datasets/`
- Console routes:
  - `flyte_console/src/app/domain/[domain]/project/[project]/datasets/page.tsx`
  - `flyte_console/src/app/domain/[domain]/project/[project]/datasets/create/page.tsx`
  - `flyte_console/src/app/domain/[domain]/project/[project]/datasets/[datasetId]/page.tsx`
  - `flyte_console/src/app/domain/[domain]/project/[project]/datasets/[datasetId]/edit/page.tsx`

Small registration edits:

- `runs/setup.go` mounts `DatasetService`.
- Repository construction exposes `DatasetRepo()`.
- Console navigation adds `数据集` near other AiOps machine-learning resources.
- Training task detail replaces the current empty dataset attachment section when dataset mounts are introduced later. Initial CRUD does not need to attach datasets to training tasks.

## Data Model

Persist datasets in a project-scoped table:

- `org`
- `project`
- `domain`
- `id`
- `name`
- `description`
- `end_point`
- `port`
- `access_key`
- `secret_key_ciphertext`
- `target_path`
- `bucket`
- `bucket_path`
- `creator`
- `created_at`
- `updated_at`

Primary key:

```text
(org, project, domain, id)
```

Indexes:

- `(org, project, domain, created_at DESC)` for list pages.
- `(org, project, domain, name)` for search and future uniqueness checks.
- `(org, project, domain, bucket)` for object-storage filtering.

Validation:

- `name` is required, trimmed, 1-128 characters.
- `description` is optional, trimmed, max 255 characters.
- `end_point`, `port`, `access_key`, `target_path`, and `bucket` are required.
- `secret_key` is required on create, encrypted by the backend into `secret_key_ciphertext`, and never returned in plaintext.
- `secret_key` is optional on update; an empty update value keeps the existing ciphertext.
- `bucket_path` is optional. If supplied, trim leading `/` because it is a path inside the storage bucket, not an absolute container path.
- `bucket_path` must not contain `..`, backslashes, or a URI scheme.

Deletion semantics:

- `DeleteDataset` deletes only dataset metadata.
- It must not delete the backing cloud storage, PVC, materialization records, or files inside the bucket.

## Proto API

Add `flyteidl2.aione.dataset.DatasetService`.

Definitions:

- `DatasetIdentifier`
- `Dataset`
- `DatasetInput`

RPCs:

- `CreateDataset(CreateDatasetRequest) returns (CreateDatasetResponse)`
- `UpdateDataset(UpdateDatasetRequest) returns (UpdateDatasetResponse)`
- `GetDataset(GetDatasetRequest) returns (GetDatasetResponse)`
- `ListDatasets(ListDatasetsRequest) returns (ListDatasetsResponse)`
- `DeleteDataset(DeleteDatasetRequest) returns (DeleteDatasetResponse)`

Request and response shape mirrors `CodeRepositoryService` and `CloudStorageService`:

- Create takes `common.ProjectIdentifier project`, `DatasetInput dataset`, and `creator`.
- Update takes `DatasetIdentifier id` and `DatasetInput dataset`.
- Get/Delete take `DatasetIdentifier id`.
- List takes `common.ListRequest request` and `common.ProjectIdentifier project`.
- List supports search through a `common.ListRequest` filter on `name` or `description`.
- List returns `repeated Dataset datasets`, `token`, and `total`.

## Backend Behavior

The Go service should live in `runs/aione/dataset`.

Service responsibilities:

- Validate input and normalize strings.
- Generate IDs as `ds-<random>-<unix>` when creating a dataset.
- Resolve the referenced cloud storage through `CloudStorageRepo` or an equivalent repository method.
- Map missing dataset to Connect `NotFound`.
- Map invalid input to Connect `InvalidArgument`.
- Preserve creator during update.
- Enforce public-to-private rejection with a clear error message.

Repository responsibilities:

- Implement create/get/list/update/delete with SQL only.
- Use project scope for every query.
- Support list search by lowercased `name` and `description`.
- Return deterministic `created_at DESC` order.

## Console UX

### Navigation

Add `数据集` under the project navigation alongside `云存储`, `代码库`, and `训练任务`. The route is:

```text
/domain/:domain/project/:project/datasets
```

### Dataset List

The list page uses `DatasetService.listDatasets`.

Interactions:

- Search filters by name and description. Prefer server-side search through `ListRequest` when practical; local filtering is acceptable as a first Console layer if the page loads the current list.
- Refresh reloads current data.
- Delete is enabled when one or more rows are selected.
- Delete sends one `DeleteDataset` request per selected row, clears selection, and reloads.
- Name links to detail.

Error text:

- Load failure: `加载数据集失败`
- Delete failure: `删除数据集失败`
- Successful delete: `已删除数据集`

### Dataset Form

The form is shared by create and edit modes.

Create mode:

- Loads cloud storages with `CloudStorageService.listCloudStorages`.
- Requires a dataset name.
- Requires a selected storage bucket.
- Sends `CreateDataset`.
- Redirects to the dataset list on success.

Edit mode:

- Loads the dataset and cloud storages.
- Pre-fills all fields.
- Sends `UpdateDataset`.
- If the existing dataset is public, the `项目内公开` switch is locked on and cannot be turned off.
- Redirects back to detail or list after save. Detail is preferred if implemented in the same change set.

Validation messages:

- Missing project context: `项目上下文未加载完成`
- Missing name: `请输入名称`
- Name too long: `名称不能超过 128 个字符`
- Description too long: `描述不能超过 255 个字符`
- Missing storage bucket: `请选择存储桶`
- Invalid folder path: `文件夹路径不能包含 ..、反斜杠或 URL`
- Public rollback attempt: `数据集公开后不可转为私有`

### Dataset Detail

The detail page shows:

- Basic information: name, dataset ID, description, visibility, storage bucket, folder path, creator, created time, updated time.
- Actions: back, refresh, edit, delete.
- Delete redirects to list.

The detail page does not attempt to inspect bucket file contents in this version.

## External API

No AIONE external REST API is required for the first CRUD version. The user-facing Console talks to the Connect `DatasetService`, consistent with cloud storage and code repository management pages.

If an external dataset API is requested later, it should follow `flyte_console/AGENTS.md` rules: route files under `src/app/api/aione/**/route.ts`, response helpers from `src/server/http/response.ts`, and smoke tests under `tests_smoke/`.

## Testing

Backend tests:

- Repository create/get/list/update/delete.
- List search matches name and description.
- Service create rejects missing name, missing cloud storage, and invalid folder path.
- Service update preserves creator.
- Service update rejects public-to-private rollback.
- Service delete removes metadata only.

Frontend tests:

- Dataset form rejects missing name and missing storage.
- Dataset form rejects invalid folder paths.
- Dataset form calls `CreateDataset` with the selected cloud storage and normalized folder path.
- Edit mode locks public datasets as public.
- Dataset list delete calls `DeleteDataset` for selected rows.

Verification commands:

```powershell
cd D:\flyte-work
go test ./runs/aione/dataset -count=1
go test ./runs/repository/impl -run Dataset -count=1

cd D:\flyte-work\flyte_console
pnpm.cmd exec vitest run "src/components/pages/Datasets/*.test.ts*"
pnpm.cmd exec tsc --project tsconfig.typecheck.json --noEmit
```

Full deployment verification, after implementation is committed and pushed, follows root `AGENTS.md`: remote `git pull --ff-only`, backend rollout when backend changed, source-built console rollout, and browser verification on `http://172.19.66.218:30081/v2/domain/development/project/<project>/datasets`.

## Out Of Scope

- Uploading files into the dataset folder.
- Browsing object storage contents.
- Deleting physical files or PVCs.
- Attaching datasets to training tasks or development instances.
- External `/v2/api/aione/dataset` REST endpoints.
- Cross-project sharing.

## Merge Strategy

Keep dataset code in AiOps-specific namespaces. Shared files should only receive registration or navigation edits. Do not refactor existing cloud storage, code repository, or training task behavior unless it is directly required for dataset CRUD.
