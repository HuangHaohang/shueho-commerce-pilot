---
version: "1.0"
style: "chatgpt_like_commerce_agent_web"
status: "project-authority"
confirmedAt: "2026-08-21"
scope:
  - "frontend architecture"
  - "ui kit"
  - "visual design"
  - "layout"
  - "component contracts"
  - "frontend development rules"
resources:
  manifest: "manifest.json"
  tokens: "references/tokens.css"
  frontendArchitecture: "references/frontend-architecture.md"
  layoutSystem: "references/layout-system.md"
  componentContracts: "references/component-contracts.md"
  stateMatrix: "references/state-matrix.md"
---

# shueho-commerce-pilot 前端设计规范

> 本目录是本仓库前端设计与开发的事实来源。后续任何网页前端实现、重构、组件引入、页面搭建和视觉调整，都必须先符合本规范，再进入代码实现。
>
> 附件中的外部 `designs` 目录只用于参考文档组织方式，不继承其 WPS SSO、采购后台、蓝青色后台主题或其他业务内容。截图只作为视觉方向参考：学习 ChatGPT 网页端的安静、克制、留白和工作台结构，不复制 ChatGPT 品牌、商标、Logo 或专有 UI 资产。

## 1. Frontend Architecture

本项目是网页应用，不是桌面应用。前端技术架构固定如下：

| 层级 | 选型 | 约束 |
|---|---|---|
| Web App | Next.js 15 App Router + React 19 + TypeScript | 面向浏览器交付，使用服务端能力承接认证、BFF、元数据和部署适配 |
| Styling | Tailwind CSS v4 + CSS Custom Properties | Tailwind 只消费设计 token，不允许在组件内散落一次性颜色体系 |
| UI Kit | shadcn/ui + Radix UI primitives | 作为基础组件规范；不引入 Ant Design、MUI、Bootstrap、Mantine 作为主 UI 体系 |
| Icons | lucide-react | 所有通用工具按钮优先用 lucide 图标，避免手写 SVG 图标体系 |
| Server State | TanStack Query | 管理普通 API 请求、缓存、重试、失效和 optimistic boundary |
| Streaming | native EventSource + typed hooks | Codex App Server 事件通过后端网关转为 SSE，浏览器不得直连 Codex App Server |
| Forms | React Hook Form + Zod | 表单输入、工具参数、审批表单和电商动作参数必须结构化校验 |
| Local UI State | Zustand, only when needed | 仅保存侧栏展开、当前工作区、composer 草稿等非权威 UI 状态 |
| Testing | Vitest + Testing Library + Playwright | 单元、组件交互和关键页面截图都必须覆盖高风险路径 |

前端只能调用本应用同源后端或受控 BFF，例如 `/api/threads`、`/api/codex/events`、`/api/server-requests`。浏览器不得直接持有 Codex runtime 凭据、provider secret、ERP token、 marketplace token，不能直接启动或连接 Codex App Server stdio/WebSocket。

详细架构见 [`references/frontend-architecture.md`](references/frontend-architecture.md)。

## 2. UI Kit Decision

主 UI 套件固定为 **shadcn/ui**：

- shadcn/ui 的组件代码可落在仓库中，便于按本项目 token 调整，而不是被第三方主题锁死。
- Radix primitives 提供 Dialog、Popover、Dropdown、Tooltip、Tabs、Switch、Select、Combobox 类交互的可访问性基础。
- Tailwind v4 和 CSS 变量能直接表达本规范的灰白、低对比、轻阴影视觉。
- lucide-react 与截图中极简线性图标方向一致，适合侧栏、工具按钮、审批动作和电商对象状态。

不采用 Ant Design/MUI 作为主 UI，因为它们默认带强后台产品视觉，会把本项目推向“传统企业管理台”，和本项目要做的 ChatGPT-like agent 工作台不一致。局部复杂表格可以后续引入 TanStack Table，但表格视觉仍必须服从本规范。

## 3. Visual Baseline

截图要提炼的视觉基线：

