#!/usr/bin/env python3
import sys

from model_management_smoke import print_result, request_model


def main() -> int:
    try:
        print_result(
            request_model(method="POST", path_key="STOP_API_PATH_TEMPLATE")
        )
        return 0
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
