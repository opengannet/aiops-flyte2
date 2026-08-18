#!/usr/bin/env bash

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'required command not found: %s\n' "$name" >&2
    return 1
  fi
}

buf_command() {
  if command -v buf >/dev/null 2>&1; then
    printf 'buf\n'
  elif command -v buf.exe >/dev/null 2>&1; then
    printf 'buf.exe\n'
  else
    printf 'required command not found: buf\n' >&2
    return 1
  fi
}

python_json() {
  if command -v python3 >/dev/null 2>&1; then
    python3 "$@"
  elif command -v python >/dev/null 2>&1; then
    python "$@"
  else
    printf 'required command not found: python3\n' >&2
    return 1
  fi
}

parse_create_run_id() {
  python_json -c '
import json, sys
data = json.load(sys.stdin)
run = data["run"]["action"]["id"]["run"]
print("/".join([run.get("org", ""), run["project"], run["domain"], run["name"]]))
' <<<"$1"
}

format_run_status() {
  python_json -c '
import json, sys, time
data = json.load(sys.stdin)
action = data.get("details", {}).get("action", {})
status = action.get("status", {})
phase = status.get("phase", 0)
phase_numbers = {
    "ACTION_PHASE_UNSPECIFIED": 0,
    "ACTION_PHASE_QUEUED": 1,
    "ACTION_PHASE_WAITING_FOR_RESOURCES": 2,
    "ACTION_PHASE_INITIALIZING": 3,
    "ACTION_PHASE_RUNNING": 4,
    "ACTION_PHASE_SUCCEEDED": 5,
    "ACTION_PHASE_FAILED": 6,
    "ACTION_PHASE_ABORTED": 7,
    "ACTION_PHASE_TIMED_OUT": 8,
    "ACTION_PHASE_PAUSED": 9,
}
if isinstance(phase, str):
    phase = phase_numbers.get(phase, 0)
duration_ms = status.get("durationMs", status.get("duration_ms", 0)) or 0
duration_seconds = int(int(duration_ms) / 1000)
error_info = action.get("errorInfo") or action.get("error_info") or {}
print(json.dumps({
    "phase": int(phase),
    "error": error_info.get("message", ""),
    "durationSeconds": duration_seconds,
}, separators=(",", ":")))
' <<<"$1"
}

run_id_json() {
  local run_id="$1"
  local org project domain name extra
  IFS=/ read -r org project domain name extra <<<"$run_id"
  if [[ -z "${name:-}" ]]; then
    name="$domain"
    domain="$project"
    project="$org"
    org=""
  fi
  if [[ -n "${extra:-}" || -z "${project:-}" || -z "${domain:-}" || -z "${name:-}" ]]; then
    printf 'run id must have form project/domain/name or org/project/domain/name\n' >&2
    return 1
  fi
  python_json -c '
import json, sys
org, project, domain, name = sys.argv[1:5]
print(json.dumps({"runId": {"org": org, "project": project, "domain": domain, "name": name}}, separators=(",", ":")))
' "$org" "$project" "$domain" "$name"
}

build_ssh_workspace_payload() {
  local org="$1"
  local project="$2"
  local domain="$3"
  local image="$4"
  local ssh_user="$5"
  local authorized_key="$6"
  local workspace_size="$7"
  local service_type="$8"
  local node_port="${9:-}"

  python_json -c '
import json, sys
org, project, domain, image, ssh_user, authorized_key, workspace_size, service_type, node_port = sys.argv[1:10]
payload = {
    "projectId": {"organization": org, "name": project, "domain": domain},
    "taskSpec": {
        "taskTemplate": {
            "id": {
                "resourceType": "TASK",
                "org": org,
                "project": project,
                "domain": domain,
                "name": "ssh_workspace",
                "version": "tests",
            },
            "type": "ssh_workspace",
            "custom": {
                "image": image,
                "enableSsh": True,
                "sshUser": ssh_user,
                "authorizedKeys": [authorized_key],
                "workspaceSize": workspace_size,
                "serviceType": service_type,
            },
            "metadata": {
                "discoverable": False,
                "timeout": "0s",
                "retries": {"retries": 0},
                "interruptible": False,
                "cacheSerializable": False,
                "debuggable": True,
            },
            "interface": {"inputs": {"variables": []}, "outputs": {"variables": []}},
        }
    },
    "inputs": {"literals": []},
    "source": "RUN_SOURCE_CLI",
}
if node_port:
    payload["taskSpec"]["taskTemplate"]["custom"]["nodePort"] = int(node_port)
print(json.dumps(payload, separators=(",", ":")))
' "$org" "$project" "$domain" "$image" "$ssh_user" "$authorized_key" "$workspace_size" "$service_type" "$node_port"
}

