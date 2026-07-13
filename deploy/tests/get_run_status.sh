#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=tests/lib/flyte_api.sh
source "$ROOT_DIR/tests/lib/flyte_api.sh"

ENDPOINT="${ENDPOINT:-http://172.19.66.218:30080}"
RUN_ID="${1:-${RUN_ID:-}}"

if [[ -z "$RUN_ID" ]]; then
  printf 'usage: %s org/project/domain/name\n' "$0" >&2
  exit 1
fi

payload="$(run_id_json "$RUN_ID")"
response="$(flyte_buf_curl "$ENDPOINT" "flyteidl2.workflow.RunService/GetRunDetails" "$payload")"
format_run_status "$response"
