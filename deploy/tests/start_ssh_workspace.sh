#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=tests/lib/flyte_api.sh
source "$ROOT_DIR/tests/lib/flyte_api.sh"

ENDPOINT="${ENDPOINT:-http://172.19.66.218:30080}"
ORG="${ORG:-testorg}"
PROJECT="${PROJECT:-flytesnacks}"
DOMAIN="${DOMAIN:-development}"
IMAGE="${IMAGE:-ubuntu:22.04}"
SSH_USER="${SSH_USER:-flytekit}"
AUTHORIZED_KEY_FILE="${AUTHORIZED_KEY_FILE:-$HOME/.ssh/id_rsa.pub}"
WORKSPACE_SIZE="${WORKSPACE_SIZE:-20Gi}"
SERVICE_TYPE="${SERVICE_TYPE:-NodePort}"
NODE_PORT="${NODE_PORT:-}"

if [[ ! -f "$AUTHORIZED_KEY_FILE" ]]; then
  printf 'authorized key file not found: %s\n' "$AUTHORIZED_KEY_FILE" >&2
  exit 1
fi

authorized_key="$(tr -d '\r\n' < "$AUTHORIZED_KEY_FILE")"
payload="$(build_ssh_workspace_payload "$ORG" "$PROJECT" "$DOMAIN" "$IMAGE" "$SSH_USER" "$authorized_key" "$WORKSPACE_SIZE" "$SERVICE_TYPE" "$NODE_PORT")"
response="$(flyte_buf_curl "$ENDPOINT" "flyteidl2.workflow.RunService/CreateRun" "$payload")"
parse_create_run_id "$response"
