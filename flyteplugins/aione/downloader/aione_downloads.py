import base64
import json
import os
import shutil
import stat
import struct
import subprocess
import sys
import zipfile

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlparse

import requests
from minio import Minio


ARCHIVE_FILENAME = "archive.zip"
REQUEST_TIMEOUT_SECONDS = 60
GIT_LFS_POINTER_PREFIX = b"version https://git-lfs.github.com/spec/v1"
GIT_LFS_POINTER_SCAN_BYTES = 1024
GIT_LFS_POINTER_MAX_SIZE = 1024 * 1024
MAX_DOWNLOAD_ATTEMPTS = 2
SAFETENSORS_SUFFIX = ".safetensors"


@dataclass
class GitData:
    repo_url: str
    target_dir: str
    access_token: str
    branch: str


@dataclass
class S3Data:
    endpoint: str
    access_key: str
    secret_key: str
    bucket_name: str
    bucket_path: str
    target_dir: str


@dataclass
class WorkflowInputs:
    codes: list[GitData]
    s3datas: list[S3Data]


def mlworkflow() -> None:
    flush_print("Initializing downloads...")
    env_params = os.getenv("AIONE_PARAMS")
    if not env_params:
        raise ValueError("AIONE_PARAMS is required")

    params = json.loads(base64.b64decode(env_params).decode("utf-8"))
    mltask(_inputs(params))
    flush_print("Downloads completed")


def mltask(task_datas: WorkflowInputs) -> None:
    for git_data in task_datas.codes:
        flush_print("Downloading code/model repository")
        _clone_git(data=git_data)

    for s3_data in task_datas.s3datas:
        flush_print("Downloading dataset from object storage")
        _pull_oss(s3_data)


def _inputs(params: dict[str, Any]) -> WorkflowInputs:
    git_datas = [
        GitData(
            repo_url=code.get("id") or "",
            target_dir=code.get("path") or "",
            access_token=code.get("token") or "",
            branch=code.get("branch") or "master",
        )
        for code in (params.get("codes") or [])
    ]
    s3_datas = [
        S3Data(
            endpoint=f"{ossdata.get('endpoint')}:{ossdata.get('port')}",
            access_key=ossdata.get("accessKey") or "",
            secret_key=ossdata.get("secretKey") or "",
            bucket_name=ossdata.get("bucket") or "",
            bucket_path=(ossdata.get("bucketPath") or "").strip("/"),
            target_dir=ossdata.get("targetPath") or "",
        )
        for ossdata in (params.get("ossDatas") or [])
    ]
    return WorkflowInputs(codes=git_datas, s3datas=s3_datas)


def flush_print(*args: Any, **kwargs: Any) -> None:
    print(*args, **kwargs)
    sys.stdout.flush()


def _clone_git(data: GitData) -> None:
    if not data.repo_url:
        raise ValueError("repository URL is required")
    if not data.target_dir:
        raise ValueError("target directory is required")

    if os.path.exists(data.target_dir) and os.listdir(data.target_dir):
        integrity_error = _model_integrity_error(data.target_dir)
        if integrity_error is None:
            flush_print(f"Target directory {data.target_dir} is not empty; reusing existing contents")
            _make_tree_readable(data.target_dir)
            return
        flush_print(f"Target directory {data.target_dir} failed integrity validation: {integrity_error}; redownloading")
        _clear_directory(data.target_dir)

    last_error: Exception | None = None
    for attempt in range(1, MAX_DOWNLOAD_ATTEMPTS + 1):
        try:
            if not _download_gitlab_archive(data) and not _download_gitea_archive(data):
                _git_clone_fallback(data)

            integrity_error = _model_integrity_error(data.target_dir)
            if integrity_error is not None:
                raise RuntimeError(f"downloaded model failed integrity validation: {integrity_error}")
            return
        except Exception as exc:
            last_error = exc
            _clear_directory(data.target_dir)
            if attempt < MAX_DOWNLOAD_ATTEMPTS:
                flush_print(f"Model download attempt {attempt} failed: {exc}; clearing target directory and retrying")

    raise RuntimeError(
        f"model download failed integrity validation after {MAX_DOWNLOAD_ATTEMPTS} attempts"
    ) from last_error


