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

## CPA 图片工具透传

CPA 8.0.12 的受保护配置必须包含：

```yaml
multimedia:
  disable-image-generation: passthrough
```

此设置保留客户端明确声明的图片工具，并保持 `/v1/images/generations` 与 `/v1/images/edits` 可用；CPA 不再自动向普通 Responses 请求添加托管图片工具。Harness 可以通过 `input` 中的 `additional_tools` 声明 `image_gen.imagegen`，不一定使用顶层 `tools`。CPA 默认注入会遗漏这个声明，造成 `Function 'image_gen.imagegen' conflicts with a hosted tool in the same request`，重试不能修复。

修改前在主机受保护目录备份 CPA 配置。使用该版本的 `multimedia` 配置层级，不要套用旧版顶层字段。Windows 文件挂载未热加载时，需要在维护窗口重启 `cli-proxy-api`，无需重建 Commerce Pilot 或改动会话卷。

验收从 Gateway 容器经过实际 Provider 地址发送诊断请求：在 `additional_tools` 中声明原生图片工具，设置 `tool_choice: "none"` 并要求只回复 `OK`。必须收到 HTTP 200 和 `response.completed`，且没有工具调用；不能仅以配置文件内容或 `/models` 成功作为验收。检查转换后的工具类型，确认没有额外注入 `image_generation`。不要重放用户研究、付费数据查询或图片生成来测试配置；日志检查只输出工具类型和完成状态，不输出提示词、凭据或客户数据。
