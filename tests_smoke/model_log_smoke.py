#!/usr/bin/env python3
import sys

from env_config import require_config
from model_management_smoke import BASE_KEYS, print_result, request_model


def main() -> int:
    try:
        config = require_config([*BASE_KEYS, "LOG_API_PATH_TEMPLATE"])
        print_result(
            request_model(
                method="GET",
                path_key="LOG_API_PATH_TEMPLATE",
                query={
                    "page": config.get("LOG_PAGE", "1").strip() or "1",
                    "size": config.get("LOG_SIZE", "200").strip() or "200",
                },
            )
        )
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
