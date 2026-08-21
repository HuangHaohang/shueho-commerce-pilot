# Frontend Architecture

## 固定选型

本项目的网页前端固定采用：

| 能力 | 技术 | 规则 |
|---|---|---|
| Web framework | Next.js 15 App Router | 用于浏览器页面、服务端渲染边界、route handlers/BFF 适配和部署 |
| UI runtime | React 19 | 所有产品 UI 组件基于 React 函数组件 |
| Language | TypeScript strict mode | API payload、Codex event、approval、commerce object 都要有类型 |
| Styling | Tailwind CSS v4 | 样式来自 token 和有限 utility，不写页面级随意 CSS 主题 |
| UI kit | shadcn/ui + Radix UI | Button、Dialog、Popover、Tabs、Tooltip、Dropdown、Command 等基础交互统一来源 |
| Icons | lucide-react | 统一线性图标语言 |
| Server state | TanStack Query | 普通 API 的加载、缓存、重试、失效和错误边界 |
| Streaming | EventSource + typed React hooks | 接收后端网关 SSE，不直接连接 Codex App Server |
| Form validation | React Hook Form + Zod | 工具参数、审批参数、电商写操作参数必须校验 |
| Local state | Zustand | 只保存非权威 UI 状态；不得保存 token 或后端事实状态 |
| Tests | Vitest + Testing Library + Playwright | 单元、组件、关键流程截图和响应式检查 |

## Recommended Monorepo Shape

当前仓库已经有 Node/TypeScript Codex gateway。前端落地时推荐演进为：

```text
apps/
  web/                 # Next.js 15 browser product
  gateway/             # Codex App Server gateway; 可从现有 src/gateway 迁入
packages/
  ui/                  # shadcn wrappers, tokens, shared components
  contracts/           # API/Codex/commerce shared TypeScript types
  commerce-tools/      # 电商工具 schema、审批模型、读回证明模型
designs/
  DESIGN.md            # 本规范
  references/
```

在仓库还没有完成 monorepo 拆分前，也可以先保持现有 `src/gateway`，新增 `apps/web`。关键不是目录名，而是边界：

- Browser 只调用应用后端。
- Codex App Server 只由 gateway 持有。
- provider、credential、runtime state 只在服务端环境和受控存储中出现。
- UI 组件只依赖 typed API contract，不依赖 Codex app-server 私有协议细节。

## Frontend To Backend Boundary

浏览器允许：

- `GET /api/codex/events` 或同等 SSE 端点。
- `POST /api/threads` 创建/恢复 agent thread。
- `POST /api/threads/:threadId/turns` 提交用户消息或任务。
- `GET /api/server-requests` 读取待审批/待响应请求。
- `POST /api/server-requests/:id/respond` 提交人类审批或输入。
- 读取脱敏后的 commerce object、task、audit、workspace 数据。

浏览器禁止：

- 直接启动 `codex` 进程。
- 直接连接 Codex App Server stdio 或未认证 WebSocket。
- 读取 `CODEX_HOME`、provider config、provider secret、ERP token、 marketplace token。
- 自己拼接外部电商写操作请求绕过后端审批。

## Data Flow

```text
User
  -> Next.js UI
  -> App backend / gateway API
  -> Codex App Server process
  -> Codex harness
  -> commerce tools / MCP / ERP / marketplace APIs
  -> readback evidence
  -> gateway events
  -> SSE
  -> Next.js UI
```

UI 必须保留 streamed event，而不是只展示最终文本。对于电商写操作，UI 必须渲染“草案 -> 待审批 -> 执行中 -> 读回验证 -> 完成/失败”。

## Package Rules

允许作为前端基础依赖：

- `next`
- `react`
- `react-dom`
- `typescript`
- `tailwindcss`
- `@tailwindcss/postcss`
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `lucide-react`
- `@radix-ui/*`
- `@tanstack/react-query`
- `zod`
- `react-hook-form`
- `zustand`
- `vitest`
- `@testing-library/react`
- `@playwright/test`

新增以下类型依赖前必须有明确理由：

- 大型 UI 套件，例如 Ant Design、MUI、Bootstrap、Mantine。
- 拖拽/图表/表格等复杂库。确实需要时可以引入，但视觉和状态必须服从本设计系统。
- 动画库。默认使用 CSS transition；复杂动画需要说明业务价值并支持 reduced motion。

## Rendering Strategy

- 工作台首屏可以 SSR/静态 shell，但实时线程、审批、事件流必须在客户端组件中处理。
- 对用户身份、工作区、project list 可使用服务端预取，但 secret 绝不进入 HTML。
- commerce list/detail 可以用 TanStack Query 缓存，写操作完成后必须按对象类型精准失效。
- SSE 断线时 UI 显示连接状态和重连，不自动重复执行写操作。

## Error Handling

错误在 UI 中必须分类：

- `auth_required`: 需要登录或 session 失效。
- `permission_denied`: 用户无权查看或执行。
- `codex_unavailable`: gateway 可用但 Codex runtime 不可用。
- `provider_unavailable`: 模型 provider 配置或上游不可用。
- `commerce_dependency_failed`: ERP、店铺、物流、WMS、广告平台等依赖异常。
- `rate_limited`: 上游限流，需要等待或拆分任务。
- `approval_required`: 需要人类审批，不是错误。
- `readback_failed`: 写入后无法验证，必须提示风险。

## Implementation Acceptance

每个前端 PR 或任务至少说明：

- 使用哪些 token 和 shadcn 组件。
- 是否新增 API contract 或状态枚举。
- SSE/approval/readback 是否涉及。
- 已运行哪些验证。
- 截图检查覆盖的 viewport。
