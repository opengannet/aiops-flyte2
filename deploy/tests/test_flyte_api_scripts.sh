#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENDPOINT="http://172.19.66.218:30080"

# shellcheck source=tests/lib/flyte_api.sh
source "$ROOT_DIR/tests/lib/flyte_api.sh"

assert_eq() {
  local want="$1"
  local got="$2"
  local message="$3"
  if [[ "$want" != "$got" ]]; then
    printf 'FAIL: %s\nwant: %s\ngot:  %s\n' "$message" "$want" "$got" >&2
    exit 1
  fi
}

assert_file_contains() {
  local file="$1"
  local needle="$2"
  if ! grep -Fq "$needle" "$file"; then
    printf 'FAIL: expected %s to contain: %s\n' "$file" "$needle" >&2
    exit 1
  fi
}

assert_file_contains "$ROOT_DIR/tests/start_ssh_workspace.sh" "ENDPOINT=\"\${ENDPOINT:-$DEFAULT_ENDPOINT}\""
assert_file_contains "$ROOT_DIR/tests/start_ml_task.sh" "ENDPOINT=\"\${ENDPOINT:-$DEFAULT_ENDPOINT}\""
assert_file_contains "$ROOT_DIR/tests/get_run_status.sh" "ENDPOINT=\"\${ENDPOINT:-$DEFAULT_ENDPOINT}\""
assert_file_contains "$ROOT_DIR/tests/start_aione_instance.sh" "API_PATH=\"\${API_PATH:-/v2/api/aione/instance/run}\""

json_get() {
  local json="$1"
  local path="$2"
  python3 -c '
import json, sys
data = json.loads(sys.argv[1])
value = data
for part in sys.argv[2].split("."):
    if part:
        value = value[part]
print(value)
' "$json" "$path"
}

create_response='{
  "run": {
    "action": {
      "id": {
        "run": {
          "org": "testorg",
          "project": "flytesnacks",
          "domain": "development",
          "name": "run-123"
        }
      }
    }
  }
}'

run_id="$(parse_create_run_id "$create_response")"
assert_eq "testorg/flytesnacks/development/run-123" "$run_id" "parse_create_run_id"

status_response='{
  "details": {
    "action": {
      "status": {
        "phase": "ACTION_PHASE_RUNNING",
        "durationMs": "12500"
      }
    }
  }
}'

status_json="$(format_run_status "$status_response")"
phase="$(json_get "$status_json" "phase")"
duration="$(json_get "$status_json" "durationSeconds")"
error="$(json_get "$status_json" "error")"
assert_eq "4" "$phase" "running phase is numeric"
assert_eq "12" "$duration" "duration is seconds"
assert_eq "" "$error" "missing error is empty string"

failed_response='{
  "details": {
    "action": {
      "status": {
        "phase": 6,
        "durationMs": 3000
      },
      "errorInfo": {
        "message": "boom"
      }
    }
  }
}'

failed_json="$(format_run_status "$failed_response")"
assert_eq "6" "$(json_get "$failed_json" "phase")" "numeric phase remains numeric"
assert_eq "boom" "$(json_get "$failed_json" "error")" "error message extracted"
assert_eq "3" "$(json_get "$failed_json" "durationSeconds")" "numeric duration is seconds"

run_id_payload="$(run_id_json "/flytesnacks/development/run-123")"
assert_eq "" "$(json_get "$run_id_payload" "runId.org")" "empty org run id is supported"
assert_eq "flytesnacks" "$(json_get "$run_id_payload" "runId.project")" "empty org run id project"

payload="$(build_ssh_workspace_payload \
  "testorg" "flytesnacks" "development" \
  "ubuntu:22.04" "dev" "ssh-rsa AAAA user@example" "20Gi" "NodePort" "30222")"
assert_eq "ssh_workspace" "$(json_get "$payload" "taskSpec.taskTemplate.type")" "workspace task type"
assert_eq "dev" "$(json_get "$payload" "taskSpec.taskTemplate.custom.sshUser")" "workspace ssh user"
assert_eq "30222" "$(json_get "$payload" "taskSpec.taskTemplate.custom.nodePort")" "workspace node port"

ml_payload="$(build_ml_task_payload "testorg" "flytesnacks" "development" "python:3.12" "python -m timeit")"
assert_eq "container" "$(json_get "$ml_payload" "taskSpec.taskTemplate.type")" "ml task type"
assert_eq "python:3.12" "$(json_get "$ml_payload" "taskSpec.taskTemplate.container.image")" "ml image"

aione_payload="$(build_aione_instance_payload \
  "external-org" "aione" "development" "External Dev" "ins-123" \
  "ssh-rsa AAAA user@example" "docker.fzyun.io/founder/aione.ide:1.0.0.60" "1" "2" "4Gi")"
assert_eq "external-org" "$(json_get "$aione_payload" "org")" "aione source org"
assert_eq "BASE" "$(json_get "$aione_payload" "imageType")" "aione image type"
assert_eq "/data/lib1" "$(json_get "$aione_payload" "baseImage.mountPath")" "aione base image mount path"

aione_response='{"status":200,"data":{"run":{"org":"aione","project":"aione","domain":"development","name":"ins-123"},"source":{"org":"external-org","id":"ins-123"}}}'
assert_eq "aione/aione/development/ins-123" "$(parse_aione_instance_run_id "$aione_response")" "parse aione instance run id"

printf 'PASS tests/test_flyte_api_scripts.sh\n'
