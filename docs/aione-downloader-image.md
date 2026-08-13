# aione-downloader 镜像策略

`aione-downloader` 是模型、代码和数据下载初始化容器。它更新频率较低，统一使用稳定标签：

```text
aione-downloader:latest
```

`scripts/deploy-aiops-flyte.sh` 每次部署都会先把当前源码构建为节点 k3s containerd 中的
`aione-downloader:latest`，再把 Flyte 服务的 `AIONE_DOWNLOADER_IMAGE` 设置为同一地址。
模型 Pod 的初始化容器使用 `IfNotPresent`：节点已经存在该镜像时直接复用，不会在每次模型启动时
访问外部镜像仓库。

因此 downloader 的更新方式是重新执行正式部署脚本，而不是为每个 Git 提交生成新标签。部署后可用
以下命令确认镜像和运行时配置一致：

```bash
sudo k3s ctr -n k8s.io images ls | grep 'aione-downloader:latest'
kubectl -n flyte get deploy flyte-binary -o yaml | grep -A2 AIONE_DOWNLOADER_IMAGE
```

如果模型 Pod 仍引用历史的 `aione-downloader:main-<commit>`，先确认 Flyte 服务已滚动到新配置，
然后停止并重新启动该模型，使控制器用 `latest` 重新生成 Pod。
