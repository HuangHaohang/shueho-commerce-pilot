# Component Contracts

## Shared Rules

所有组件遵守：

- 基于 shadcn/ui、Radix primitives、Tailwind 和 `tokens.css`。
- 图标使用 lucide-react。
- 支持 keyboard、focus-visible、disabled、loading、error。
- 外部数据输入要有 typed props，不直接接收任意 API response。
- 不在组件内硬编码 provider secret、credential、token 或完整 PII。
- 不使用独立主题色；颜色来自 token。

## AppShell

职责：

- 组织 sidebar、workspace、mode switch、全局 toast、dialog root。
- 承接 auth/gateway/codex 基础状态。
- 提供页面级 error boundary。

状态：

| 状态 | UI |
|---|---|
| booting | 轻量 skeleton，保留布局尺寸 |
| ready | 正常渲染 |
| gateway_unavailable | 主区稳定错误面板，侧栏仍可见 |
| codex_unavailable | 显示 Codex runtime 不可用和重试动作 |
| unauthenticated | 显示登录动作，但不清空非敏感 UI 布局 |

## Sidebar

职责：

- 提供一级导航、工作区入口和账户区。
- 当前项低对比高亮。
- 移动端进入 drawer。

必须包含：

- `NewTask` 或等价新工作入口。
- `MarketResearch` 或等价市场调研入口。
- `CreativeSpace` 或等价创作空间入口。
- `KnowledgeBase`。
- `More`，内部收纳 `Scheduled` 和 `Plugins`，不得把这两项同时放在一级导航。
- Account/workspace footer。

交互：

- 菜单项 `36px` 高。
- hover 使用 `--cp-surface-hover`。
- active 不使用亮色背景。
- 图标和文字间距 `10px - 12px`。
- `More` 使用从侧栏右侧弹出的独立菜单，不在侧栏内部向下展开。
- 弹出菜单使用 `--cp-radius-popover`、轻边框和 `--cp-shadow-popover`，并提供 `aria-expanded`、`aria-haspopup` 与 menu roles。
- 点击菜单外、按 `Escape` 或选择菜单项时关闭弹出菜单。
- 登录用户的“最近”列表来自服务端 thread 索引并按更新时间倒序显示；选中项映射到真实 Codex thread id。
- “新任务”必须清除当前客户端 thread/SSE 状态并返回空白 composer，但不得删除历史记录；活动 turn 期间暂时禁用，避免遗失运行状态。
- 点击历史记录必须经过用户所有权检查并用 App Server `thread/read` 恢复 turns；刷新页面自动恢复最近 thread，不得只依赖浏览器内存。
- 用户可以让多个不同 thread 并行运行；侧栏中 `running` thread 必须在标题右侧显示小型旋转图标。离开运行中的 thread 只取消当前页面 SSE 订阅，不得调用 interrupt。
- 同一个 thread 仍只允许一个 active turn；切回运行中的 thread 时恢复消息、active turn、计时和停止按钮，并重新订阅后续事件。

## ModeSwitch

职责：

- 在 `聊天` 与 `工作` 等模式之间切换。
- 模式影响 composer 占位、工具入口和后续任务表单。

规则：

- 使用 segmented control/pill。
- 不能扩展成传统 tab bar。
- 不超过三个一级模式；超过时需要重新设计信息架构。
- 当前项白底轻阴影，非当前项透明或浅灰。
- 未登录状态隐藏整个模式切换，只在登录后进入工作台时显示。

## WorkComposer

职责：

- 作为首屏和工作流的主要输入入口。
- 支持自然语言任务、附件、上下文选择、提交、停止、继续。

Props 建议：

```ts
type WorkComposerProps = {
  mode: "chat" | "work";
  value: string;
  placeholder: string;
  disabled?: boolean;
  submitting?: boolean;
  selectedProject?: ProjectSummary;
  selectedContext?: CommerceContextSummary;
  onChange(value: string): void;
  onSubmit(input: ComposerSubmitInput): void;
  onStop?(): void;
  onOpenProjectPicker?(): void;
  onAttach?(): void;
};
```

