# 本地可复跑压测

两个脚本只接受 loopback URL；不会创建租户、提高现有合同配额、绕过认证或直接请求 Provider。使用独立数据库、独立 CODEX_HOME、专用端口和短期测试用户，先应用当前迁移，再按真实角色/合同配置建立测试身份。不要用现有业务项目运行。

测试账户准备文件为私有 JSON 数组，每项包含 `cookie`、`threadId`；图片编辑可另含 `image.filename` 和 `message`。通过正常 BFF 创建并绑定原生 thread；`cookie` 必须对应真实且未过期的 Better Auth 测试会话。文件保存在忽略目录，权限 0600，不得提交。

环境参数：

- `LOADTEST_BASE_URL`：独立 Web 服务，默认 `http://127.0.0.1:3100`。
- `LOADTEST_USERS_FILE`：私有测试用户 JSON 的路径。
- `LOADTEST_OUTPUT_DIR`：已创建的指标输出目录。
- `LOADTEST_COUNTS`：读取负载人数，默认 `20,30`，必须准备足够的不同用户。
- `LOADTEST_MODEL`：原生图片测试所用、当前服务支持的 Agent 模型。

```sh
# 20 / 30 用户，每轮 60 秒；按 1 秒思考时间轮流读取 4 类接口，保持 SSE。
LOADTEST_USERS_FILE=.runtime/loadtest/users.json \
LOADTEST_OUTPUT_DIR=.runtime/loadtest \
node scripts/load-test/web.mjs candidate 60000

# 真实图片调用：只接受恰好 10 个已配置的用户/原生 thread，会产生实际费用。
# 需事先获得调用授权；不要对失败或未知结果自动重跑。
LOADTEST_USERS_FILE=.runtime/loadtest/image-users.json \
LOADTEST_OUTPUT_DIR=.runtime/loadtest \
LOADTEST_MODEL=gpt-5.6-luna \
node scripts/load-test/native-images.mjs
```

原生脚本记录 BFF 提交确认、SSE 首事件、图片完成、原生 Turn 终态、历史图片读回。耗时包括本地请求与上游等待；没有中间图片帧时不会伪装图片流式输出。脚本不自动重试模型请求。运行后保留汇总 JSON，对失败和不确定结果做原生状态读回，再决定是否进行另一次明确的测试。

对于生产构建，用独立 `NEXT_DIST_DIR`；`apps/web/scripts/run-next.mjs` 会尊重该配置。不要一边重建当前正在服务的产物目录一边压测。原生恢复测试应先确认测试任务都已进入终态，再只重启隔离 Gateway，并读回同一个 thread 与图片版本；不得中断日常服务。

2026-09-11 的具体测试环境、前后结果和限制见 [报告](../../docs/reports/2026-09-11-local-launch-load-test.md)。本地结果不是生产容量或长时间稳定性证明。
