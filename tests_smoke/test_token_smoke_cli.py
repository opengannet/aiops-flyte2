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
import token_smoke


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class TokenSmokeCliTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(
            "\n".join(
                [
                    "ENDPOINT=https://flyte2.example.test",
                    "AIONE_API_KEY=external-api-key",
                    "TOKEN_API_PATH=/token",
                    "LLM_MODEL=sakamakismile/Qwen3.6-27B-NVFP4",
                    "LLM_AUTH_TOKEN=dashboard-token",
                ]
            ),
            encoding="utf-8",
        )
        self.env_patch = mock.patch.object(env_config, "ENV_PATH", self.env_path)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def test_create_token_posts_model_and_dashboard_token(self):
        output = io.StringIO()
        payload = {
            "status": 200,
            "data": {
                "model": "sakamakismile/Qwen3.6-27B-NVFP4",
                "name": "flyte-test",
                "key": "sk-created-key",
            },
        }
        requests: list[token_smoke.urllib.request.Request] = []

        def fake_urlopen(request, timeout):
            requests.append(request)
            self.assertEqual(60, timeout)
            return FakeResponse(payload)

        with mock.patch.object(
            token_smoke.urllib.request,
            "urlopen",
            side_effect=fake_urlopen,
        ):
            with contextlib.redirect_stdout(output):
                result = token_smoke.create_token()

        self.assertEqual(payload, result)
        self.assertEqual("URL: https://flyte2.example.test/token", output.getvalue().splitlines()[0])
        self.assertEqual("Bearer external-api-key", requests[0].headers["Authorization"])
        self.assertEqual("application/json", requests[0].headers["Content-type"])
        self.assertEqual(
            {
                "model": "sakamakismile/Qwen3.6-27B-NVFP4",
                "token": "dashboard-token",
            },
            json.loads(requests[0].data.decode("utf-8")),
        )

    def test_main_masks_returned_key(self):
        payload = {
            "status": 200,
            "data": {
                "model": "model-a",
                "name": "flyte-test",
                "key": "sk-created-key",
            },
        }
        with mock.patch.object(
            token_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse(payload),
        ):
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = token_smoke.main()

        self.assertEqual(0, exit_code)
        self.assertNotIn("sk-created-key", stdout.getvalue())
        self.assertIn("sk-c*********key", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
