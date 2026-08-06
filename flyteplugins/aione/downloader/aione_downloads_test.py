import io
import os
import subprocess
import sys
import tempfile
import types
import unittest
import zipfile
from unittest import mock

sys.modules.setdefault("minio", types.SimpleNamespace(Minio=object))
sys.modules.setdefault("requests", types.SimpleNamespace(get=lambda *_args, **_kwargs: None, Response=object))
sys.path.insert(0, os.path.dirname(__file__))

import aione_downloads as downloader


class FakeResponse:
    def __init__(self, status_code: int, content: bytes = b"") -> None:
        self.status_code = status_code
        self.content = content


def zip_bytes() -> bytes:
	data = io.BytesIO()
	with zipfile.ZipFile(data, "w") as archive:
		archive.writestr("repo-main/config.json", "{}")
		archive.writestr("repo-main/README.md", "model")
	return data.getvalue()


def zip_bytes_with_lfs_pointer() -> bytes:
    data = io.BytesIO()
    pointer = "\n".join(
        [
            "version https://git-lfs.github.com/spec/v1",
            "oid sha256:1111111111111111111111111111111111111111111111111111111111111111",
            "size 3087467144",
            "",
        ]
    )
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("repo-main/config.json", "{}")
        archive.writestr("repo-main/archive-only.txt", "stale")
        archive.writestr("repo-main/model.safetensors", pointer)
    return data.getvalue()


