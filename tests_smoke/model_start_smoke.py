#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

from env_config import require_config


REQUIRED_KEYS = [
    "ENDPOINT",
    "AIONE_API_KEY",
    "MODEL_ID",
    "MODEL_NAME",
    "MODEL_CODE",
    "MODEL_IMAGE",
    "CPU",
    "MEMORY",
    "PROJECT",
    "DOMAIN",
]


def load_config() -> dict[str, str]:
    return require_config(REQUIRED_KEYS)


def build_run_path(config: dict[str, str]) -> str:
    model_id = urllib.parse.quote(config["MODEL_ID"], safe="")
    return f"/api/v1/models/{model_id}/run"


def build_payload() -> dict:
    config = load_config()
    resources = {"cpu": config["CPU"], "memory": config["MEMORY"]}
    gpu = config.get("GPU", "").strip()
    if gpu:
        try:
            resources["gpu"] = int(gpu)
        except ValueError as exc:
            raise ValueError("GPU must be an integer") from exc
        resources["gpu_key"] = config.get("GPU_NODE_LABEL_KEY", "nvidia.com/gpu")

    payload = {
        "project": config["PROJECT"],
        "domain": config["DOMAIN"],
        "name": config["MODEL_NAME"],
        "id": config["MODEL_ID"],
        "code": config["MODEL_CODE"],
        "image": config["MODEL_IMAGE"],
        "param": config.get("MODEL_PARAM", ""),
        "resourceDefinition": resources,
    }
    source = config.get("MODEL_SOURCE", "").strip()
    if source:
        payload["codes"] = [
            {
                "id": source,
                "branch": config.get("MODEL_SOURCE_BRANCH", ""),
                "token": config.get("MODEL_SOURCE_TOKEN", ""),
            }
        ]
    return payload


def post_model(payload: dict) -> dict:
    config = load_config()
    url = config["ENDPOINT"].rstrip("/") + build_run_path(config)
    print("URL:", url)
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {config['AIONE_API_KEY']}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def main() -> int:
    try:
        result = post_model(build_payload())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
