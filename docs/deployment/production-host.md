# 生产机器

| 配置项 | 值 |
| --- | --- |
| 主机地址 | `192.168.50.144` |
| SSH 用户 | `user` |

```sh
ssh user@192.168.50.144
```

登录密码通过运维凭据渠道提供，不写入仓库、示例配置或命令。

## 部署入口

- [运行时部署与验证](runtime.md)
- [浏览器工作台部署](../../deploy/production-web/README.md)
- [公共 MCP 部署](../../deploy/production-mcp/README.md)
- [供应商代理部署](justoneapi-proxy.md)

生产机运行 Windows 与 Docker Desktop Linux 容器，服务根目录为 `C:\shueho-commerce-pilot`，受保护配置目录为 `C:\shueho-commerce-pilot\config`。部署时从版本目录运行 `deploy/production-web/compose.ps1`，并将 `COMMERCE_CONFIG_DIR` 显式设置为受保护配置目录。Compose 覆盖文件还包括该目录中的 `windows.yaml` 与 `jobs.yaml`。

生产机的 CLI Proxy API 通过本机 `cpa-image-url-proxy` 在端口 `8317` 提供兼容的 `/v1` 接口；Gateway 容器的 Provider 地址为 `http://host.docker.internal:8317/v1`。Provider ID 保持 `luusmosh_cpa`，以保留已有 Codex 会话与用量归属。Gateway 专用 CPA 密钥只存放在受保护的 `gateway.env` 中，不放入浏览器、镜像或源码。升级前备份 `gateway.env` 与 CPA 配置，并从 Gateway 容器验证带鉴权的 `/v1/models`。镜像版本、数据卷、推理服务地址及公网入口以该机的实际配置和验收结果为准。
