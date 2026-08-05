#!/usr/bin/env bash
set -euo pipefail

KNATIVE_SERVING_VERSION="${KNATIVE_SERVING_VERSION:-knative-v1.18.1}"
KNATIVE_KOURIER_VERSION="${KNATIVE_KOURIER_VERSION:-knative-v1.18.0}"
PROXY_URL="${PROXY_URL:-}"
NO_PROXY="${NO_PROXY:-127.0.0.1,localhost,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.svc,.cluster.local}"

KUBECTL="${KUBECTL:-kubectl}"
NERDCTL="${NERDCTL:-/usr/local/bin/nerdctl}"
NERDCTL_ADDRESS="${NERDCTL_ADDRESS:-/run/k3s/containerd/containerd.sock}"
NERDCTL_NAMESPACE="${NERDCTL_NAMESPACE:-k8s.io}"
WORKDIR="${TMPDIR:-/tmp}/aiops-flyte2-knative"

mkdir -p "$WORKDIR"

if [[ -n "$PROXY_URL" ]]; then
  export HTTP_PROXY="$PROXY_URL"
  export HTTPS_PROXY="$PROXY_URL"
  export http_proxy="$PROXY_URL"
  export https_proxy="$PROXY_URL"
fi
export NO_PROXY="$NO_PROXY"
export no_proxy="$NO_PROXY"

curl_args=(-L --fail --retry 5 --retry-delay 2 --connect-timeout 20)
if [[ -n "$PROXY_URL" ]]; then
  curl_args+=(--proxy "$PROXY_URL")
fi

download() {
  local url="$1"
  local out="$2"
  curl "${curl_args[@]}" -o "$out" "$url"
}

image_exists() {
  local image="$1"
  k3s ctr -n "$NERDCTL_NAMESPACE" images ls -q | grep -Fxq "$image"
}

archive_name_for_image() {
  local image="$1"
  printf '%s.tar' "$(printf '%s' "$image" | sha256sum | awk '{print $1}')"
}

import_digest_image() {
  local image="$1"
  local tag="$2"
  if image_exists "$image"; then
    printf 'Image already present: %s\n' "$image"
    return
  fi

  local repo="${image%@*}"
  local archive="$WORKDIR/$(archive_name_for_image "$image")"
  printf 'Importing image: %s\n' "$image"
  skopeo copy \
    --override-os linux \
    --override-arch amd64 \
    "docker://$image" \
    "docker-archive:$archive:$repo:$tag"
  "$NERDCTL" \
    --address "$NERDCTL_ADDRESS" \
    --namespace "$NERDCTL_NAMESPACE" \
    load -i "$archive"
  "$NERDCTL" \
    --address "$NERDCTL_ADDRESS" \
    --namespace "$NERDCTL_NAMESPACE" \
    tag "$repo:$tag" "$image"
}

import_tag_image() {
  local image="$1"
  if image_exists "$image"; then
    printf 'Image already present: %s\n' "$image"
    return
  fi

  local archive="$WORKDIR/$(archive_name_for_image "$image")"
  printf 'Importing image: %s\n' "$image"
  skopeo copy \
    --override-os linux \
    --override-arch amd64 \
    "docker://$image" \
    "docker-archive:$archive:$image"
  "$NERDCTL" \
    --address "$NERDCTL_ADDRESS" \
    --namespace "$NERDCTL_NAMESPACE" \
    load -i "$archive"
}

SERVING_CORE="$WORKDIR/serving-core.yaml"
KOURIER="$WORKDIR/kourier.yaml"

download \
  "https://github.com/knative/serving/releases/download/${KNATIVE_SERVING_VERSION}/serving-core.yaml" \
  "$SERVING_CORE"
download \
  "https://github.com/knative/net-kourier/releases/download/${KNATIVE_KOURIER_VERSION}/kourier.yaml" \
  "$KOURIER"

import_digest_image \
  "gcr.io/knative-releases/knative.dev/serving/cmd/queue@sha256:d0be939fdfb469e52e999eb65f39466d18f029984a782affa26322c9fec6db78" \
  "knative-v1.18.1-queue"
import_digest_image \
  "gcr.io/knative-releases/knative.dev/serving/cmd/activator@sha256:031408ec516f374636a77ce1c689accfcfa13154abfef96716e636405f64464c" \
  "knative-v1.18.1-activator"
import_digest_image \
  "gcr.io/knative-releases/knative.dev/serving/cmd/autoscaler@sha256:3502bb5aa60f485ec702f98f0391fa54d91a30e905a1b7ad0adddcd31205c79c" \
  "knative-v1.18.1-autoscaler"
import_digest_image \
  "gcr.io/knative-releases/knative.dev/serving/cmd/controller@sha256:5b93308a392c00381f0ac48e7f55806bce7b4d30c34cf399fc7dae3ec538b23d" \
  "knative-v1.18.1-controller"
import_digest_image \
  "gcr.io/knative-releases/knative.dev/serving/cmd/webhook@sha256:50831d9aaa69c4d2a8277d35650d3e2ad4832b4a04c0a089e715fd190fd8c273" \
  "knative-v1.18.1-webhook"
import_digest_image \
  "gcr.io/knative-releases/knative.dev/net-kourier/cmd/kourier@sha256:15a601147ef4574386e296c4b2456bb1e230d2dc110254295dddb56e5118b5a8" \
  "knative-v1.18.0-kourier"
import_tag_image "docker.io/envoyproxy/envoy:v1.34-latest"

"$KUBECTL" apply -f "$SERVING_CORE"
"$KUBECTL" apply -f "$KOURIER"

"$KUBECTL" -n knative-serving patch configmap config-network --type merge -p \
  '{"data":{"ingress-class":"kourier.ingress.networking.knative.dev","domain-template":"{{.Name}}.{{.Domain}}"}}'
"$KUBECTL" -n knative-serving patch configmap config-domain --type merge -p \
  '{"data":{"localhost":""}}'
"$KUBECTL" -n knative-serving patch configmap config-features --type merge -p \
  '{"data":{"kubernetes.podspec-init-containers":"enabled","kubernetes.podspec-persistent-volume-claim":"enabled","kubernetes.podspec-persistent-volume-write":"enabled","kubernetes.podspec-tolerations":"enabled","kubernetes.podspec-affinity":"enabled"}}'

"$KUBECTL" -n knative-serving rollout status deploy/activator --timeout=180s
"$KUBECTL" -n knative-serving rollout status deploy/autoscaler --timeout=180s
"$KUBECTL" -n knative-serving rollout status deploy/controller --timeout=180s
"$KUBECTL" -n knative-serving rollout status deploy/webhook --timeout=180s
"$KUBECTL" -n knative-serving rollout status deploy/net-kourier-controller --timeout=180s
"$KUBECTL" -n kourier-system rollout status deploy/3scale-kourier-gateway --timeout=180s

"$KUBECTL" -n knative-serving get deploy
"$KUBECTL" -n kourier-system get deploy,svc
