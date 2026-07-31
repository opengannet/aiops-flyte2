#!/usr/bin/env python3

import argparse
import json
import re
import subprocess
import sys
from collections.abc import Callable
from typing import TextIO


RunCommand = Callable[..., subprocess.CompletedProcess[str]]


def canonical_pvc_name(storage_id: str) -> str:
    # The storage ID is also stored as a Kubernetes label value.
    if len(storage_id) > 63 or not re.fullmatch(
        r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", storage_id
    ):
        raise ValueError("storage id must be a canonical DNS name")
    return f"cs-{storage_id}"


def run_json(run_command: RunCommand, command: list[str]) -> dict:
    result = run_command(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "kubectl command failed")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("kubectl returned invalid JSON") from error


def cleanup(
    *,
    storage_id: str,
    namespace: str,
    apply: bool,
    run_command: RunCommand = subprocess.run,
    stdout: TextIO = sys.stdout,
    stderr: TextIO = sys.stderr,
) -> int:
    storage_id = storage_id.strip()
    if not storage_id:
        print("ERROR: storage id is required", file=stderr)
        return 1
    try:
        canonical = canonical_pvc_name(storage_id)
    except ValueError as error:
        print(f"ERROR: {error}", file=stderr)
        return 1
    selector = f"flyte.org/cloud-storage-id={storage_id}"
    try:
        pvc_list = run_json(
            run_command,
            ["kubectl", "-n", namespace, "get", "pvc", "-l", selector, "-o", "json"],
        )
        pod_list = run_json(
            run_command,
            ["kubectl", "-n", namespace, "get", "pods", "-o", "json"],
        )
    except RuntimeError as error:
        print(f"ERROR: {error}", file=stderr)
        return 1

    pvcs = pvc_list.get("items") or []
    by_name = {}
    for pvc in pvcs:
        metadata = pvc.get("metadata") or {}
        name = str(metadata.get("name") or "").strip()
        labels = metadata.get("labels") or {}
        if not name:
            print("ERROR: PVC with an empty name was returned", file=stderr)
            return 1
        if (
            labels.get("flyte.org/cloud-storage") != "true"
            or labels.get("flyte.org/cloud-storage-id") != storage_id
        ):
            print(
                f"ERROR: PVC {name} has unexpected cloud storage labels",
                file=stderr,
            )
            return 1
        by_name[name] = pvc

    if canonical not in by_name:
        print(f"ERROR: canonical PVC {canonical} is missing", file=stderr)
        return 1

    for name, pvc in sorted(by_name.items()):
        phase = str((pvc.get("status") or {}).get("phase") or "")
        if phase != "Bound":
            print(f"ERROR: PVC {name} is {phase or 'in an unknown phase'}", file=stderr)
            return 1

    candidate_names = set(by_name)
    for pod in pod_list.get("items") or []:
        phase = str((pod.get("status") or {}).get("phase") or "")
        if phase in {"Succeeded", "Failed"}:
            continue
        pod_name = str((pod.get("metadata") or {}).get("name") or "")
        for volume in (pod.get("spec") or {}).get("volumes") or []:
            claim_name = str(
                (volume.get("persistentVolumeClaim") or {}).get("claimName") or ""
            )
            if claim_name in candidate_names:
                print(
                    f"ERROR: PVC {claim_name} is used by non-terminal pod {pod_name}",
                    file=stderr,
                )
                return 1

    duplicates = sorted(name for name in by_name if name != canonical)
    print(f"KEEP {namespace}/{canonical}", file=stdout)
    if not duplicates:
        print("No duplicate PVCs found", file=stdout)
        return 0

    if not apply:
        for name in duplicates:
            print(f"WOULD DELETE {namespace}/{name}", file=stdout)
        return 0

    for name in duplicates:
        command = [
            "kubectl",
            "-n",
            namespace,
            "delete",
            "pvc",
            name,
            "--wait=true",
            "--timeout=120s",
        ]
        result = run_command(command, capture_output=True, text=True)
        if result.returncode != 0:
            print(
                f"ERROR: failed to delete {namespace}/{name}: "
                f"{result.stderr.strip() or 'kubectl delete failed'}",
                file=stderr,
            )
            return 1
        print(f"DELETED {namespace}/{name}", file=stdout)
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Delete legacy duplicate PVCs while retaining cs-<storage-id>."
    )
    parser.add_argument("--storage-id", required=True)
    parser.add_argument("--namespace", default="flyte")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete duplicates. Without this flag the command is a dry-run.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    return cleanup(
        storage_id=args.storage_id.strip(),
        namespace=args.namespace.strip(),
        apply=args.apply,
    )


if __name__ == "__main__":
    raise SystemExit(main())