def _download_gitlab_archive(data: GitData) -> bool:
    repo_root, project_path = _parse_git_url(data.repo_url)
    gitlab_rest_api_root = f"{repo_root}/api/v4/projects"
    encoded_project_path = quote(project_path, safe="")
    encoded_branch = quote(data.branch, safe="")
    url = f"{gitlab_rest_api_root}/{encoded_project_path}/repository/{ARCHIVE_FILENAME}?sha={encoded_branch}"
    headers = {"Private-Token": data.access_token} if data.access_token else {}
    return _download_archive("GitLab", url, headers, data.target_dir)


def _download_gitea_archive(data: GitData) -> bool:
    repo_root, project_path = _parse_git_url(data.repo_url)
    parts = [p for p in project_path.split("/") if p]
    if len(parts) < 2:
        return False
    owner, repo = parts[-2], parts[-1]
    encoded_owner = quote(owner, safe="")
    encoded_repo = quote(repo, safe="")
    encoded_branch = quote(data.branch, safe="")
    url = f"{repo_root}/api/v1/repos/{encoded_owner}/{encoded_repo}/archive/{encoded_branch}.zip"
    headers = {"Authorization": f"token {data.access_token}"} if data.access_token else {}
    return _download_archive("Gitea", url, headers, data.target_dir)


def _download_archive(source_name: str, url: str, headers: dict[str, str], target_dir: str) -> bool:
    response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
    if response.status_code != 200:
        flush_print(f"{source_name} archive download returned status {response.status_code}; trying next strategy")
        return False

    target_file = _save_archive_file(target_dir, response)
    flush_print(f"Archive downloaded to {target_file}")
    _unzip(target_dir)
    if _contains_git_lfs_pointer(target_dir):
        flush_print(f"{source_name} archive contains Git LFS pointer files; trying git clone with Git LFS")
        _clear_directory(target_dir)
        return False
    return True


def _git_clone_fallback(data: GitData) -> None:
    parent = os.path.dirname(data.target_dir)
    if parent:
        os.makedirs(parent, exist_ok=True)

    clone_url = _repo_url_with_token(data.repo_url, data.access_token)
    command = ["git", "clone", "--depth", "1", "--branch", data.branch, clone_url, data.target_dir]
    flush_print(f"Cloning repository {_redact_repo_url(data.repo_url)} at branch {data.branch}")
    env = os.environ.copy()
    env["GIT_LFS_SKIP_SMUDGE"] = "1"
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
    except FileNotFoundError as exc:
        raise RuntimeError("git is required for repository clone fallback") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"git clone fallback failed with exit code {exc.returncode}") from exc
    if _contains_git_lfs_pointer(data.target_dir):
        _git_lfs_pull(data.target_dir)
    _make_tree_readable(data.target_dir)


