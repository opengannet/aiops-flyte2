#!/usr/bin/env python3
import sys

from env_config import require_config
from model_management_smoke import BASE_KEYS, print_result, request_model


def main() -> int:
    try:
        config = require_config(
            [*BASE_KEYS, "MONITOR_API_PATH_TEMPLATE", "MODEL_MONITOR_MODE", "MODEL_MONITOR_PERIOD"]
        )
        print_result(
            request_model(
                method="GET",
                path_key="MONITOR_API_PATH_TEMPLATE",
                query={
                    "mode": config["MODEL_MONITOR_MODE"].strip(),
                    "period": config["MODEL_MONITOR_PERIOD"].strip(),
                },
            )
        )
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
