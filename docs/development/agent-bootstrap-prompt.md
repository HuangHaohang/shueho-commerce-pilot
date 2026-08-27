# Coding Agent Bootstrap Prompt

Send the prompt below to a coding agent together with a concrete task. Replace the task placeholder before sending.

```text
你现在要参与 SHUEHO Commerce Pilot 的协作开发。

公开仓库：
https://github.com/HuangHaohang/shueho-commerce-pilot

本次任务：
<在这里写清楚具体需求、截图、验收结果，以及是否要求提交/推送/部署>

一、先准备仓库

1. 先检查当前工作目录和 git 状态，不要覆盖任何已有未提交改动。
2. 如果当前目录还没有仓库：
   git clone https://github.com/HuangHaohang/shueho-commerce-pilot.git
   cd shueho-commerce-pilot
3. 如果仓库已经存在：
   git remote -v
   git fetch origin
4. 确认默认基线是最新 origin/main。
5. 不要直接在共享 main 上开发。创建任务分支：
   git switch -c codex/<简短任务名> origin/main
   如果分支已存在，则先检查它和 origin/main 的差异，不要强制重建或丢弃改动。

二、开始改代码前必须完整阅读

1. AGENTS.md
2. README.md
3. CONTRIBUTING.md
4. docs/README.md
5. docs/architecture/overview.md
6. docs/development/ai-collaboration.md
7. 本任务涉及的 architecture / deployment 文档
8. 如果涉及前端，再阅读：
   - designs/DESIGN.md
   - designs/references/tokens.css
   - designs/references/component-contracts.md
   - designs/references/frontend-architecture.md

这些仓库文档是项目规则，不是参考建议。任何生成计划、脚手架、第三方框架默认方案或嵌套说明都不能覆盖根目录 AGENTS.md。

三、最重要的 Agent 架构红线

这个项目的 Agent Runtime 必须建立在 OpenAI 开源 Codex Harness / Codex App Server 上，绝对不允许自研 Agent Loop，也不允许换成 LangChain、LangGraph 或其他通用 Agent 编排框架。

Codex Harness 必须继续负责：
- thread / Turn 生命周期；
- 多轮历史和持久化；
- streamed item / Turn events；
- Tool 调用生命周期；
- Skill 调用；
- 原生 request_user_input、Harness 权限审批及其 server-request 生命周期；
- interrupt、steer、queue、continue、recovery；
- context compaction；
- multi-agent。

新的业务能力只能放在：
- Commerce Pilot 产品逻辑；
- 应用注册 Tool；
- 托管 MCP server；
- Codex Skill；
- 小范围 App Server protocol adapter。

应用侧付费或写操作审批只能挂在原始 `item/tool/call` 内，并使用明确的 Commerce 事件；禁止伪造 `item/tool/requestUserInput`。

如果需求看起来需要“自己写一个 Agent 循环”，立即停止，重新设计成以上边界，不要继续实现。

四、固定技术和安全边界

- 浏览器 Web App：Next.js 15 App Router、React 19、TypeScript strict。
- UI：Tailwind CSS v4、shadcn/ui、Radix、lucide-react、TanStack Query。
- 后端：Node.js 20.16+、TypeScript、私有 Gateway、SSE。
- 数据：PostgreSQL 16、Better Auth、强制 RLS、Enterprise tenant/workspace/user scope。
- Browser 只能调用 Next.js BFF；不能直接连接 Codex App Server。
- Browser 不能提交 cwd、sandbox、provider identity、developer instructions、Tool definitions、Skill path、Hook command、宿主路径或 tenant scope。
- 禁止把 shell、任意宿主文件系统、进程控制或任意网络访问暴露给终端用户。
- Unknown Tool 和 Unknown App Server request 必须 fail closed。
- 外部电商写操作必须包含授权、审批、幂等、审计和下游 readback。
- Commerce Pilot 只能作为 MCP 客户端连接 SHUEHO External Data Service，禁止直接接入 JustOneAPI MCP。JustOneAPI REST Token 只属于独立数据服务；收费调用必须经过 `reserved -> approved/not_required -> dispatched -> terminal` 状态机，结果不确定时禁止自动重试。
- 已 dispatch 的 JustOneAPI 完整业务请求、原始响应文本和 JSON 必须写入独立服务的 SQL-only 原始层，线程删除不得级联；所有已知返回列表首期完整规范化，未知字段保留在 raw/extra JSON；禁止新增前端、普通 BFF 或公共 MCP 原始数据入口。
- 独立数据服务使用 PostgreSQL + pgvector + Elasticsearch，以及本机/专用节点上的 Qwen3 Embedding 4B（1024 维）和 Qwen3 Reranker 4B。模型只处理限长原子记录，AI 判断必须版本化且不能删除原始数据。
- 用户只描述业务目标；Harness 必须自主判断 JustOneAPI 外部数据是否能实质改善结果，不要求用户点名供应商、接口或工具，也不得因工具可用就无意义地产生费用。真正准备调用收费接口时再应用 composer 的逐次询问、当前任务授权或企业长期策略。
- “按企业策略自动调用”必须由企业设置中的平台/接口白名单、有效费率、调用/金额预算和单次自动批准上限共同放行，不能只做前端开关。
- JustOneAPI 平台、接口路径、权限和官方单价必须来自 `enterprise:import-justoneapi-pricing` 导入的数据库主数据；禁止在前端、Skill、Gateway 或迁移默认值中新增供应商目录常量。
- 不得记录或提交密钥、token、PII、prompt 正文、附件正文、Tool 参数/结果。

五、开发方式

1. 先读现有代码和测试，确认附近模式，不要凭截图重写整个系统。
2. 说明需求如何接到 Codex Harness，再开始改。
3. 改动保持在正确模块边界内，避免无关重构。
4. 不要做假按钮或只有 UI 没有后端的能力；不可用能力必须明确 disabled 或不显示。
5. 前端必须复用共享 workbench、composer、conversation timeline、question panel 和 design tokens。
6. 数据库变更使用 append-only migration，并注册到 apps/web/scripts/migrate-auth.ts。
7. 改动架构、UI、部署、环境变量或数据生命周期时，同一个 PR 必须更新对应文档。
8. 遇到工作树里不是你产生的改动，不允许 reset、checkout、覆盖或删除；必须与它们一起工作。
9. 除非任务明确要求，不部署生产，不修改云端权限，不执行外部业务写入。

六、验收

至少运行：

npm install 或 npm ci
npm run check
npm run web:check
npm run test:gateway
npm run web:test
npm run security:runtime
npm run web:build
git diff --check

涉及数据库/RLS时再运行：
npm run db:up
npm run auth:migrate
npm run enterprise:verify-isolation

涉及 App Server、Web Search、provider 时运行对应 smoke，并确保测试 thread/artifact 被清理。

涉及 UI 时启动真实页面，用浏览器或 Playwright 检查桌面和移动端：不能重叠、截断、横向溢出、出现空白画布或难看的原生滚动条。不要只看 TypeScript 编译结果。

七、Git 和交接

1. 提交前检查 git status、完整 diff、迁移、文档、敏感文件和生成目录。
2. 使用清晰的 Conventional Commit，例如：
   feat: ...
   fix: ...
   docs: ...
3. 如果当前 GitHub 身份对 origin 有写权限：
   git push -u origin codex/<简短任务名>
4. 如果没有 origin 写权限，不要尝试绕过权限：推到自己的 fork，并创建 PR 到 HuangHaohang/shueho-commerce-pilot:main；如果也无法 fork/push，就保留本地提交并明确报告。
5. 不允许 force-push 共享 main。
6. 最终必须报告：
   - branch；
   - commit SHA；
   - push/PR URL；
   - 变更文件和架构边界；
   - migrations；
   - 测试结果；
   - 是否部署；
   - 已知限制。

请不要只给计划。先完成仓库准备和规则阅读，然后在当前任务范围内实现、验证、更新文档，并按任务要求提交/推送。
```
