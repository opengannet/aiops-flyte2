#!/usr/bin/env python3
import copy
import json
import sys
import urllib.error
import urllib.request

from env_config import require_config


REQUIRED_KEYS = [
    "ENDPOINT",
    "AIONE_API_KEY",
    "TOKEN_API_PATH",
    "LLM_MODEL",
    "LLM_AUTH_TOKEN",
]


def load_config() -> dict[str, str]:
    return require_config(REQUIRED_KEYS)


def create_token() -> dict:
    config = load_config()
    url = config["ENDPOINT"].rstrip("/") + config["TOKEN_API_PATH"]
    print("URL:", url)
    payload = {
        "model": config["LLM_MODEL"].strip(),
        "token": config["LLM_AUTH_TOKEN"].strip(),
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
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
        result = create_token()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(mask_result(result), ensure_ascii=False, indent=2))
    return 0


def mask_result(result: dict) -> dict:
    masked = copy.deepcopy(result)
    data = masked.get("data")
    if isinstance(data, dict) and isinstance(data.get("key"), str):
        data["key"] = mask_key(data["key"])
    return masked


def mask_key(key: str) -> str:
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "*********" + key[-3:]


if __name__ == "__main__":
    raise SystemExit(main())
