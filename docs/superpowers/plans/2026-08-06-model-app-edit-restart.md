# Model App Edit And Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VLLM model-app edit page that loads the effective runtime configuration, updates editable fields, and restarts the app without changing its identity, model source, credentials, or cache PVC.

**Architecture:** Kubernetes remains the source of truth. Model-specific RPCs combine the stored App spec, live Deployment arguments, and downloader Secret into a redacted edit view, then rebuild the App spec and force a Pod replacement on save. The downloader reuses a non-empty target directory so runtime-only edits cannot overwrite or redownload model weights.

**Tech Stack:** Go, Connect RPC, protobuf, Kubernetes client-go, Python downloader, Next.js, React, TypeScript, Vitest, Playwright.

## Global Constraints

- Only VLLM model apps are editable.
- App ID, project, domain, model code, repository URL, branch, path, and token are immutable.
- Repository tokens are never returned to the browser or stored in the App spec.
- Saving always activates the app and forces a replacement Pod while preserving the model PVC and downloader Secret.
- No model-app database table is added; Kubernetes resources remain authoritative.
- Source changes must be committed before deployment; the remote checkout updates only with `git pull --ff-only`.

---

### Task 1: Model App Configuration RPCs And Backend Lifecycle

- [ ] Add protobuf messages and AppService RPCs for reading redacted model configuration and updating editable model runtime fields.
- [ ] Generate Go and TypeScript bindings and run protobuf lint.
- [ ] Add failing service and Kubernetes client tests for live custom-argument extraction, redacted source recovery, immutable source reuse, auxiliary-resource preservation, cache invalidation, and forced Pod replacement.
- [ ] Implement the model configuration read/update service and forced redeploy behavior.
- [ ] Run `go test ./app/... -count=1`.

### Task 2: Downloader Cache Reuse

- [ ] Add a failing Python test proving a non-empty target directory performs no archive request or Git clone.
- [ ] Move the reuse check ahead of every downloader strategy.
- [ ] Run `python flyteplugins/aione/downloader/aione_downloads_test.py`.

### Task 3: Console Edit Flow

- [ ] Add failing tests for the VLLM-only overflow-menu edit link, edit-route rendering, redacted/read-only fields, effective argument hydration, update submission, errors, and success navigation.
- [ ] Extract reusable model form behavior from the create page and add `/apps/<id>/edit`.
- [ ] Submit `UpdateModelApp`, invalidate Apps queries, and navigate to App details after success.
- [ ] Run targeted Vitest tests, `pnpm run typecheck`, and `pnpm run build:prod`.

### Task 4: Review, Deployment, And Acceptance

- [ ] Run backend, downloader, frontend, generated-code, lint, diff, and production-build verification.
- [ ] Commit all source changes and push the active branch.
- [ ] Update the remote checkout with `git pull --ff-only`, deploy backend/downloader and source-built Console, and verify rollouts.
- [ ] Edit `qwen25-15b`, verify the three memory-safety arguments are present, save and restart, then verify Pod UID changes, PVC identity remains stable, Active status returns, and `/v1/models` responds with HTTP 200.
- [ ] Save Playwright screenshots under `output/playwright/` for the edit page, Apps list, and model endpoint.
