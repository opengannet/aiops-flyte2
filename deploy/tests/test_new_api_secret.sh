#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/deploy/api-secret/new-api.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat >"$TMP_DIR/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >"$TEST_TMP_DIR/curl.args"
printf '{"success":true,"data":"generated-pat-value"}\n'
EOF
cat >"$TMP_DIR/kubectl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" >>"$TEST_TMP_DIR/kubectl.args"
if [[ "$*" == *'--dry-run=client'* ]]; then
  printf 'apiVersion: v1\nkind: Secret\n'
else
  cat >/dev/null
fi
EOF

chmod +x "$TMP_DIR/curl" "$TMP_DIR/kubectl"

output="$(
  PATH="$TMP_DIR:$PATH" \
    TEST_TMP_DIR="$TMP_DIR" \
    NEW_API_TOKEN='stored-management-token' \
    bash "$SCRIPT"
)"

kubectl_args="$(cat "$TMP_DIR/kubectl.args")"

[[ ! -e "$TMP_DIR/curl.args" ]]
[[ "$kubectl_args" == *'new-api'* ]]
[[ "$kubectl_args" == *'--from-literal=api-token=stored-management-token'* ]]
[[ "$output" == *'New API token secret updated.'* ]]
[[ "$output" != *'stored-management-token'* ]]

printf 'PASS deploy/tests/test_new_api_secret.sh\n'
