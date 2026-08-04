#!/usr/bin/env bash
set -euo pipefail

: "${HAWK_API_KEY:?export HAWK_API_KEY before creating the Hawk secret}"

kubectl -n flyte create secret generic flyte-console-hawk \
  --from-literal=api-key="${HAWK_API_KEY}" \
  --dry-run=client \
  -o yaml |
  kubectl apply -f -
