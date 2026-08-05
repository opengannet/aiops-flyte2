import base64
import json
import os
import stat
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

    if _download_gitlab_archive(data):
        return
    if _download_gitea_archive(data):
        return
    _git_clone_fallback(data)


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
    return True


def _git_clone_fallback(data: GitData) -> None:
    if os.path.exists(data.target_dir) and os.listdir(data.target_dir):
        flush_print(f"Target directory {data.target_dir} is not empty; reusing existing contents")
        _make_tree_readable(data.target_dir)
        return

    parent = os.path.dirname(data.target_dir)
    if parent:
        os.makedirs(parent, exist_ok=True)

    clone_url = _repo_url_with_token(data.repo_url, data.access_token)
    command = ["git", "clone", "--depth", "1", "--branch", data.branch, clone_url, data.target_dir]
    flush_print(f"Cloning repository {_redact_repo_url(data.repo_url)} at branch {data.branch}")
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except FileNotFoundError as exc:
        raise RuntimeError("git is required for repository clone fallback") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"git clone fallback failed with exit code {exc.returncode}") from exc
    _make_tree_readable(data.target_dir)


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