- 左侧固定窄侧栏，约 `258px`，浅灰白背景，菜单项低对比选中态。
- 主画布大量留白，不做营销 hero，不做装饰渐变，不做复杂仪表盘首屏。
- 顶部居中有模式切换 pill，例如“聊天 / 工作”，当前模式用白底轻阴影表达。
- 中央是核心工作台：一句短标题 + 大号圆角 composer + 下方项目选择/上下文选择区域。
- 边框、阴影、hover 都非常克制；视觉优先级来自布局和留白，而不是颜色冲击。
- 字体使用系统无衬线中文栈，正文自然、紧凑、清晰。

本项目不能复制 `ChatGPT` 字样、OpenAI Logo 或截图里的用户品牌。产品命名和文案围绕 “SHUEHO Commerce Pilot / 电商 Agent / 工作台”。

## 4. Design Principles

1. **工作台优先**：首页就是可用的 agent 工作台，不做介绍页、营销页、功能说明页。
2. **安静可信**：默认浅色、低饱和、灰白空间，复杂电商操作通过结构化状态和审批表达，不靠醒目色块制造存在感。
3. **输入即入口**：用户主要从 composer 发起订单、库存、商品、售后、报表和运营分析任务。
4. **审批明确**：任何会改变外部电商数据的动作，都必须显示目标系统、记录、字段、影响、审批动作和写后读回证据。
5. **事件可追踪**：Codex streaming 事件必须保留为可读的过程时间线，不把长任务压扁成一个 loading spinner。
6. **少即是结构**：只在必要处使用卡片。页面 section 不做悬浮大卡片，卡片不嵌套卡片。
7. **不要换肤漂移**：禁止为单个页面另起颜色、圆角、阴影、字体、间距系统。

## 5. Visual Tokens

设计 token 以 [`references/tokens.css`](references/tokens.css) 为基准。实现时要映射到 Tailwind theme 和 shadcn CSS variables。

核心值：

| Token | 值 | 用途 |
|---|---:|---|
| `--cp-bg` | `#ffffff` | 主画布 |
| `--cp-bg-subtle` | `#f7f7f8` | 页面轻底、侧栏 hover |
| `--cp-sidebar` | `#f9f9f9` | 左侧导航 |
| `--cp-surface` | `#ffffff` | composer、popover、dialog、menu |
| `--cp-border` | `#e5e5e5` | 输入、分割线、容器边界 |
| `--cp-text` | `#0d0d0d` | 主文本 |
| `--cp-text-muted` | `#6b6b6b` | 辅助文本 |
| `--cp-focus` | `#8f8f8f` | 中性 focus-visible；composer 内部输入不得出现绿色矩形框 |
| `--cp-radius-item` | `8px` | 菜单项、重复 item、列表行 |
| `--cp-radius-composer` | `24px` | 中央 composer |
| `--cp-sidebar-width` | `258px` | 桌面侧栏 |
| `--cp-content-max` | `820px` | 中央工作台最大宽度 |

`--cp-focus` 不是主视觉色，只用于键盘 focus-visible。默认按钮和主文本以中性黑灰为主；成功、连接正常等状态可使用 `--cp-success`，但不得让 composer 内部输入出现绿色矩形框。

## 6. Layout System

布局见 [`references/layout-system.md`](references/layout-system.md)。必须遵守：

- Desktop：左侧 sidebar 固定 `258px`，右侧 workspace 占满；主工作台在剩余区域居中。
- Main composer：最大宽度 `820px`，最小高度 `128px`，圆角 `24px`，边框和阴影极轻。
- Top mode switch：固定在主区域顶部居中，使用 pill segmented control，不做横向大导航。
- Sidebar menu：每行 `36px`，左右 `12px`，图标 `18px`，文字 `14px`。
- Mobile：侧栏折叠为抽屉或顶部入口；composer 贴近屏宽但保留 `16px` 外边距；不得出现横向滚动。
- 页面级 section 不使用浮动卡片。重复实体，如订单、商品、审批项，可以使用 `8px` 圆角 item/card。

## 7. Component Contracts

组件契约见 [`references/component-contracts.md`](references/component-contracts.md)。首批组件必须覆盖：

创作空间的专属视觉语言见 [`references/creative-space-ui.md`](references/creative-space-ui.md)。该规范优先约束创作空间的背景、色彩、字体、纸张层级、装饰和响应式表现；全局组件无法满足时应提供创作空间专属 Variant。

