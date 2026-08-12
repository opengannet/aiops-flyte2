#!/usr/bin/env python3
import json
import urllib.error
import urllib.parse
import urllib.request

from env_config import require_config


BASE_KEYS = ["ENDPOINT", "AIONE_API_KEY", "MODEL_ID"]


def request_model(
    *,
    method: str,
    path_key: str,
    query: dict[str, str] | None = None,
) -> dict:
    config = require_config([*BASE_KEYS, path_key])
    model_id = config["MODEL_ID"].strip()
    if not model_id:
        raise RuntimeError("MODEL_ID is required")

    path = config[path_key].format(
        type="model",
        id=urllib.parse.quote(model_id, safe=""),
    )
    url = config["ENDPOINT"].rstrip("/") + path
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    print("URL:", url)
    request = urllib.request.Request(
        url,
        method=method,
        headers={"Authorization": f"Bearer {config['AIONE_API_KEY']}"},
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def print_result(result: dict) -> None:
    print(json.dumps(result, ensure_ascii=False, indent=2))
