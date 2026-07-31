import io
import json
import subprocess
import unittest

from scripts.cleanup_duplicate_cloud_storage_pvcs import cleanup


STORAGE_ID = "stg-420l82y3w0726yc505r6rwjfg2"
CANONICAL = f"cs-{STORAGE_ID}"


def pvc(name, phase="Bound", storage_id=STORAGE_ID, cloud_storage="true"):
    return {
        "metadata": {
            "name": name,
            "labels": {
                "flyte.org/cloud-storage": cloud_storage,
                "flyte.org/cloud-storage-id": storage_id,
            },
        },
        "status": {"phase": phase},
    }


class FakeKubectl:
    def __init__(self, pvcs, pods=None, delete_failures=None):
        self.pvcs = pvcs
        self.pods = pods or []
        self.delete_failures = set(delete_failures or [])
        self.calls = []

    def __call__(self, command, capture_output, text):
        self.calls.append(command)
        if command[-2:] == ["-o", "json"] and "pvc" in command:
            selector = command[command.index("-l") + 1]
            expected_labels = dict(part.split("=", 1) for part in selector.split(","))
            items = [
                item
                for item in self.pvcs
                if all(
                    (item.get("metadata", {}).get("labels", {}).get(key) == value)
                    for key, value in expected_labels.items()
                )
            ]
            return subprocess.CompletedProcess(
                command, 0, stdout=json.dumps({"items": items}), stderr=""
            )
        if command[-2:] == ["-o", "json"] and "pods" in command:
            return subprocess.CompletedProcess(
                command, 0, stdout=json.dumps({"items": self.pods}), stderr=""
            )
        if "delete" in command:
            name = command[command.index("pvc") + 1]
            return subprocess.CompletedProcess(
                command,
                1 if name in self.delete_failures else 0,
                stdout="",
                stderr="delete failed" if name in self.delete_failures else "",
            )
        raise AssertionError(f"unexpected command: {command}")


def running_pod(name, claim_name):
    return {
        "metadata": {"name": name},
        "status": {"phase": "Running"},
        "spec": {
            "volumes": [
                {"persistentVolumeClaim": {"claimName": claim_name}},
            ]
        },
    }


class CleanupDuplicateCloudStoragePvcsTest(unittest.TestCase):
    def run_cleanup(self, fake, apply=False):
        stdout = io.StringIO()
        stderr = io.StringIO()
        code = cleanup(
            storage_id=STORAGE_ID,
            namespace="flyte",
            apply=apply,
            run_command=fake,
            stdout=stdout,
            stderr=stderr,
        )
        return code, stdout.getvalue(), stderr.getvalue()

    def test_rejects_an_empty_storage_id_before_calling_kubectl(self):
        fake = FakeKubectl([])
        stdout = io.StringIO()
        stderr = io.StringIO()

        code = cleanup(
            storage_id=" ",
            namespace="flyte",
            apply=False,
            run_command=fake,
            stdout=stdout,
            stderr=stderr,
        )

        self.assertEqual(1, code)
        self.assertIn("storage id is required", stderr.getvalue())
        self.assertEqual([], fake.calls)

    def test_rejects_a_noncanonical_storage_id_before_calling_kubectl(self):
        fake = FakeKubectl([])
        stderr = io.StringIO()

        code = cleanup(
            storage_id="Store_A",
            namespace="flyte",
            apply=False,
            run_command=fake,
            stdout=io.StringIO(),
            stderr=stderr,
        )

        self.assertEqual(1, code)
        self.assertIn("storage id must be a canonical DNS name", stderr.getvalue())
        self.assertEqual([], fake.calls)

    def test_rejects_a_storage_id_longer_than_a_kubernetes_label(self):
        fake = FakeKubectl([])
        stderr = io.StringIO()

        code = cleanup(
            storage_id=f"stg-{'a' * 60}",
            namespace="flyte",
            apply=False,
            run_command=fake,
            stdout=io.StringIO(),
            stderr=stderr,
        )

        self.assertEqual(1, code)
        self.assertIn("storage id must be a canonical DNS name", stderr.getvalue())
        self.assertEqual([], fake.calls)

    def test_dry_run_lists_duplicates_without_deleting(self):
        fake = FakeKubectl([pvc(CANONICAL), pvc("legacy-a"), pvc("legacy-b")])

        code, stdout, stderr = self.run_cleanup(fake)

        self.assertEqual(0, code)
        self.assertEqual("", stderr)
        self.assertIn(f"KEEP flyte/{CANONICAL}", stdout)
        self.assertIn("WOULD DELETE flyte/legacy-a", stdout)
        self.assertIn("WOULD DELETE flyte/legacy-b", stdout)
        self.assertFalse(any("delete" in call for call in fake.calls))

    def test_apply_deletes_only_duplicates(self):
        fake = FakeKubectl([pvc(CANONICAL), pvc("legacy-a"), pvc("legacy-b")])

        code, stdout, stderr = self.run_cleanup(fake, apply=True)

        self.assertEqual(0, code)
        self.assertEqual("", stderr)
        deleted = [call[call.index("pvc") + 1] for call in fake.calls if "delete" in call]
        self.assertEqual(["legacy-a", "legacy-b"], deleted)
        self.assertNotIn(CANONICAL, deleted)
        self.assertIn("DELETED flyte/legacy-a", stdout)

    def test_skips_group_when_any_candidate_is_mounted(self):
        fake = FakeKubectl(
            [pvc(CANONICAL), pvc("legacy-a")],
            pods=[running_pod("active-pod", "legacy-a")],
        )

        code, _, stderr = self.run_cleanup(fake, apply=True)

        self.assertEqual(1, code)
        self.assertIn("active-pod", stderr)
        self.assertFalse(any("delete" in call for call in fake.calls))

    def test_skips_group_when_canonical_pvc_is_missing(self):
        fake = FakeKubectl([pvc("legacy-a")])

        code, _, stderr = self.run_cleanup(fake, apply=True)

        self.assertEqual(1, code)
        self.assertIn(f"canonical PVC {CANONICAL} is missing", stderr)
        self.assertFalse(any("delete" in call for call in fake.calls))

    def test_skips_group_when_any_pvc_is_not_bound(self):
        fake = FakeKubectl([pvc(CANONICAL), pvc("legacy-a", phase="Pending")])

        code, _, stderr = self.run_cleanup(fake, apply=True)

        self.assertEqual(1, code)
        self.assertIn("legacy-a is Pending", stderr)
        self.assertFalse(any("delete" in call for call in fake.calls))

    def test_skips_group_when_a_candidate_has_unexpected_labels(self):
        fake = FakeKubectl(
            [pvc(CANONICAL), pvc("legacy-a", cloud_storage="false")]
        )

        code, _, stderr = self.run_cleanup(fake, apply=True)

        self.assertEqual(1, code)
        self.assertIn("unexpected cloud storage labels", stderr)
        self.assertFalse(any("delete" in call for call in fake.calls))

    def test_stops_after_the_first_delete_failure(self):
        fake = FakeKubectl(
            [pvc(CANONICAL), pvc("legacy-a"), pvc("legacy-b")],
            delete_failures={"legacy-a"},
        )

        code, _, stderr = self.run_cleanup(fake, apply=True)

        self.assertEqual(1, code)
        self.assertIn("delete failed", stderr)
        deleted = [call[call.index("pvc") + 1] for call in fake.calls if "delete" in call]
        self.assertEqual(["legacy-a"], deleted)


if __name__ == "__main__":
    unittest.main()