- `AppShell`
- `Sidebar`
- `ModeSwitch`
- `WorkComposer`
- `ProjectSelector`
- `CreativeSpaceWorkspace`
- `ContentProjectWorkspace`
- `AgentEventStream`
- `ApprovalPanel`
- `CommerceObjectPreview`
- `CommandButton`
- `EmptyState`
- `Dialog`
- `Toast`

每个组件必须定义 default、hover、focus-visible、active、disabled、loading、empty、error 状态。所有图标按钮必须有 tooltip 或 aria-label。所有状态文本必须中文优先，专业名词可保留英文。

## 8. Commerce Agent UX Rules

- Composer placeholder 使用任务型语言，例如“处理订单、库存、商品、售后或报表事务”。
- 电商对象必须显示对象类型、外部系统、业务编号、状态和最近更新时间；不能只显示一段自然语言。
- 需要审批的动作必须有独立审批面板，不能把确认按钮塞进普通 assistant 消息里。
- 写操作必须呈现四个阶段：草案、待审批、已执行、已读回验证。
- 长任务必须显示 Codex 事件流和最终结果摘要；不能只有“处理中...”。
- 外部系统错误必须区分认证失败、权限不足、限流、上游异常、数据不存在、写入冲突。
- 涉及客户信息、订单地址、手机号、支付信息等敏感数据时，默认脱敏；只有必要业务上下文中才显示最小字段。

## 9. State Matrix

状态矩阵见 [`references/state-matrix.md`](references/state-matrix.md)。至少覆盖：

- App boot / gateway unavailable / Codex unavailable / authenticated / unauthenticated
- Thread idle / starting / streaming / waiting approval / interrupted / failed / completed
- Tool draft / approval pending / running / readback pending / verified / rejected / failed
- Commerce object loading / empty / stale / conflict / permission denied

状态不允许靠多个散落 boolean 临时拼接。共享状态必须有明确枚举、来源和 UI 映射。

## 10. Accessibility And Internationalization

- 所有交互控件必须可键盘访问，并提供 `focus-visible` 样式。
- Dialog、Popover、Tooltip、Menu、Tabs、Switch、Select 使用 Radix/shadcn primitives。
- 动态状态进入 `aria-live="polite"`，审批和错误使用语义化标题。
- 支持 `prefers-reduced-motion`，禁用非必要位移动效。
- 中文为默认语言；按钮必须是动作词，例如“执行”“审批通过”“重新读取”“取消”。
- 不在 UI 中堆叠解释性使用说明；需要帮助信息时使用 tooltip、empty state 或文档链接。

## 11. Frontend Development Rules

- 新页面必须先映射到本规范中的 layout、tokens 和 component contracts。
- 新组件默认使用 shadcn/ui + Tailwind + CSS variables；不得手写一套按钮、弹层、菜单、输入框基础体系。
- 图标优先 lucide-react。只有业务图形确实不存在时，才允许新增本地 SVG。
- 禁止 gradient orb、bokeh、深色蓝紫渐变、营销型 hero、卡片套卡片和后台大色块主题。
- 字体大小不能随 viewport width 缩放；letter spacing 保持 `0`。
- 文本不得溢出、遮挡或压住相邻内容。固定格式控件必须有稳定尺寸、min/max 或 aspect-ratio。
- 前端不得直接读取 provider secret、Codex config、ERP credential、 marketplace credential。
- 所有写操作 UI 必须调用后端审批/执行接口，并在成功后呈现读回证据。
- PR 或任务完成前，关键页面需要通过 Playwright 截图检查桌面和移动宽度，确认无空白、重叠、横向滚动和异常跳动。

## 12. Acceptance Contract

任何前端改动完成时，交付说明必须覆盖：

- 使用了哪些本规范组件和 token。
- 是否新增 shadcn 组件、lucide 图标或状态枚举。
- 是否涉及 Codex event stream、approval、commerce write/readback。
- 已完成哪些验证：TypeScript、lint、unit test、Playwright screenshot、手工浏览器检查。
- 若未完成某项验证，必须说明原因。

本规范优先级高于临时视觉偏好、第三方组件默认主题和生成式脚手架默认样式。需要改变主技术架构、UI 套件、视觉风格或产品方向时，必须先得到用户明确确认。