build_ml_task_payload() {
  local org="$1"
  local project="$2"
  local domain="$3"
  local image="$4"
  local command="$5"

  python_json -c '
import json, sys
org, project, domain, image, command = sys.argv[1:6]
payload = {
    "projectId": {"organization": org, "name": project, "domain": domain},
    "taskSpec": {
        "taskTemplate": {
            "id": {
                "resourceType": "TASK",
                "org": org,
                "project": project,
                "domain": domain,
                "name": "long_running_ml_task",
                "version": "tests",
            },
            "type": "container",
            "metadata": {
                "discoverable": False,
                "timeout": "0s",
                "retries": {"retries": 0},
                "interruptible": False,
                "cacheSerializable": False,
                "debuggable": False,
            },
            "interface": {"inputs": {"variables": []}, "outputs": {"variables": []}},
            "container": {
                "image": image,
                "command": ["/bin/sh", "-c"],
                "args": [command],
                "resources": {
                    "requests": [
                        {"name": "CPU", "value": "1"},
                        {"name": "MEMORY", "value": "1Gi"},
                    ]
                },
            },
        }
    },
    "inputs": {"literals": []},
    "source": "RUN_SOURCE_CLI",
}
print(json.dumps(payload, separators=(",", ":")))
' "$org" "$project" "$domain" "$image" "$command"
}

build_aione_instance_payload() {
  local source_org="$1"
  local project="$2"
  local domain="$3"
  local name="$4"
  local instance_id="$5"
  local authorized_key="$6"
  local image="$7"
  local timeout_hours="$8"
  local cpu="$9"
  local memory="${10}"

  python_json -c '
import json, math, sys
source_org, project, domain, name, instance_id, authorized_key, image, timeout_hours, cpu, memory = sys.argv[1:11]
def parse_positive_number(value, field):
    try:
        number = float(value)
    except ValueError as exc:
        raise SystemExit(f"{field} must be a positive number") from exc
    if not math.isfinite(number) or number <= 0:
        raise SystemExit(f"{field} must be a positive number")
    return int(number) if number.is_integer() else number
payload = {
    "org": source_org,
    "project": project,
    "domain": domain,
    "name": name,
    "id": instance_id,
    "timeout": parse_positive_number(timeout_hours, "timeout_hours"),
    "authorizedKey": authorized_key,
    "imageType": "BASE",
    "baseImage": {
        "image": image,
        "mountPath": "/data/lib1",
    },
    "codes": [],
    "datastores": [],
    "resourceDefinition": {
        "cpu": cpu,
        "memory": memory,
    },
}
print(json.dumps(payload, separators=(",", ":")))
' "$source_org" "$project" "$domain" "$name" "$instance_id" "$authorized_key" "$image" "$timeout_hours" "$cpu" "$memory"
}

parse_aione_instance_run_id() {
  python_json -c '
import json, sys
data = json.load(sys.stdin)
payload = data.get("data", data)
run = payload["run"]
print("/".join([run["org"], run["project"], run["domain"], run["name"]]))
' <<<"$1"
}

flyte_buf_curl() {
  local endpoint="$1"
  local procedure="$2"
  local payload="$3"
  local buf_bin repo_root schema_file status
  buf_bin="$(buf_command)"
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
  schema_file="$(mktemp --suffix=.binpb)"
  if ! (cd "$repo_root" && "$buf_bin" build --path flyteidl2 -o "$schema_file"); then
    rm -f "$schema_file"
    return 1
  fi
  if "$buf_bin" curl --schema "$schema_file" "$endpoint/$procedure" --data "$payload"; then
    status=0
  else
    status=$?
  fi
  rm -f "$schema_file"
  return "$status"
}