状态：

| 状态 | UI |
|---|---|
| empty | 显示 placeholder 和可用工具入口 |
| focused | composer 边框或 ring 轻微增强 |
| typing | 不改变布局，不出现跳动 |
| submitting | submit 图标变为 stop/loader，输入仍可读 |
| disabled | 降低透明度，显示原因 tooltip |
| error | 下方显示短错误，不把 composer 整体染红 |

键盘交互：

- `Enter` 提交当前内容。
- `Shift + Enter` 插入换行。
- 输入法组合态的 `Enter` 只确认候选内容，不得提交。
- 空内容不得提交。
- 登录后的首屏和会话 composer 使用自适应高度 textarea；内容未达到上限时随输入增长，达到上限后高度固定并只在 textarea 内部纵向滚动。
- 会话 composer 单行时保持紧凑横排；进入多行后切换为“上方完整输入区、下方工具栏”，不得把高 textarea 与所有按钮硬塞在同一横排。
- 多行 composer 的上层 grid row 必须由 textarea 实际高度驱动，不得预先拉伸到最大高度；一到两行文字顶部保持正常内边距，只有内容增长到上限后才固定高度并内部滚动。
- textarea 内部滚动条使用窄轨道并贴近 composer 右侧，不得在正文与操作区之间形成粗重分割。

未登录访客态：

- 使用独立单行 `GuestComposer`，高度 `54px`、最大宽度 `768px`、完整胶囊圆角。
- 标题使用“我们先从哪里开始呢？”，placeholder 使用“有问题，随便问”。
- 左侧只保留添加入口，右侧显示语音和发送；下方可以显示一个轻量建议入口。
- 不显示项目选择、Gateway/Codex runtime 状态或大型多行输入框。
- 输入聚焦时只增强外层胶囊边框，禁止在输入区域内部出现矩形 focus outline 或 ring。
- 登录后切换为完整 `WorkComposer`，不得用访客样式替代工作模式。

## ProjectSelector

职责：

- 选择当前电商项目、店铺、平台、数据范围。
- 在 composer 下方或 popover 内显示。

规则：

- 默认一行浅灰 strip。
- 选择后显示短名称，长名称截断但 tooltip 展示完整。
- 平台和店铺不是装饰标签，必须映射到实际后端 context id。
- 没有项目时显示创建/配置入口，但不做营销式空状态。

## ModelAndReasoningControl

职责：

- 在登录后的 `WorkComposer` 右下角选择 Agent 文本模型和推理强度。
- 模型列表来自认证后的服务端 provider catalog，不在前端硬编码完整列表。

规则：

- 收起态显示短模型名和当前推理强度，例如 `5.6 Sol 轻度`。
- 仅支持推理强度的 GPT 模型显示第一级弹层；它使用可拖动 range slider 展示六档推理强度和“高级”入口。
- 六档颜色必须可区分：轻度灰、中绿色、高蓝色、极高靛蓝、最高紫色、超高紫色渐变。
- “高级”仅包含“模型”和“推理强度”两项，各自使用右侧子菜单。
- 禁止增加“速度”设置；速度不属于本项目的 composer 配置项。
- Gemini 和 Claude 等非 GPT 模型隐藏推理强度文案、slider 和高级菜单中的推理强度行。
- 生图模型不得出现在 Agent 模型菜单；生图固定由 runtime imagegen 工具使用 `gpt-image-2`。
- 弹层点击外部或按 `Escape` 关闭，选择项使用 menu radio 语义和选中图标。
- Agent turn 处于 `connecting` 或 `running` 时，模型与推理强度控件必须 disabled，并立即关闭已经打开的 quick/advanced/submenu；当前模型信息可以保留显示，但只能在 turn 完成、失败或中断后为下一轮修改。

## AgentEventStream

