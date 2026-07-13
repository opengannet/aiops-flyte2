#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=tests/lib/flyte_api.sh
source "$ROOT_DIR/tests/lib/flyte_api.sh"

ENDPOINT="${ENDPOINT:-http://172.19.66.218:30081}"
API_PATH="${API_PATH:-/v2/api/aione/instance/run}"
AIONE_API_KEY="${AIONE_API_KEY:-${EXTERNAL_API_KEY:-}}"
SOURCE_ORG="${SOURCE_ORG:-external-system}"
PROJECT="${PROJECT:-aione}"
DOMAIN="${DOMAIN:-development}"
INSTANCE_NAME="${INSTANCE_NAME:-AIONE external test instance}"
INSTANCE_ID="${INSTANCE_ID:-aione-ext-$(date +%Y%m%d%H%M%S)}"
IMAGE="${IMAGE:-docker.fzyun.io/founder/aione.ide:1.0.0.60}"
TIMEOUT_HOURS="${TIMEOUT_HOURS:-1}"
CPU="${CPU:-2}"
MEMORY="${MEMORY:-4Gi}"
AUTHORIZED_KEY="${AUTHORIZED_KEY:-}"
AUTHORIZED_KEY_FILE="${AUTHORIZED_KEY_FILE:-$HOME/.ssh/id_rsa.pub}"

if [[ -z "$AIONE_API_KEY" ]]; then
  printf 'AIONE_API_KEY or EXTERNAL_API_KEY is required\n' >&2
  exit 1
fi

if [[ -z "$AUTHORIZED_KEY" ]]; then
  if [[ ! -f "$AUTHORIZED_KEY_FILE" ]]; then
    printf 'authorized key file not found: %s\n' "$AUTHORIZED_KEY_FILE" >&2
    exit 1
  fi
  AUTHORIZED_KEY="$(tr -d '\r\n' < "$AUTHORIZED_KEY_FILE")"
fi

payload="$(build_aione_instance_payload \
  "$SOURCE_ORG" "$PROJECT" "$DOMAIN" "$INSTANCE_NAME" "$INSTANCE_ID" \
  "$AUTHORIZED_KEY" "$IMAGE" "$TIMEOUT_HOURS" "$CPU" "$MEMORY")"

response="$(curl -fsS \
  -H "authorization: Bearer $AIONE_API_KEY" \
  -H "content-type: application/json" \
  --data "$payload" \
  "$ENDPOINT$API_PATH")"

parse_aione_instance_run_id "$response"
