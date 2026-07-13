# Flyte 2.0 SSH Workspace Plugin

本文档说明本仓库为 Flyte 2.0 增加的自定义插件、部署方式和本地 `tests/` 调用脚本。

## 修改内容

- 新增核心任务插件：`flyteplugins/aione/sshworkspace`
- 注册任务类型：`ssh_workspace`
- 在 `executor/setup.go` 中注册插件，使 `flyte-binary` 启动时自动加载
- 新增本地调用脚本：
  - `deploy/tests/start_ssh_workspace.sh`
  - `deploy/tests/start_ml_task.sh`
  - `deploy/tests/get_run_status.sh`
  - `deploy/tests/get_ssh_workspace_connection.sh`
- 修复普通 Pod/container 任务无声明输出时仍读取 `outputs.pb` 的问题。无输出任务成功退出后直接标记成功；声明了输出或插件显式写了输出时仍保留原输出读取逻辑。
- 新增部署脚本：`scripts/deploy-aiops-flyte.sh`

## SSH 工作空间任务

`ssh_workspace` 任务会为一次 Flyte Run 创建以下 Kubernetes 资源：

- `Secret`：保存研发人员的 SSH 公钥
- `PersistentVolumeClaim`：保存 `/workspace` 数据，默认在 Abort 后保留
- `StatefulSet`：运行一个长期可登录的 SSH Pod
- `Service`：暴露 Pod 的 22 端口，默认使用 `NodePort`

任务自定义配置字段：

```json
{
  "image": "ubuntu:22.04",
  "sshUser": "dev",
  "authorizedKeys": ["ssh-rsa ..."],
  "cpu": "1",
  "memory": "2Gi",
  "workspaceSize": "20Gi",
  "serviceType": "NodePort",
  "nodePort": 30222,
  "environment": {
    "EXAMPLE": "value"
  }
}
```

## 部署到 aione-flyte2

默认部署目标是 `aione-flyte2`，远端安装单节点 k3s、Helm 和 Docker，并部署 `charts/flyte-devbox`。

```bash
bash scripts/deploy-aiops-flyte.sh
```

如远端下载需要代理：

```bash
PROXY_URL=http://172.19.210.24:7897 bash scripts/deploy-aiops-flyte.sh
```

常用环境变量：

```bash
REMOTE_HOST=aione-flyte2
REMOTE_DIR=flyte-work
NAMESPACE=flyte
RELEASE=flyte-devbox
IMAGE_REPOSITORY=flyte-binary-v2
IMAGE_TAG=ssh-workspace
PROXY_URL=http://172.19.210.24:7897
```

部署脚本默认通过 `git archive HEAD` 把当前仓库版本同步到远端，远端构建镜像：

```bash
flyte-binary-v2:ssh-workspace
```

部署完成后脚本会输出 k3s Ingress 的访问地址，例如：

```bash
Web UI: http://172.19.66.218:30080/v2
API endpoint: http://172.19.66.218:30080
```

然后访问 Web UI：

```text
http://172.19.66.218:30080/v2
```

本地 API endpoint 使用同一个 Ingress：

```text
http://172.19.66.218:30080
```

## 启动 SSH 工作空间

脚本依赖 `buf`、`python3` 和可访问 Flyte API 的 `ENDPOINT`。

```bash
ENDPOINT=http://172.19.66.218:30080 \
ORG=testorg \
PROJECT=flytesnacks \
DOMAIN=development \
AUTHORIZED_KEY_FILE="$HOME/.ssh/id_rsa.pub" \
NODE_PORT=30222 \
bash deploy/tests/start_ssh_workspace.sh
```

返回值只输出 Flyte 工作流 ID，例如：

```text
testorg/flytesnacks/development/abc123
```

工作流 Ready 后可查询 SSH 连接信息：

```bash
NAMESPACE=flyte bash deploy/tests/get_ssh_workspace_connection.sh testorg/flytesnacks/development/abc123
```

返回示例：

```json
{"host":"10.0.0.11","port":30222,"user":"dev","namespace":"flyte","serviceName":"abc123-ssh","podName":"abc123-0"}
```

研发人员登录：

```bash
ssh dev@10.0.0.11 -p 30222
```

## 启动持续运行的机器学习任务

```bash
ENDPOINT=http://172.19.66.218:30080 \
ORG=testorg \
PROJECT=flytesnacks \
DOMAIN=development \
IMAGE=rancher/mirrored-library-busybox:1.37.0 \
COMMAND='echo ml task started; sleep 3600' \
bash deploy/tests/start_ml_task.sh
```

返回值只输出 Flyte 工作流 ID。

PowerShell 可以直接执行封装脚本：

```powershell
cd D:\flyte-work\deploy\tests
.\ps_start_workflow.ps1
```

该脚本会通过 WSL/bash 调用 `deploy/tests/start_ml_task.sh`，并在 bash 内设置：

```bash
IMAGE='rancher/mirrored-library-busybox:1.37.0'
COMMAND='echo ml task started; sleep 3600'
```

## 查询工作流状态

```bash
ENDPOINT=http://172.19.66.218:30080 bash deploy/tests/get_run_status.sh /flytesnacks/development/abc123
```

返回格式：

```json
{
  "phase": 4,
  "error": "",
  "durationSeconds": 12
}
```

`phase` 为 Flyte 2 `ActionPhase` 数字状态码。完整枚举说明见
[`docs/aione-api-enums.md`](aione-api-enums.md)。

## 单元测试

```bash
go test ./executor/pkg/plugin/k8s -count=1
go test ./flyteplugins/aione/sshworkspace -count=1
bash deploy/tests/test_flyte_api_scripts.sh
bash deploy/tests/test_deploy_aiops_flyte.sh
```
