# 本地可复跑压测

所有驱动使用独立 loopback 环境，禁止日常 3000/8787；数据库夹具仅接受显式指定、名称含 `_scale_` 的可丢弃本地库。不修改日常租户、合同或任务。项目执行仍由 Codex 开源 Harness 承担。

## 100 用户读取验证

1. 在可丢弃库执行当前 Web 迁移；将 owner 连接显式放在 `SCALE_DATABASE_URL`，不能使用日常 `commerce_pilot` 库。
2. 运行 `node scripts/load-test/prepare-read-fixtures.mjs prepare`。生成100个合成用户、真实 Better Auth 会话、单租户/工作区及正常RBAC；不创建模型Turn。
3. 构建 Gateway 与独立 Web 产物：`npm run build`；设置 `NEXT_DIST_DIR=.next-scale-validation` 后 `npm run web:build`。Windows 使用 `npm.cmd`。构建产物被Git忽略。
4. `node scripts/load-test/run-read-environment.mjs review` 只输出脱敏计划。经审查后由操作者执行 `node scripts/load-test/run-read-environment.mjs start`，启动3100/8887/8888并检查readiness。当前launcher明确绑定 `commerce_pilot_scale_20260912`，数据库role为 `commerce_pilot_app`，默认测试凭据不能用于生产。
5. 在另一个终端运行 `node scripts/load-test/prepare-read-fixtures.mjs bind`，通过正常BFF创建空的原生creative threads。创建不确定时保留receipt并停止，不能自动重复创建。
6. 执行读取驱动，保留JSON与非零退出结果：

```powershell
$env:LOADTEST_USERS_FILE = '.runtime/scale-validation/users.json'
$env:LOADTEST_OUTPUT_DIR = '.runtime/scale-validation'
$env:LOADTEST_COUNTS = '20,30,100'
node scripts/load-test/web.mjs candidate 60000
```

launcher用独立staging目录和受限环境启动，避免Gateway/MCP/Next.js读取真实`.env`。模型目录stub仅`/models`成功；所有模型执行请求拒绝并计数。Ctrl+C只关闭该launcher的子进程，保留日志、数据库和Harness历史。默认`review`不启动任何服务。该launcher尚未在本次任务中完成端到端运行；隔离Gateway启动被自动审批策略拦截，不能用静态计划测试冒充实际压测。

`SCALE_SECURE_COOKIES`默认true，匹配production Web；development Web需显式false。私有fixture在`.runtime/scale-validation`，不可提交、分享或打印cookie/session token。目录stub不提供成功的模型响应，因此此流程验证**认证HTTP读取与SSE连接**，不验证100个AI任务并发。

读取驱动默认每轮60秒、每用户约1秒思考时间。周期读取错峰，SSE保持同时建连；每个用户必须覆盖线程列表、状态、画布、图片会话四类接口。验证实际业务JSON形状与线程身份，每条SSE必须收到完整`gateway/connected`帧。没有样本、缺少用户/接口覆盖、仅返回登录HTML或挂起空SSE都不能通过。

环境参数：

- `LOADTEST_BASE_URL`：默认 `http://127.0.0.1:3100`，仅独立loopback HTTP。
- `LOADTEST_USERS_FILE` / `LOADTEST_OUTPUT_DIR`：私有身份和指标路径。
- `LOADTEST_COUNTS`：默认 `20,30,100`，1–200；需要足够的不同身份。
- `LOADTEST_THINK_MS`：默认1000；0可做短时突发测试，不能把该场景当日常吞吐。
- `LOADTEST_REQUEST_TIMEOUT_MS`：默认15000，100–60000。
- `LOADTEST_MAX_P95_MS`：默认1500；`LOADTEST_MAX_ERROR_RATE`默认0。

任一轮未满足延迟、错误率、接口覆盖或SSE条件，脚本退出非零。长时间浸泡测试应保存每轮结果并观察运行服务的内存、CPU、数据库池和outbox；本机短测试不证明生产持续容量。

## 数据库往返对比

```powershell
$env:DATABASE_URL = 'postgresql://commerce_pilot_app:commerce_pilot_app_dev@127.0.0.1:55432/commerce_pilot_scale_20260912'
$env:COMMERCE_ENFORCE_DATABASE_RLS = 'true'
$env:COMMERCE_DATABASE_POOL_MAX = '20'
$env:TSX_TSCONFIG_PATH = 'apps/web/tsconfig.json'
node --import tsx scripts/load-test/database-context.mjs
```

使用同一连接池交替运行三轮旧四语句初始化与新事务helper，每轮100用户×20事务。每次核验事务scope与自己的成员关系，不读取或输出业务正文。它不包含HTTP、SSE或模型耗时，不能作为端到端容量结果。

## 原生生成与恢复

`native-images.mjs`仍只接受恰好10个经过正常BFF绑定的真实用户/thread，会产生实际费用；必须先获得明确调用授权。有效模型服务、原生Harness、租户隔离、预算和审批均应正常，不能使用目录stub。脚本不自动重试未知或失败的模型请求。

```powershell
$env:LOADTEST_USERS_FILE = '.runtime/loadtest/image-users.json'
$env:LOADTEST_OUTPUT_DIR = '.runtime/loadtest'
$env:LOADTEST_MODEL = 'gpt-5.6-luna'
node scripts/load-test/native-images.mjs
```

分别记录提交确认、首个有效事件、图片产物、原生Turn终态和历史读回。没有中间像素帧时不能假装实现了图片流式预览。恢复测试只重启独立Gateway，并读回同一thread；不得以新建任务或重复付费调用冒充恢复。

## server244 生产验收

`production-load-fixtures.mjs` 只接受生产库 `commerce_pilot`、固定生产租户、100 个隔离合成身份和显式授权字符串。`prepare` 创建身份与独立工作区，`bind` 通过真实 BFF 创建原生 Harness thread，`cleanup` 先逐一等待 BFF 删除任务完成，再删除合成身份。收据和 cookie 只能放在服务器受保护的 `production-load` 目录。

生产域名可解析时使用 `https://commerce.shueho.com`。若外部 DNS 正在故障，允许在 server244 的 Compose backend 内使用唯一的 `http://web-edge:8080` 目标；驱动仍固定发送生产 Origin，且收据把传输标为 `server244_internal_bff`。这个模式验证生产 BFF、数据库、Gateway、Harness 和 Provider，不证明 Cloudflare/DNS/TLS 链路健康。

`image-model-comparison.mjs` 仅接受 `gpt-image-2`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`。每轮选择 10 个不同用户，以相同质量和提示词并发生成 10 张，再用每张真实产物并发完成 10 次改图；逐 Turn 核对原生终态、模型、质量、产物下载、完整解码和 SHA-256。提交结果不确定时只保留收据并读取协调，禁止自动重提。

若生成已经由 Harness 确认完成，但驱动在产物字段或下载门禁处停止，`resume` 只接受原收据中 10 个已提交 generation、零个已提交 edit 的精确状态。它先逐项重查原生用户消息、Turn、终态、模型、质量和产物，再下载原图并启动尚未提交的改图；任何已提交 edit 都会拒绝续跑。

参见[公司开放门槛](../../docs/deployment/company-readiness.md)、[本轮验证](../../docs/reports/2026-09-12-company-readiness.md)及[早期30用户/10图片报告](../../docs/reports/2026-09-11-local-launch-load-test.md)。