职责：

- 渲染 Codex/gateway streaming events。
- 区分 thinking、tool_call、approval_required、tool_result、readback、final、error。

规则：

- 默认轻量、可折叠、可扫描。
- 审批、错误、读回失败必须展开。
- 不把所有过程隐藏成单个 spinner。
- 事件时间可弱化显示，不占主视觉。
- 长工具日志默认折叠，避免污染用户工作台。
- 活动 turn 只显示一个“正在思考”主状态，不得重复渲染“正在处理”。
- “正在思考”使用克制的文字内部扫光动画；`prefers-reduced-motion` 下显示静态弱化文字。
- “正在思考”必须位于当前轮用户消息之后、第一条 Agent commentary/final answer 之前，禁止放在用户消息上方。
- `connecting` / `running` 状态显示带克制扫光的“正在处理 X 秒”并实时递增；只有进入 completed、failed 或 interrupted 终态后，才冻结并显示“已处理 X 秒”。
- 运行态的 commentary 按事件 sequence 展示；命令、文件和工具事件共用一个固定活动槽位，新的活动原位替换上一条活动文本，禁止向下追加成活动列表。
- 活动必须按 `turnId` 隔离；开始新一轮后，上一轮命令不得继续出现在当前执行区。
- 同一个 App Server item 的 started/completed 状态必须按 item id 原位替换；新的 item 在运行态也替换固定活动槽位，完整 item 历史只进入完成后的 disclosure。
- 运行中的整条活动文本只使用一个连续扫光层，速度不快于 `2.8s` 一轮；状态文字和命令详情禁止各自动画造成多段、快速或错乱的亮片。完成态活动与 disclosure 不显示成功勾选图标。
- 命令、文件和工具 item 默认汇总为一行 disclosure，例如“运行了命令”或“编辑了文件并运行了命令”。
- `turn/completed` 后隐藏过程 commentary，只保留最终正文，并把该轮活动归并为一个默认收起的 disclosure。
- disclosure 展开后才显示原始 item 明细、状态和耗时；不得把所有工具 item 默认平铺堆积在正文中。
- disclosure 和展开明细不使用横向分割线，通过缩进与间距表达层级。
- 折叠只改变展示密度，不得丢弃 App Server 的 item id、类型、状态或完成事件。

## ConversationWorkspace

职责：

- 首次提交后将首页居中 composer 切换为持续会话工作区。
- 使用 App Server `turn/*`、`item/*` 和 delta 通知驱动渲染，不使用本地假回复。
- 底部保留“继续追问”composer，运行中提交按钮切换为停止按钮并调用 `turn/interrupt`。

规则：

- 用户消息右对齐并使用黑色小型气泡；Agent 最终回答使用无气泡 Markdown 正文。
- `commentary` 使用弱化文本，`final_answer` 使用主正文；不得把 raw Responses JSON 展示给用户。
- `item/completed` 是 item 最终状态来源，`turn/completed` 决定处理状态和耗时。
- 会话切换不得中断其他 thread。运行状态由服务端 thread 索引和 App Server `thread/read` 对账，不能只依赖当前 React 组件状态。
- Work 模式可以显示右侧输出/来源面板；面板不得遮挡主内容和底部 composer。
- 生成图片通过登录保护的站内图片路由渲染，不暴露服务器任意文件路径。
- 停止按钮只有在真实 `activeTurnId` 可用时才可点击；点击必须经过 BFF 与 Gateway 调用 App Server `turn/interrupt`，并等待 `turn/completed` 的 `interrupted` 状态，禁止只在前端切换为停止态。
- SSE 新内容只在用户位于对话底部附近时自动跟随；用户向上滚动后必须暂停自动跟随，禁止把阅读位置强制拖回底部。
- 暂停跟随后显示圆形“回到底部”按钮：SSE 运行中使用三点上下跳动状态，回复完成后切换为向下箭头；点击后平滑滚到底部并恢复自动跟随，按钮必须有可访问名称和 tooltip。

