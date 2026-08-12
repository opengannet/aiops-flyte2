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
import model_management_smoke
import model_start_smoke


class FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(
            {
                "status": 200,
                "data": {
                    "name": "mod-test",
                    "code": "deepseek4.0",
                    "profile": "VLLM",
                    "url": "http://example.test/models/mod-test",
                },
            }
        ).encode("utf-8")


class ModelSmokeCliTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        env_path = Path(self.temp_dir.name) / ".env"
        env_path.write_text(
            "\n".join(
                [
                    "ENDPOINT=http://example.test",
                    "AIONE_API_KEY=test-key",
                    "MODEL_ID=mod-test",
                    "STATUS_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/status",
                    "STOP_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/stop",
                    "LOG_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/log",
                    "MONITOR_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/monitor",
                    "MODEL_MONITOR_MODE=cpu,memory,gpu",
                    "MODEL_MONITOR_PERIOD=1h",
                    "MODEL_NAME=DeepSeek V4",
                    "MODEL_CODE=deepseek4.0",
                    "MODEL_IMAGE=vllm",
                    "MODEL_PARAM=--model\\n/models/deepseek",
                    "MODEL_SOURCE=https://git.example.com/models/deepseek.git",
                    "MODEL_SOURCE_BRANCH=master",
                    "MODEL_SOURCE_TOKEN=source-token",
                    "CPU=2",
                    "MEMORY=4Gi",
                    "GPU=1",
                    "GPU_NODE_LABEL_KEY=nvidia.com/gpu",
                    "PROJECT=aione",
                    "DOMAIN=development",
                ]
            ),
            encoding="utf-8",
        )
        self.env_patch = mock.patch.object(env_config, "ENV_PATH", env_path)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def test_model_payload_and_url_follow_the_public_contract(self):
        output = io.StringIO()
        requests = []

        def fake_urlopen(request, timeout):
            requests.append((request, timeout))
            return FakeResponse()

        with mock.patch.object(
            model_start_smoke.urllib.request, "urlopen", side_effect=fake_urlopen
        ):
            with contextlib.redirect_stdout(output):
                result = model_start_smoke.post_model(model_start_smoke.build_payload())

        self.assertEqual(
            {
                "status": 200,
                "data": {
                    "name": "mod-test",
                    "code": "deepseek4.0",
                    "profile": "VLLM",
                    "url": "http://example.test/models/mod-test",
                },
            },
            result,
        )
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/model/run",
            output.getvalue().splitlines()[0],
        )
        request, timeout = requests[0]
        self.assertEqual(60, timeout)
        self.assertEqual("Bearer test-key", request.headers["Authorization"])
        self.assertEqual(
            {
                "project": "aione",
                "domain": "development",
                "name": "DeepSeek V4",
                "id": "mod-test",
                "code": "deepseek4.0",
                "image": "vllm",
                "param": "--model\\n/models/deepseek",
                "resourceDefinition": {
                    "cpu": "2",
                    "memory": "4Gi",
                    "gpu": 1,
                    "gpu_key": "nvidia.com/gpu",
                },
                "codes": [
                    {
                        "id": "https://git.example.com/models/deepseek.git",
                        "branch": "master",
                        "token": "source-token",
                    }
                ],
            },
            json.loads(request.data.decode("utf-8")),
        )

    def test_model_management_requests_reuse_model_id_and_path_templates(self):
        requests = []

        def fake_urlopen(request, timeout):
            requests.append((request, timeout))
            return FakeResponse()

        with mock.patch.object(
            model_management_smoke.urllib.request,
            "urlopen",
            side_effect=fake_urlopen,
        ):
            model_management_smoke.request_model(
                method="GET", path_key="STATUS_API_PATH_TEMPLATE"
            )
            model_management_smoke.request_model(
                method="POST", path_key="STOP_API_PATH_TEMPLATE"
            )
            model_management_smoke.request_model(
                method="GET",
                path_key="LOG_API_PATH_TEMPLATE",
                query={"page": "1", "size": "200"},
            )
            model_management_smoke.request_model(
                method="GET",
                path_key="MONITOR_API_PATH_TEMPLATE",
                query={"mode": "cpu,memory,gpu", "period": "1h"},
            )

        self.assertEqual(
            [
                "http://example.test/v2/api/aione/model/mod-test/status",
                "http://example.test/v2/api/aione/model/mod-test/stop",
                "http://example.test/v2/api/aione/model/mod-test/log?page=1&size=200",
                "http://example.test/v2/api/aione/model/mod-test/monitor?mode=cpu%2Cmemory%2Cgpu&period=1h",
            ],
            [request.full_url for request, _timeout in requests],
        )
        self.assertEqual(
            ["GET", "POST", "GET", "GET"],
            [request.method for request, _timeout in requests],
        )
        self.assertTrue(
            all(
                request.headers["Authorization"] == "Bearer test-key"
                for request, _timeout in requests
            )
        )


if __name__ == "__main__":
    unittest.main()