class DownloaderGitTests(unittest.TestCase):
    def test_non_empty_target_reuses_existing_contents_before_downloaders(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            target_dir = os.path.join(tmpdir, "model")
            os.makedirs(target_dir)
            with open(os.path.join(target_dir, "config.json"), "w", encoding="utf-8") as output:
                output.write("{}")

            with mock.patch.object(downloader.requests, "get") as get_mock:
                with mock.patch.object(downloader.subprocess, "run") as run_mock:
                    downloader._clone_git(
                        downloader.GitData(
                            repo_url="https://gitea.example.com/team/repo.git",
                            target_dir=target_dir,
                            access_token="secret-token",
                            branch="main",
                        )
                    )

            get_mock.assert_not_called()
            run_mock.assert_not_called()
            self.assertTrue(os.path.exists(os.path.join(target_dir, "config.json")))

    def test_non_empty_target_with_lfs_pointer_redownloads(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            target_dir = os.path.join(tmpdir, "model")
            os.makedirs(target_dir)
            with open(os.path.join(target_dir, "model.safetensors"), "w", encoding="utf-8") as output:
                output.write("version https://git-lfs.github.com/spec/v1\n")

            def fake_run(cmd: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                if cmd[:3] == ["git", "lfs", "pull"]:
                    with open(os.path.join(target_dir, "model.safetensors"), "wb") as output:
                        output.write(b"real safetensors data")
                    return subprocess.CompletedProcess(cmd, 0)
                os.makedirs(target_dir, exist_ok=True)
                with open(os.path.join(target_dir, "model.safetensors"), "w", encoding="utf-8") as output:
                    output.write("version https://git-lfs.github.com/spec/v1\n")
                return subprocess.CompletedProcess(cmd, 0)

            with mock.patch.object(downloader.requests, "get", side_effect=[FakeResponse(404), FakeResponse(404)]):
                with mock.patch.object(downloader.subprocess, "run", side_effect=fake_run) as run_mock:
                    downloader._clone_git(
                        downloader.GitData(
                            repo_url="https://gitea.example.com/team/repo.git",
                            target_dir=target_dir,
                            access_token="",
                            branch="main",
                        )
                    )

            commands = [call.args[0] for call in run_mock.call_args_list]
            self.assertEqual(2, len(commands), commands)
            with open(os.path.join(target_dir, "model.safetensors"), "rb") as output:
                self.assertEqual(b"real safetensors data", output.read())

    def test_gitlab_archive_download(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            target_dir = os.path.join(tmpdir, "model")
            response = FakeResponse(200, zip_bytes())
            logs: list[str] = []
            with mock.patch.object(downloader.requests, "get", return_value=response) as get_mock:
                with mock.patch.object(downloader, "flush_print", side_effect=lambda *args, **_: logs.append(" ".join(map(str, args)))):
                    downloader._clone_git(
                        downloader.GitData(
                            repo_url="https://gitlab.example.com/team/repo.git",
                            target_dir=target_dir,
                            access_token="secret-token",
                            branch="main",
                        )
                    )

            self.assertTrue(os.path.exists(os.path.join(target_dir, "config.json")))
            self.assertEqual(
                "https://gitlab.example.com/api/v4/projects/team%2Frepo/repository/archive.zip?sha=main",
                get_mock.call_args.args[0],
            )
            self.assertEqual("secret-token", get_mock.call_args.kwargs["headers"]["Private-Token"])
            self.assertNotIn("secret-token", "\n".join(logs))

    def test_gitea_archive_after_gitlab_miss(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            target_dir = os.path.join(tmpdir, "model")
            logs: list[str] = []
            with mock.patch.object(
                downloader.requests,
                "get",
                side_effect=[FakeResponse(404), FakeResponse(200, zip_bytes())],
            ) as get_mock:
                with mock.patch.object(downloader, "flush_print", side_effect=lambda *args, **_: logs.append(" ".join(map(str, args)))):
                    downloader._clone_git(
                        downloader.GitData(
                            repo_url="https://gitea.example.com/team/repo.git",
                            target_dir=target_dir,
                            access_token="secret-token",
                            branch="release",
                        )
                    )

            self.assertTrue(os.path.exists(os.path.join(target_dir, "config.json")))
            self.assertEqual(
                "https://gitea.example.com/api/v1/repos/team/repo/archive/release.zip",
                get_mock.call_args_list[1].args[0],
            )
            self.assertEqual("token secret-token", get_mock.call_args_list[1].kwargs["headers"]["Authorization"])
            self.assertNotIn("secret-token", "\n".join(logs))

    def test_gitea_clone_fallback_after_archive_misses(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            target_dir = os.path.join(tmpdir, "model")
            logs: list[str] = []

            def fake_run(cmd: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                os.makedirs(target_dir, exist_ok=True)
                with open(os.path.join(target_dir, "config.json"), "w", encoding="utf-8") as output:
                    output.write("{}")
                return subprocess.CompletedProcess(cmd, 0)

            with mock.patch.object(downloader.requests, "get", side_effect=[FakeResponse(404), FakeResponse(404)]):
                with mock.patch.object(downloader.subprocess, "run", side_effect=fake_run) as run_mock:
                    with mock.patch.object(downloader, "flush_print", side_effect=lambda *args, **_: logs.append(" ".join(map(str, args)))):
                        downloader._clone_git(
                            downloader.GitData(
                                repo_url="https://gitea.example.com/team/repo.git",
                                target_dir=target_dir,
                                access_token="secret-token",
                                branch="dev",
                            )
                        )

            command = run_mock.call_args.args[0]
            self.assertEqual(["git", "clone", "--depth", "1", "--branch", "dev"], command[:6])
            self.assertIn("secret-token", command[6])
            self.assertEqual(target_dir, command[7])
            self.assertTrue(os.path.exists(os.path.join(target_dir, "config.json")))
            self.assertNotIn("secret-token", "\n".join(logs))

    def test_lfs_pointer_archive_falls_back_to_git_lfs_pull(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            target_dir = os.path.join(tmpdir, "model")
            logs: list[str] = []

            def fake_run(cmd: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                if cmd[:3] == ["git", "lfs", "pull"]:
                    with open(os.path.join(target_dir, "model.safetensors"), "wb") as output:
                        output.write(b"real safetensors data")
                    return subprocess.CompletedProcess(cmd, 0)
                os.makedirs(target_dir, exist_ok=True)
                with open(os.path.join(target_dir, "config.json"), "w", encoding="utf-8") as output:
                    output.write("{}")
                with open(os.path.join(target_dir, "model.safetensors"), "w", encoding="utf-8") as output:
                    output.write("version https://git-lfs.github.com/spec/v1\n")
                return subprocess.CompletedProcess(cmd, 0)

            with mock.patch.object(
                downloader.requests,
                "get",
                side_effect=[FakeResponse(404), FakeResponse(200, zip_bytes_with_lfs_pointer())],
            ):
                with mock.patch.object(downloader.subprocess, "run", side_effect=fake_run) as run_mock:
                    with mock.patch.object(downloader, "flush_print", side_effect=lambda *args, **_: logs.append(" ".join(map(str, args)))):
                        downloader._clone_git(
                            downloader.GitData(
                                repo_url="https://gitea.example.com/team/repo.git",
                                target_dir=target_dir,
                                access_token="secret-token",
                                branch="main",
                            )
                        )

            commands = [call.args[0] for call in run_mock.call_args_list]
            self.assertEqual(2, len(commands), commands)
            self.assertEqual(["git", "clone", "--depth", "1", "--branch", "main"], commands[0][:6])
            self.assertEqual(["git", "lfs", "pull"], commands[1])
            with open(os.path.join(target_dir, "model.safetensors"), "rb") as output:
                self.assertEqual(b"real safetensors data", output.read())
            self.assertFalse(os.path.exists(os.path.join(target_dir, "archive-only.txt")))
            self.assertTrue(any("contains Git LFS pointer files" in line for line in logs))


if __name__ == "__main__":
    unittest.main()
