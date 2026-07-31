import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import env_config
import store_clear_smoke
import store_size_smoke


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class StoreSmokeCliTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(
            "\n".join(
                [
                    "ENDPOINT=http://example.test",
                    "AIONE_API_KEY=test-key",
                    "STORE_ID=cs-env",
                    "CLEAR_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/clear",
                    "PVC_SIZE_API_PATH_TEMPLATE=/v2/api/aione/pvc/{id}/size",
                ]
            ),
            encoding="utf-8",
        )
        self.env_patch = mock.patch.object(env_config, "ENV_PATH", self.env_path)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def test_store_clear_prints_store_clear_url(self):
        output = io.StringIO()
        with mock.patch.object(
            store_clear_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {}}),
        ):
            with contextlib.redirect_stdout(output):
                result = store_clear_smoke.delete_clear("cs/abc")

        self.assertEqual({"status": 200, "data": {}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/store/cs%2Fabc/clear",
            output.getvalue().splitlines()[0],
        )

    def test_store_clear_requires_store_id(self):
        with self.assertRaisesRegex(RuntimeError, "STORE_ID is required"):
            store_clear_smoke.delete_clear("")

    def test_store_size_prints_pvc_size_url(self):
        output = io.StringIO()
        with mock.patch.object(
            store_size_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse(
                {
                    "status": 200,
                    "data": {
                        "used": 123,
                        "provisioned": 456,
                        "available": 333,
                        "usagePercent": 26.97,
                        "statsSource": "hawk_history",
                        "statsTime": "2026-07-30T08:00:00.000Z",
                    },
                },
            ),
        ):
            with contextlib.redirect_stdout(output):
                result = store_size_smoke.get_size("cs/abc")

        self.assertEqual(
            {
                "status": 200,
                "data": {
                    "used": 123,
                    "provisioned": 456,
                    "available": 333,
                    "usagePercent": 26.97,
                    "statsSource": "hawk_history",
                    "statsTime": "2026-07-30T08:00:00.000Z",
                },
            },
            result,
        )
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/pvc/cs%2Fabc/size",
            output.getvalue().splitlines()[0],
        )

    def test_store_size_requires_store_id(self):
        with self.assertRaisesRegex(RuntimeError, "STORE_ID is required"):
            store_size_smoke.get_size("")


if __name__ == "__main__":
    unittest.main()
