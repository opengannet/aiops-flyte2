#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-flyte}"
SELECTOR="${SELECTOR:-flyte.org/app-managed=true}"

if ! kubectl api-resources --api-group=serving.knative.dev -o name | grep -qx 'services'; then
  printf 'Knative Serving CRDs are not installed; no legacy Apps to remove.\n'
  exit 0
fi

printf 'Deleting legacy KService Apps in namespace %s with selector %s\n' "$NAMESPACE" "$SELECTOR"
kubectl -n "$NAMESPACE" delete services.serving.knative.dev -l "$SELECTOR" --ignore-not-found