def _git_lfs_pull(target_dir: str) -> None:
    flush_print("Resolving Git LFS objects")
    try:
        subprocess.run(
            ["git", "lfs", "pull"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=target_dir,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("git-lfs is required to resolve Git LFS model files") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"git lfs pull failed with exit code {exc.returncode}") from exc
    if _contains_git_lfs_pointer(target_dir):
        raise RuntimeError("git lfs pull completed but Git LFS pointer files remain")


def _model_integrity_error(directory: str) -> str | None:
    if _contains_git_lfs_pointer(directory):
        return "contains Git LFS pointer files"

    for root, dirs, files in os.walk(directory):
        dirs[:] = [dirname for dirname in dirs if dirname != ".git"]
        for filename in files:
            if not filename.endswith(SAFETENSORS_SUFFIX):
                continue
            filepath = os.path.join(root, filename)
            error = _safetensors_integrity_error(filepath)
            if error is not None:
                return f"invalid safetensors file {filepath}: {error}"

    if _repository_uses_git_lfs(directory):
        try:
            subprocess.run(
                ["git", "lfs", "fsck"],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=directory,
            )
        except FileNotFoundError:
            return "git-lfs is required to verify Git LFS objects"
        except subprocess.CalledProcessError:
            return "Git LFS object integrity check failed"
    return None


def _repository_uses_git_lfs(directory: str) -> bool:
    if not os.path.isdir(os.path.join(directory, ".git")):
        return False
    attributes_file = os.path.join(directory, ".gitattributes")
    try:
        with open(attributes_file, "rb") as source:
            return b"filter=lfs" in source.read()
    except OSError:
        return False


def _safetensors_integrity_error(filepath: str) -> str | None:
    try:
        file_size = os.path.getsize(filepath)
        if file_size < 8:
            return "missing eight-byte header length"
        with open(filepath, "rb") as source:
            header_size_bytes = source.read(8)
            if len(header_size_bytes) != 8:
                return "incomplete header length"
            header_size = struct.unpack("<Q", header_size_bytes)[0]
            data_size = file_size - 8 - header_size
            if data_size < 0:
                return "header exceeds file size"
            header_bytes = source.read(header_size)
            if len(header_bytes) != header_size:
                return "incomplete header"
    except OSError as exc:
        return str(exc)

    try:
        header = json.loads(header_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return f"invalid JSON header: {exc}"
    if not isinstance(header, dict):
        return "header must be a JSON object"

    offsets: list[tuple[int, int]] = []
    for tensor_name, metadata in header.items():
        if tensor_name == "__metadata__":
            continue
        if not isinstance(metadata, dict):
            return f"tensor {tensor_name} metadata must be an object"
        data_offsets = metadata.get("data_offsets")
        if (
            not isinstance(data_offsets, list)
            or len(data_offsets) != 2
            or any(not isinstance(value, int) or isinstance(value, bool) for value in data_offsets)
        ):
            return f"tensor {tensor_name} has invalid data offsets"
        start, end = data_offsets
        if start < 0 or end < start or end > data_size:
            return f"tensor {tensor_name} data offsets are outside the data section"
        offsets.append((start, end))

    expected_start = 0
    for start, end in sorted(offsets):
        if start != expected_start:
            return "tensor data does not fully cover the data section"
        expected_start = end
    if expected_start != data_size:
        return "tensor data does not fully cover the data section"
    return None


def _repo_url_with_token(repo_url: str, token: str) -> str:
    if not token:
        return repo_url
    parsed = urlparse(repo_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return repo_url
    quoted_token = quote(token, safe="")
    return parsed._replace(netloc=f"oauth2:{quoted_token}@{parsed.netloc}").geturl()


def _redact_repo_url(repo_url: str) -> str:
    parsed = urlparse(repo_url)
    if parsed.username or parsed.password:
        return parsed._replace(netloc=parsed.hostname or "").geturl()
    return repo_url


def _save_archive_file(target_dir: str, response: requests.Response) -> str:
    target_dir = target_dir.rstrip("/")
    flush_print(f"Ensuring target directory {target_dir}")
    _ensure_dir(target_dir)

    target_filepath = f"{target_dir}/{ARCHIVE_FILENAME}"
    flush_print(f"Saving archive file {target_filepath}")
    with open(target_filepath, "wb") as f:
        f.write(response.content)
    _make_tree_readable(target_dir)
    return target_filepath


def _ensure_dir(directory: str) -> None:
    if not directory:
        raise ValueError("target directory is required")
    os.makedirs(directory, exist_ok=True)
    _make_tree_readable(directory)


def _make_tree_readable(directory: str) -> None:
    os.chmod(directory, stat.S_IRWXU | stat.S_IRWXG | stat.S_IRWXO)
    for root, dirs, files in os.walk(directory):
        for dirname in dirs:
            os.chmod(os.path.join(root, dirname), stat.S_IRWXU | stat.S_IRWXG | stat.S_IRWXO)
        for filename in files:
            os.chmod(
                os.path.join(root, filename),
                stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IWGRP | stat.S_IROTH | stat.S_IWOTH,
            )


def _clear_directory(directory: str) -> None:
    if not os.path.isdir(directory):
        return
    for name in os.listdir(directory):
        target = os.path.join(directory, name)
        if os.path.isdir(target) and not os.path.islink(target):
            shutil.rmtree(target)
        else:
            os.remove(target)


def _contains_git_lfs_pointer(directory: str) -> bool:
    if not os.path.isdir(directory):
        return False
    for root, _, files in os.walk(directory):
        if ".git" in root.split(os.sep):
            continue
        for filename in files:
            filepath = os.path.join(root, filename)
            try:
                if os.path.getsize(filepath) > GIT_LFS_POINTER_MAX_SIZE:
                    continue
                with open(filepath, "rb") as source:
                    if source.read(GIT_LFS_POINTER_SCAN_BYTES).startswith(GIT_LFS_POINTER_PREFIX):
                        return True
            except OSError:
                continue
    return False


def _unzip(target_dir: str) -> None:
    archive_file_path = f"{target_dir.rstrip('/')}/{ARCHIVE_FILENAME}"
    with zipfile.ZipFile(archive_file_path, "r") as zip_ref:
        all_files = zip_ref.infolist()
        top_level_dir = os.path.commonpath(file.filename for file in all_files)
        for file_info in all_files:
            relative_path = os.path.relpath(file_info.filename, top_level_dir)
            if relative_path == ".":
                continue
            target_path = os.path.join(target_dir, relative_path)
            if file_info.is_dir():
                os.makedirs(target_path, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with zip_ref.open(file_info.filename) as source, open(target_path, "wb") as target:
                target.write(source.read())

    os.remove(archive_file_path)
    _make_tree_readable(target_dir)
    flush_print(f"Archive extracted to {target_dir}")


def _parse_git_url(repo_url: str) -> tuple[str, str]:
    parsed_url = urlparse(repo_url)
    git_root = f"{parsed_url.scheme}://{parsed_url.netloc}"
    path = parsed_url.path.strip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return git_root, path


def _pull_oss(data: S3Data) -> None:
    client = Minio(
        endpoint=data.endpoint,
        access_key=data.access_key,
        secret_key=data.secret_key,
        secure=False,
    )
    _ensure_dir(data.target_dir)
    result = _download_directory(client, data)
    _make_tree_readable(data.target_dir)
    flush_print(f"Dataset downloaded to {data.target_dir}\n{result}")


def _download_directory(minio_client: Minio, data: S3Data) -> str:
    result: list[str] = []
    safe_data = {
        "endpoint": data.endpoint,
        "access_key": data.access_key,
        "bucket_name": data.bucket_name,
        "bucket_path": data.bucket_path,
        "target_dir": data.target_dir,
    }
    flush_print(safe_data)
    objects = minio_client.list_objects(data.bucket_name, prefix=data.bucket_path, recursive=True)
    for obj in objects:
        if obj.is_dir:
            continue
        obj_path = obj.object_name
        relative_path = obj_path
        if data.bucket_path:
            prefix = data.bucket_path.rstrip("/") + "/"
            relative_path = obj_path[len(prefix) :] if obj_path.startswith(prefix) else os.path.basename(obj_path)

        output_file = os.path.join(data.target_dir, relative_path)
        os.makedirs(os.path.dirname(output_file), exist_ok=True)
        minio_client.fget_object(data.bucket_name, obj_path, output_file)
        flush_print(f"Downloaded: {obj_path}, Target: {output_file}")
        result.append(f"Downloaded: {obj_path}, Target: {output_file}")
    return "\n".join(result)


if __name__ == "__main__":
    try:
        mlworkflow()
    except Exception as exc:
        flush_print(f"Download failed: {exc}")
        sys.exit(1)
