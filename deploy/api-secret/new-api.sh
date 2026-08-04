#!/usr/bin/env bash
set -euo pipefail


kubectl -n flyte create secret generic new-api \
  --from-literal=api-token="${NEW_API_TOKEN}" \
  --dry-run=client \
  -o yaml |
  kubectl apply -f -

printf 'New API  token secret updated.\n'
