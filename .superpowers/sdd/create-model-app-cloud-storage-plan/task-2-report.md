# Task 2 Report: Model App Cloud Storage PVC Materialization

## Summary

- Added optional `CloudStorageRepo` injection to `InternalAppService` without changing existing one-argument callers.
- Resolved requested cloud storage IDs through the repository using the model app org/project/domain scope.
- Built `cs-<storage-id>` RWO PVCs from DB-owned `SizeGB` and `StorageClass` values with the standard cloud-storage labels.
- Mounted cloud storage only on the `vllm` container and preserved the existing model-cache PVC and downloader init-container mounts.
- Called `SetMaterialized` only after `DeployWithResources` succeeded.
- Wired the existing runs cloud storage repository into internal app setup.

## RED / GREEN Evidence

1. Optional repository injection
   - RED: `go test ./app/internal/service -run TestNewInternalAppService_CloudStorageRepoIsOptional -count=1`
   - Expected failure: `cloudStorageRepo undefined` and `too many arguments in call to NewInternalAppService`.
   - GREEN: the same command passed after adding the optional constructor dependency.

2. Mount path validation
   - RED: `go test ./app/internal/service -run TestCreateModelApp_RejectsRelativeCloudStorageMountPath -count=1`
   - Expected failure: `An error is expected but got nil`.
   - GREEN: the same command passed after rejecting empty fields and non-absolute mount paths.

3. Missing storage lookup
   - RED: `go test ./app/internal/service -run TestCreateModelApp_ReturnsNotFoundForMissingCloudStorage -count=1`
   - Expected failure: `An error is expected but got nil`.
   - GREEN: the same command passed after scoped repository resolution and `NotFound` mapping.

4. PVC, pod mount, and materialization integration
   - RED: `go test ./app/internal/service -run TestCreateModelApp_MaterializesCloudStoragePVCAndMountsVLLMContainer -count=1`
   - Expected failure: PVC list had 1 item instead of 2.
   - GREEN: the same command passed after adding DB-backed PVC generation, the vLLM-only volume mount, and post-deploy materialization.

## Changed Files

- `app/internal/service/internal_app_service.go`
- `app/internal/service/internal_app_service_test.go`
- `app/internal/service/model_app.go`
- `app/internal/setup.go`
- `.superpowers/sdd/create-model-app-cloud-storage-plan/task-2-report.md`

## Verification

- `go test ./app/internal/service -count=1`
  - PASS: `ok github.com/flyteorg/flyte/v2/app/internal/service`
- `go test ./app/internal/... -count=1`
  - PASS: internal setup/config compiled; k8s and service tests passed.
- `git diff --check -- app/internal/service/internal_app_service.go app/internal/service/internal_app_service_test.go app/internal/service/model_app.go app/internal/setup.go`
  - PASS: no whitespace errors. Git emitted only LF-to-CRLF working-copy warnings.

## Self-Review

- Confirmed request payload fields are limited to cloud storage ID and mount path; capacity, StorageClass, and PVC name are derived server-side.
- Confirmed repository lookup uses the complete org/project/domain/id key.
- Confirmed cloud PVC labels match the training task and SSH workspace convention.
- Confirmed the existing model-cache PVC remains first, retains `80Gi`/`local-path`, and keeps both vLLM cache mounts.
- Confirmed downloader init containers receive no cloud-storage mount.
- Confirmed materialization occurs after deployment through an ordering assertion in the test.
- Confirmed requests without cloud storage still work with the legacy one-argument constructor.
- Confirmed no frontend or external API files were changed and user-owned untracked output was not modified.

## Concerns

None.