## ApprovalPanel

职责：

- 呈现需要人类批准的外部写操作、权限提升、文件变更或敏感数据访问。

必须显示：

- 目标系统，例如 淘宝、天猫、京东、吉客云、WMS、ERP。
- 对象类型与编号，例如订单号、SKU、售后单号。
- 将要变更的字段和前后值。
- 风险说明和失败回滚/补偿信息。
- 主动作和取消动作。
- 执行后的读回验证状态。

规则：

- 审批面板不能被普通 toast 替代。
- 危险动作使用 destructive 样式，但仍保持克制。
- 默认不展示 secret 和完整 PII。

## CommerceObjectPreview

职责：

- 以统一结构预览订单、商品、库存、售后、客户、报表任务。

结构：

```text
Header: 对象类型 / 外部系统 / 编号 / 状态
Body: 关键字段，最多 6 项
Footer: 更新时间 / 数据来源 / 操作
```

规则：

- 编号必须可复制。
- 状态文案要业务化，例如“待发货”“库存不足”“退款处理中”。
- 敏感字段默认脱敏。
- 读回证据要明确来源和时间。

## CommandButton

职责：

- 用于工具栏和明确命令。

规则：

- 常见工具动作使用图标按钮：搜索、附件、停止、继续、刷新、复制、下载。
- 图标按钮必须有 tooltip 和 aria-label。
- 文字按钮只用于清晰命令：执行、审批通过、取消、重新读取。
- loading 时保持按钮宽高稳定。

## EmptyState

职责：

- 表示没有数据、没有结果、尚未开始。

规则：

- 首屏 empty state 是 composer，不额外堆叠说明文字。
- 列表 empty state 可以一行标题 + 一个动作。
- 不使用大型插画、渐变背景或营销文案。
- 空数据和加载失败必须视觉区分。

## Dialog And Popover

规则：

- 使用 shadcn/Radix。
- Dialog 用于阻断性确认、审批、配置。
- Popover 用于轻量选择、上下文菜单、项目切换。
- 最大宽度和高度必须限制，移动端适配为全宽或 bottom sheet。
- 不嵌套多个 modal；确需多步用同一个 dialog 内状态机。

## AuthenticationDialog

职责：

- 承载邮箱或手机号加密码的登录与注册。
- 登录与注册共享一个 dialog，通过明确文字动作切换。
- 成功后刷新服务端 Session，并由真实 Session 驱动工作台状态。

规则：

- 目前不展示验证码输入或发送动作；验证码通道只有在发送适配器真实接入后才能启用。
- 密码输入支持显示和隐藏，错误在表单内部呈现。
- 输入聚焦不得出现胶囊内部的矩形 outline。
- 不在浏览器保存密码、Session token 或 provider credential。

## Toast

规则：

- 只用于短反馈，例如“已复制”“已保存草案”“已重新连接”。
- 不用于审批、长期错误、读回失败或需要用户判断的问题。
- 同类错误要合并，避免 toast flood。

## ComplianceFooter

职责：

- 在首页底部持续披露 AI 属性、协议入口、隐私入口和对话审核提示。
- 所有链接必须指向站内可访问页面，禁止使用空链接或仅弹出占位提示。

规则：

- 不与侧栏账户区合并，不覆盖主输入区。
- 不使用营销色、图标或独立卡片。
- 文案变更时必须同步审查使用条款、隐私政策与 AI 使用说明的一致性。

## LegalDocument

职责：

- 承载使用条款、隐私政策和 AI 使用说明等长文本。
- 展示更新时间、生效时间、版本状态和权威法规来源。

规则：

- 正文最大宽度 `760px`，保持自然页面滚动。
- 不伪造运营主体、地址、联系方式、备案号或数据保存期限。
- 未确定的生产信息必须明确标注为正式上线前补齐。
- 法规链接优先使用中国人大网、中国政府网、中国网信网等权威来源。
