#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=tests/lib/flyte_api.sh
source "$ROOT_DIR/tests/lib/flyte_api.sh"

ENDPOINT="${ENDPOINT:-http://172.19.66.218:30080}"
ORG="${ORG:-testorg}"
PROJECT="${PROJECT:-flytesnacks}"
DOMAIN="${DOMAIN:-development}"
IMAGE="${IMAGE:-docker.fzyun.io/python:3.12-slim}"
COMMAND="${COMMAND:-python -c 'import time; print(\"ml task started\", flush=True); time.sleep(30)'}"

payload="$(build_ml_task_payload "$ORG" "$PROJECT" "$DOMAIN" "$IMAGE" "$COMMAND")"
response="$(flyte_buf_curl "$ENDPOINT" "flyteidl2.workflow.RunService/CreateRun" "$payload")"
parse_create_run_id "$response"
