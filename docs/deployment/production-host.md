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

部署时显式设置 `COMMERCE_CONFIG_DIR` 为本机实际创建的受保护配置目录。服务安装目录、镜像版本、数据卷、推理服务地址及公网入口须以该机实际配置和验收结果为准；本文仅记录生产目标，不代表已部署或已验收。
