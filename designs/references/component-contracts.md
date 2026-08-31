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
- `ProductInsights` 或等价商品决策入口；内部承载市场调研、新品开发和产品复盘三个固定 Skill。
- `CreativeSpace` 或等价创作空间入口。
- `KnowledgeBase`。
- `More`，内部收纳 `Scheduled`、`Plugins` 和 `Skills`，不得把这些入口同时放在一级导航。
- `More > Plugins` 必须在现有工作台壳内打开插件目录；桌面侧栏、最近任务与账号区保持稳定，只替换主内容区。`/plugins` 仅作为可直达入口，并复用同一工作台壳，不得另造独立页面框架。目录使用服务端实时状态，不得把 manifest 中的默认值冒充为已启用；列表项加号用于进入同壳详情视图，不代表安装成功。所有应用托管条目必须复用同一个 `PluginListItem` 和同一个详情骨架；条目容器按可用内容宽度自适应为一、二或三列，不能因奇数项留下半幅分割线，加载 skeleton 必须使用相同列规则。详情中的组件类型和动作名称使用中文主标题，例如“服务 / 搜索公开网页”；`commerce_web.search`、`image_gen` 和其他协议标识只能作为小号等宽副标题。第一阶段只读展示应用托管的 skills、MCP 和 application tools。任意包安装、宿主执行、运行时核心替换与插件 Hook 均不得从浏览器开放。
- 产品库插件详情提供真实“通过对话接入”和“管理产品库”入口：前者返回现有公共 composer、预填普通用户可读的接入目标，并在首次及后续 Turn 使用固定 `commerce-product-onboarding` Harness workflow；后者进入同壳 `ProductLibraryWorkspace`。不得另建聊天状态或在插件详情里放置假上传表单。
- `More > Skills` 与插件入口分离，技能目录必须来自 App Server `skills/list`，不得从插件 manifest 推导。`skill-creator` 作为 Codex 系统技能全局可见；浏览器不得获得技能宿主路径，也不得直接写入任意 Skill 目录。
- `Product Insights` 使用现有工作台 shell、公共 `AgentComposer` 和 Harness 会话，不另造表单式研究流程。首屏以三个紧凑、扁平的业务 Skill 选项承载“市场调研 / 新品开发 / 产品复盘”，中文业务名是主标题，`commerce-market-research` 等调用名只作小号等宽副标题。选择仅更新方法、placeholder 和建议任务，不自动发送，也不得显示或拼接 Skill body、path、tool schema、output schema 或隐藏 Prompt。
- 浏览器只提交固定 workflow `commerce-product-insight` 与闭合 `insightMethod=market_research | new_product_development | product_retrospective`。BFF 将其一对一持久化为同名 Recipe；一个 thread 创建后不得切换方法。Gateway 自行解析总控 Skill 与专业 Skill 的 App Server 路径，并用原生 `skill` Items 启动同一个 Harness Turn。兼容历史 `market_research + commerce-market-research`，但新入口统一使用商品决策工作流。
- 三个 Skill 都复用公共产品库 selector、附件、访问策略、模型、问题面板、审批、历史和证据 UI。市场调研与新品开发允许从品类 `auto` 开始，也可选择产品；产品复盘必须选择至少一个产品。复盘使用的 CSV/XLSX/报表附件只标记为待核验上下文，在受控经营数据源没有真实接入和回执时不得冒充企业指标、ROI、绩效或已证实根因。
- 选中产品后，首屏标题、placeholder 和建议任务必须转为该产品的机会验证、新品延伸或复盘目标。历史商品决策任务根据持久 Recipe 恢复固定方法，并恢复最新成功绑定的产品摘要；浏览器不得保存第二份产品快照，也不得从消息正文猜测产品或方法。
- 商品决策报告使用同一结构化投影：产品事实、市场证据、AI 对比推断和待验证假设使用不同标签；每条结论和建议动作提供可展开的产品事实/市场证据引用。当前没有受控企业经营数据工具，`company_metric` 不得进入 Harness Schema，保留的 `companyEvidenceRefs` 必须为空，UI 也不得显示假经营指标。建议动作显示优先级、依据、验证指标和时间范围。市场数据回执显示研究 id、观测时间、证据总数、评论证据数、证据类型、覆盖和限制；没有评论证据时必须显著说明“用户痛点只能作为待验证假设”。
- 商品决策入口显示公开网页与外部数据连接状态；用户只描述业务目标，由 Harness 自主判断外部数据是否能实质改善结果，不要求用户点名 JustOneAPI、接口或工具，也不得因工具可用就无意义地产生费用。外部 API 权限菜单提供“每次询问 / 本任务内允许 / 按企业策略自动调用”：每次询问在实际收费调用前确认，本任务授权在企业最高自动化等级内直接执行且离开任务后自动失效，企业策略档按白名单、费率、预算和自动批准上限执行。任何档位都不得暗示电脑控制、本机文件或任意网络访问。
- 免费计划和执行结果只显示安全业务投影。超宽桌面在右侧输出区展示研究证据，较窄桌面和移动端使用同一 `Sheet` 入口；两种布局必须提供等价回执，不得展示 provider endpoint、raw archive、作者、原始响应、内部 workflow id 或供应商成本。
- 报告正文中的 receipt 是模型生成的引用摘要，不能覆盖同一 `researchRequestId` 的 Harness 工具回执。证据面板必须让实际工具回执优先；只有报告引用而没有任务工具回读时，明确标记为“尚未核对”，不得使用已验证视觉状态。
- 一级导航“商品决策”是新建入口，不是当前视图选中开关，因此不得显示持续选中背景；只保留 hover 与键盘焦点反馈。无论用户正在查看普通任务还是商品决策历史任务，单击都必须先显示干净的商品决策 Skill 选择界面，再以非阻塞 transition 清理旧 thread、未提交输入和任务级授权；历史任务只能通过“最近”列表重新打开。
- 新 Harness 线程只看到业务级外部数据工具：`research_social_content`、`plan_marketplace_research`、`execute_marketplace_research`、`search_business_data` 和 `get_research_result`。市场选项及查询语言来自免费目录工具；供应商端点、Schema、排序值和原始参数只存在于内部控制面。计划成功时可展示市场、语言、代表样本数、预计调用次数和计费报价，但不得展示供应商端点；执行只提交 `plan_id`。能力缺口必须按 Harness 原生 `success:false + contentItems` 返回精确原因，禁止静默放宽、网页兜底或伪造成功。
- 市场目录不得向模型暴露内部质量阈值、档案 UUID/修订或代表样本最大值。额度报价要求降低覆盖率时，必须使用 App Server 原生 `request_user_input` 卡片一次性确认；禁止先用普通 Agent 回复列 `1/2` 编号选项，再让用户发送数字形成第二个 Turn。
- 完整 JustOneAPI 请求和响应属于 SQL-only 企业数据仓，不是前端资料库功能。任何浏览器页面、普通 BFF 路由、下载按钮或公共 MCP 读取工具都不得展示或导出原始归档；现有企业设置只显示调用与计费元数据。
- Composer 的添加目录、访问权限和模型设置共用一个互斥弹层状态；打开任意一个必须关闭另外两个，输入 `@` 自动打开技能目录时也必须关闭访问与模型弹层。禁止出现多个上拉列表叠放。
- 插件和技能目录不得在工作台顶部重复显示独立的“插件/技能”标题栏；保留目录内部 H1，让主内容直接占用可用高度。详情页的返回导航不受此规则影响。
- 技能详情提供“立即使用”，点击后返回现有“新任务”公共 composer 并预选该技能，不得打开另一套任务输入框。首屏与会话 composer 通过统一的 `+` 菜单和输入 `@` 打开技能目录，并支持名称筛选、方向键和回车选择。选择结果显示为带技能图标的独立标签，插件标签与技能标签不得混用同一语义。
- 前端选择只提交 `skillName`。Gateway 必须通过 `skills/list(forceReload)` 重新解析已启用技能，并按 Codex 显式调用规范同时提交 `$skill-name` 文本标记和原生 `skill` input item；浏览器不得提交 path。执行标记不得作为用户正文显示，刷新后的历史必须保留原始文本和技能标签。
- 点击发送时，已选 Skill 必须立即从 composer 迁移到乐观用户气泡；`turn/start` 失败时才恢复到 composer。托管 Task Recipe 也必须在乐观消息中显示其实际调用的 Skill，不能等 Harness 历史回读后才补标签，更不能让同一标签同时停留在输入框和用户消息中。
- 创建技能时复用全局问答面板的视觉组件，但协议必须分开：模型问题只能来自 App Server `item/tool/requestUserInput`，`commerce_skill.publish` 的最终写入确认来自应用事件 `commerce/approval/requested`。用户确认前原始 `item/tool/call` 保持等待，取消不得产生 Skill；不得伪造 Harness server request。当前 tenant 共享目录仅允许拥有 `tenant.manage` 的企业所有者发布；发布完成后以 `skills/list(forceReload)` 回读为成功依据。
- Account/workspace footer。

交互：

- 菜单项 `36px` 高。
- 品牌头、五个一级导航项和账户区必须 `shrink-0`，任务数量增加时不得压缩高度；只有“最近任务分类”区域使用 `min-h-0 overflow-y-auto overscroll-contain`。侧栏根节点和一级导航区不得出现滚动条。
- 点击历史任务只更新 active 背景，不得刷新任务的最近活动时间或改变分类内顺序；只有用户提交新 Turn 等真实任务活动才能将任务置顶。
- 每个历史任务行必须提供独立的永久删除图标；“最近”标题提供批量删除模式。删除前显示不可恢复确认，确认后只创建后台 Job，删除中的行显示 spinner。不得用 `thread/archive`、隐藏列表项或仅删除数据库索引来冒充删除完成。
- 后台删除遇到可恢复的 Gateway 认证或可用性故障时，任务行保持删除中并由 Worker 退避重试；只有明确的永久失败才恢复普通行并显示可关闭的错误提示。成功必须以 App Server 删除、附件清理和线程索引删除全部完成为准。
- hover 使用 `--cp-surface-hover`。
- active 不使用亮色背景。
- 图标和文字间距 `10px - 12px`。
- `More` 使用从侧栏右侧弹出的独立菜单，不在侧栏内部向下展开。
- `CreativeSpace` 是直接入口，不打开二级生成器菜单；点击后进入三栏创作工作台。
- 进入创作空间后，全局侧栏替换为项目侧栏；项目侧栏必须提供返回主工作台、新建项目和租户范围内的创作项目列表。
- `More` 弹出菜单使用 `--cp-radius-popover`、轻边框和 `--cp-shadow-popover`，并提供 `aria-expanded`、`aria-haspopup` 与 menu roles；点击菜单外、按 `Escape` 或选择菜单项时关闭。
- 登录用户的“最近”列表来自服务端 thread 索引并按更新时间倒序显示；选中项映射到真实 Codex thread id。
- 所有普通对话和 Task Recipe 的显示标题必须在首个结果完成后由服务端固定的 `gpt-5.3-codex-spark` 生成；前端截断原始 prompt 只能显示临时“新任务”，不得持久化为最终标题。生成结果同步写入 App Server `thread/name/set` 与租户线程索引。
- Task Recipe 身份使用独立 `recipeId` 元数据，不能从模型生成标题或标题前缀推断。
- Account footer 中的“企业管理”必须由受认证的 Enterprise context 权限结果控制，默认隐藏。无 tenant/workspace、context 请求失败、空角色，或仅有 Agent 运行权限时不得渲染；只有具备企业后台可读或可管理权限时才显示。前端隐藏不是授权边界，`/enterprise/admin` 及其 API 仍必须独立执行服务端权限检查。
- Enterprise 管理桌面壳固定为一屏高度，侧栏不参与内容滚动；仅主内容区允许纵向滚动并使用 `overscroll-contain` 阻止滚动链传递。滚动内容中的 `sr-only`、弹出层和绝对定位控件必须有局部定位上下文，不得扩大浏览器根页面的滚动范围。
- “新任务”必须清除当前客户端 thread/SSE 状态并返回空白 composer，但不得删除历史记录；活动 turn 期间暂时禁用，避免遗失运行状态。
- 点击历史记录必须经过用户所有权检查并用 App Server `thread/read` 恢复 turns；刷新页面自动恢复最近 thread，不得只依赖浏览器内存。
- 用户可以让多个不同 thread 并行运行；侧栏中 `running` thread 必须在标题右侧显示小型旋转图标。离开运行中的 thread 只取消当前页面 SSE 订阅，不得调用 interrupt。
- 同一个 thread 仍只允许一个 active turn；切回运行中的 thread 时恢复消息、active turn、计时和停止按钮，并重新订阅后续事件。
- 新 turn 启动前，Gateway 必须用 `thread/read` 与 Harness 对账 active turn，不能只相信进程内缓存。缓存残留但 Harness 已 idle 时清除残留并启动；Harness 仍有 active turn 时，普通输入转成原生 `thread/queue/add` 并在 composer 上方显示队列。带固定 output schema 的托管工作流不得进入不支持该字段的 queue；它必须通过原生 `turn/steer` 调整当前 Turn。不得向用户暴露英文 `Thread already has an active turn` 错误。每个 thread 的启动对账和 `turn/start` 必须串行化，避免并发双启动。

## CreativeSpaceWorkbench

职责：

- 桌面端组织“项目侧栏 / 创作画布 / Harness 对话”三栏结构。
- 一个创作项目严格对应一个持久 Codex thread；项目对话、Turn、Item、队列、停止、恢复和压缩均由 App Server 管理。
- 项目侧栏只读取租户/工作区/用户范围内 `recipe_id=creative_project` 或兼容 `recipe_id=copywriting` 的 thread 索引；禁止用分类或标题猜测 Recipe；运行中项目显示轻量 spinner。
- 中央画布不保存独立业务状态，只投影所选 thread 中最新的完整交付 Turn：一个最终 Agent 文档与该 Turn 的全部原生 `imageGeneration` artifacts 组成同一产出记录。
- 没有最终交付物时保持真正空白，不用示例卡片、伪画布节点或营销 empty state 填充；窄屏下空白画布不占固定高度，避免把 Harness composer 推到首屏之外。
- 右侧对话复用标准 `ConversationWorkspace`、`AgentComposer`、Harness 问题面板和审批面板；不得创建第二套消息数组、prompt loop 或 WebSocket。

Harness 契约：

- 新项目首次提交使用固定 `commerce-creative-project` workflow，由 Gateway 解析应用托管 Skill 路径和固定 output schema。
- 用户通过业务模板选择“商品标题与文案 / 推广文案 / 商品主图 / 副图与场景图 / 商品详情页 / 产品拍摄脚本 / 短视频分镜”；模板只提交闭合 `creativeMethod`，Gateway 将其映射到应用托管专业 Skill。前端不得拼接隐藏 Prompt、Skill 路径或 output schema。
- 浏览器不得直接提交 `recipeId`；BFF 将固定 workflow 映射为 `recipe_id=creative_project` 与 `category=creative`。
- 后续修改在同一 thread 中进行：idle 时启动新 Turn，active 时通过原生 `turn/steer` 调整同一个 schema-constrained Turn；文本修改返回完整最新画布交付，而不是浏览器合并 patch。
- 图片生成只使用 Harness 原生 `image_gen` 与 `imageGeneration` Item；画布读取 ownership-checked artifact URL。
- 商品主图、副图、详情图和分镜的“保持真实商品外观”必须存在租户/线程归属的参考图。产品库 `imageUrl` 只用于摘要展示，不能由浏览器或 Agent 直接抓取；无参考图时控件需说明只能生成创意方向或概念图。
- 切换已有项目时，通过受认证的 no-store 产品上下文接口恢复最新已成功绑定 Turn 的 Product chips。接口必须重新检查 `product_catalog.read`、线程所有权和 RLS，仅返回最多 20 个摘要；不得恢复未绑定请求，也不得返回原始记录、mapping、attributes、连接器或凭据。
- 普通问答、commentary、streaming fragment 和用户消息不得覆盖当前画布。
- “生成视频成片”在真实视频工具健康前保持 disabled，并用一行说明“当前可生成脚本与分镜，暂不渲染成片”；不得把多张图片、loading 或外链冒充视频产物。
- 任何未来的发布、同步或保存到外部系统动作仍需应用授权、审批、幂等、审计和读回，不能由画布更新冒充完成。

布局：

- Desktop：项目栏使用 `--cp-sidebar-width`；画布占剩余空间；对话栏宽 `360px - 430px`。
- 右侧对话栏属于宽屏中的窄容器。`AgentComposer` 必须使用 compact rail 变体：访问、产品和模型入口保留图标、`aria-label` 与 tooltip，不得依赖 viewport 的 `max-sm` 断点，也不得让发送按钮超出对话栏。
- 从右侧对话栏打开的宽弹层必须以该对话栏作为碰撞边界。产品库收窄到不超过 `400px` 并使用单列；不得覆盖中央创作画布，也不得移除 Radix Portal 后被 `overflow-hidden` 裁切。
- 窄屏：使用“项目 / 画布 / 对话”受控视图切换；“项目”视图原位显示全高可滚动项目侧栏，不能简单堆叠三个固定高度面板。`390px × 844px` 下 composer 必须首屏可达且不得横向溢出。
- 使用全局灰白 token，不建立创作空间专属暖色、字体、圆角或阴影体系。

### CreativeMethodSelector

- 放在右侧 Harness composer 附近，显示普通电商用户可理解的中文业务类型，不显示 Skill 文件名或协议 id。
- 按“商品上架 / 营销推广 / 短视频”分组，使用紧凑扁平列表；选择后只更新方法标签和预填用户可编辑的 starter，不得自动发送。
- 无产品时允许标题、推广文案、脚本等方法继续使用 auto 产品上下文；主图、副图等依赖视觉一致性的类型必须引导选择产品并附加可信参考图。
- 平台、受众、比例、时长等高影响缺失项由 Specialist Skill 通过原生 `request_user_input` 补问，前端不维护第二套固定表单。
- 运行中的 Turn 不允许静默切换方法；变更必须作为同一 Harness `turn/steer` 的明确用户方向，或留给下一 Turn。
- 可用状态来自真实 Gateway/Product Catalog/native image capability。视频渲染没有后端时只能显示禁用项，不得出现可点击假按钮。

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

## CopywritingWorkspace

职责：

- 文案生成是统一电商 Agent 的 Task Recipe，不是独立表单应用，也不跳转到另一套页面壳。
- Recipe 首屏和结果页必须复用全局 `AgentComposer`；不得创建独立 textarea、发送按钮、停止按钮或模型选择器。Recipe 只能改变 placeholder、提交语义和当前内容区。
- 首屏只提供自然语言目标输入和少量任务示例；专业字段不得作为普通用户的必填首屏。
- Recipe Skill 根据目标即时判断缺失的高影响决策，并在 Default collaboration mode 中调用 Codex `request_user_input`；前端不得维护固定问题数组。
- 问题面板停靠在标准对话底部，保留上方正文、commentary 和活动时间线；每题提供明确选项、推荐项和自由补充。用户回答最后一题后继续同一个 Turn，不展示计划文本。
- 提交原生 Harness `item/tool/requestUserInput` 问题后必须立即生成右侧“我的选择”用户气泡，按问题标题展示所选值；秘密字段只显示“已提供”。选择摘要必须由服务端格式化并在刷新后恢复，不得只保存在组件 state。应用侧 `commerce/approval/*` 可以复用同一问题面板，但确认结果只推进原始工具调用并写入审计/计费证据，不得追加用户会话气泡。
- 用户已经在目标中明确渠道或表达方向时，对应问题必须跳过。
- 文案线程创建后必须使用标准 `ConversationWorkspace`，不得切换到独立版本编辑器或第二套对话面板。结构化文案作为助手消息渲染标题、正文、CTA 和合规备注。
- 运行中显示真实“正在处理 x 秒”和停止按钮。提问、解释和明确改写都进入同一 Codex thread 的新 turn，并按普通对话顺序展示。
- 刷新或点击历史文案任务时，使用服务端 thread history 恢复完整对话和 Harness 问答。

Harness 契约：

- 每个文案任务对应一个 Codex thread；首个 `turn/start` 内由 Harness 动态提问、等待答案并继续到最终交付，后续消息各对应一个新 Turn。
- 文案规则通过应用托管 `commerce-copywriting` Skill 注入；Gateway 只接受固定 workflow id，并自行解析 Skill 路径和 `outputSchema`。
- 文案后续 Turn 必须区分 `answer` 与 `draft`，但两者均属于标准对话消息；前端不得创建版本标签。
- Gateway 支持 App Server 原生 `item/tool/requestUserInput` server request，并将其作为运行中动态问题转发给拥有该 thread 的用户；运行时启用 `default_mode_request_user_input`，不进入 Plan mode。
- 浏览器不得提交任意 Skill 路径、developer instructions、output schema、tool definition、cwd 或权限策略。
- 输出 Schema 固定为 `responseType`、`title`、`body`、`callToAction`、`complianceNotes`、`message`。商品资料读取和保存草稿必须使用另行注册、带租户授权的应用工具；Hook 不承载文案业务逻辑。

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
- Composer 底部工具栏必须按实际容器宽度切换紧凑控件，而不是只依赖 viewport 断点；`390px` 页面中添加、访问、产品、模型、语音和提交按钮都必须完整位于 composer 边界内。
- 首屏和会话 composer 只保留一个 `+` 作为添加入口，不得在 `+` 旁重复放置独立 Skill、附件或普通资料库按钮。`产品库` 是用户明确选择的例外：它必须作为当前任务的产品上下文选择器放在访问策略之后，而不是第二个添加入口。点击 `+` 后的同宽弹层按“添加 / 插件 / 技能”分区：插件必须来自真实应用插件目录并进入对应详情，技能必须来自 App Server `skills/list` 并沿用原生 Skill 选择；“文件和图片”必须调用真实多选文件选择器，并显示照片预览、文档名称、大小与单项移除。
- 点击发送后，附件立即从 composer 移入右侧乐观用户消息；Turn 接受成功后只保留消息附件，上传或启动失败则撤销乐观消息并把原文字和附件恢复到 composer。不得同时在用户消息和输入框中重复显示同一附件。
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

## ProductLibraryPicker

职责：

- 在首屏与会话 composer 中选择当前任务可引用的 canonical Product。
- 只提交产品上下文模式和稳定 Product id；不得提交来源原始 JSON、产品描述全集、映射代码或租户范围。
- 通过应用注册的 Harness 产品工具按需检索当前 revision，不把完整产品库复制进 prompt 或对话历史。

规则：

- 入口位于访问策略之后，使用 `PackageSearch + 产品库`；选中时显示数量，例如 `产品库 · 2`。
- 该入口是 context selector，不是第二个附件/添加按钮。它与 `+`、访问策略、Skill 目录和模型设置使用同一个互斥 popover 状态。
- 首屏 `WorkComposer` 使用锚定在入口下方的 `<=560px` 双列扁平 Popover；普通持续会话可向上展开。创作中心右侧 compact rail 使用碰撞绑定的 `<=380px` 单列 Popover；三者都包含紧凑标题/状态、产品/SPU/SKU 搜索、最近使用/已选择、`48px` 轻量产品行和固定 footer。
- 产品行高度 `40px - 48px`，显示标题、SPU、SKU 数、来源和更新时间；缩略图缺失时使用 lucide `Package`，禁止伪造商品图。
- 最多选择 20 个产品。选择变化直接同步到 textarea 与工具栏之间的可移除 ProductRef chips；取消最后一个产品必须立即恢复 `auto` context 并移除 chip，`完成` 只关闭选择器。发送后产品引用跟随同一 `clientRequestId` 进入当前 Turn，失败时恢复。
- 不使用永久右侧产品面板。`管理产品库` 打开同一 AppShell 内的完整产品工作区。
- 运行中不可改变本轮产品范围；控件 disabled 并说明下一 Turn 可调整。
- `loading` 保留稳定尺寸；`empty` 明确“尚无已归一产品”；`syncing/stale/source_error` 保留上次已验证产品并显示来源状态；`permission_denied` 显式说明无读取权限，禁止伪装为零结果。
- Mobile 使用 Radix Dialog/bottom sheet，chips 最多两行后折叠为 `+N`，不得产生页面级横向滚动。创作中心 compact rail 最多直接显示两个 ProductRef chip，其余折叠为 `+N`。
- 所有 Product id 在 BFF 重新执行 workspace RLS 与 `product_catalog.read`；前端选中态不是授权依据。

## ProductLibraryWorkspace

职责：

- 在现有工作台壳内管理 canonical 产品、数据源和导入批次。
- 展示 Product/SPU、Variant/SKU、来源、同步状态、映射问题和 readback；不展示连接凭据或普通用户不可见的原始记录。

规则：

- 使用轻量列表与行分隔，不做传统后台卡片墙或指标首屏。
- 首屏使用紧凑“选择接入方式 / 分析并校验 / 发布标准产品”进度条，状态来自当前工作区数据源、最新导入和 canonical readback；普通用户可以从这里直接上传文件、查看其他接入方式，或把待复核批次带入 Harness 对话。
- 文件接入真实支持 CSV/JSON；同一来源工作区还必须展示应用注册的托管 API、只读数据库和 ERP/PIM Connector 定义。上传、连接测试、检查、映射验证和发布状态必须来自后端，不提供无行为的“连接”按钮。
- 文件路径直接打开上传分析，不先创建空来源。上传只保留原始记录、创建映射并展示问题，不得写 canonical Product/SKU；只有用户明确点击“发布到产品库”后才调用独立 activation API，并展示权威 Product/SKU readback。
- 进入或刷新工作区时必须通过受认证、RLS 作用域的最新导入读接口恢复 `needs_review / ready_to_publish / completed`；`ready_to_publish` 的明确发布动作不得只存在于本地 mutation state。Inspect 未提供规范化 Product/SKU 预览时，只展示来源记录数、来源字段元数据和问题，不得宣称已生成产品预览。
- Connector 选择来自服务端定义目录，不在前端硬编码供应商清单。未安装或未配置的 adapter 保持可见但 disabled，并说明运维缺口；不得显示绿色“已连接”。
- Disabled API、数据库和 ERP/PIM 条目必须说明安全交接方式：普通用户只提供系统名称、公开文档或字段说明，密钥、Token、DSN 和连接串由管理员/运维写入服务端密钥系统，禁止粘贴到浏览器或 Harness 对话。
- 普通用户连接表单只接收定义允许的 public config；不得输入或回显 server-owned secret reference、env 名、broker id、密码、Token、完整数据库连接串、任意 SQL、任意 API URL 或执行脚本。未来只有在真实 credential-handle BFF 可用时才能选择管理员已授权凭据；此前所有需要凭据的连接器必须 disabled/fail closed。
- 只读数据库连接测试必须由服务端确认 read-only session；API 必须使用应用/运维登记的 base URL 与路径；ERP/PIM 必须绑定版本化 adapter。测试成功不等于产品已同步或已发布。
- `product_catalog.read` 可浏览与选择；`product_catalog.import` 可创建导入；`product_catalog.review` 可审核 mapping；`product_catalog.sources.manage` 才能管理连接来源。
- 原始记录、AI mapping、验证 dry-run、审批发布和 canonical readback 必须显示为不同阶段。
- AI 低置信度、身份冲突、缺币种和跨来源合并进入待审核问题，不得自动发布或用绿色成功态掩盖。
- `needs_review` 批次提供真实“通过对话处理映射”入口并绑定 import id；字段解释与映射提案由 Codex Harness 工具完成，浏览器不得实现本地假映射或直接修改原始记录。
- 无产品时使用一行标题和一个真实动作；无管理权限时提供可执行的返回/切换工作区动作，不显示假连接入口。

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
- 所有运行态文字统一使用唯一的 `cp-running-shimmer` 扫光实现，包括“正在处理 X 秒”和当前命令、文件、搜索、生图工具活动；禁止为不同运行状态建立不同渐变、速度或关键帧。动画是单个连续亮片，以 `2.8s` 完整扫过一次；`prefers-reduced-motion` 下统一显示静态弱化文字。
- “正在思考”必须位于当前轮用户消息之后、第一条 Agent commentary/final answer 之前，禁止放在用户消息上方。
- `connecting` / `running` 状态显示带克制扫光的“正在处理 X 秒”并实时递增；计时起点属于单个 turn，HTTP/SSE 状态切换不得重置，运行中的可见秒数不得回退；只有进入 completed、failed 或 interrupted 终态后，才冻结并显示“已处理 X 秒”。
- 运行态的 commentary 按事件 sequence 展示；命令、文件和工具事件共用一个固定活动槽位，新的活动原位替换上一条活动文本，禁止向下追加成活动列表。
- `agentMessage.phase = commentary` 是用户可见的执行说明，不是隐藏 reasoning，也不是最终正文：使用主文本色、略小字号和中等字重自然插在工具调用前后，不使用卡片或“思考过程”标签。`reasoning` item 始终不渲染。`final_answer` 只在 turn 完成阶段作为普通主正文显示。
- 运行中 SSE 与 `thread/read` 可能为同一 assistant message 提供不同协议 id；前端必须按同 turn、兼容 phase、相同正文或 streaming 前缀原位合并。不得把同一个 commentary 重复渲染，同时不得合并同一 turn 内正文不同的多段 commentary。
- 活动必须按 `turnId` 隔离；开始新一轮后，上一轮命令不得继续出现在当前执行区。
- 同一个 App Server item 的 started/completed 状态必须按 item id 原位替换；新的 item 在运行态也替换固定活动槽位，完整 item 历史只进入完成后的 disclosure。
- 运行中的整条活动文本只使用共享的 `cp-running-shimmer` 连续扫光层；状态文字和命令详情禁止各自动画造成多段、快速或错乱的亮片。完成态活动与 disclosure 不显示动画或成功勾选图标。
- 命令、文件和工具 item 默认汇总为一行 disclosure，例如“运行了命令”或“编辑了文件并运行了命令”。
- `turn/completed` 后隐藏过程 commentary，只保留最终正文，并把该轮活动归并为一个默认收起的 disclosure。
- 每条已完成的最终 Agent 回复下方固定显示紧凑的复制、回复优秀、回复不佳三个图标按钮；commentary、streaming 和空回复不显示操作。所有图标必须有 tooltip 与 `aria-label`，好评和差评使用互斥的 `aria-pressed` 状态，选中项的拇指图标必须实心填充，再次点击当前评价表示取消。评价成功落库后在操作行短暂显示“感谢您的反馈！”，失败时不得显示成功提示。
- 复制必须复制用户实际看到的回复内容，结构化文案需要展开为标题、正文、行动引导和合规备注，不得复制内部 JSON。评价必须调用真实 BFF，按 Harness `threadId`、`turnId` 和 `agentMessage itemId` 保存；失败时撤销乐观状态并明确提示，刷新历史后必须回显已保存评价。
- completed activity disclosure 必须按 Harness sequence 插回当前 turn 时间线，位于调用前 commentary 与调用后 final answer 之间；禁止固定追加到最终回答下方。运行中仍只显示当前最新 activity 的替换式单行状态，完成后再折叠成一个 disclosure。
- disclosure 展开后才显示原始 item 明细、状态和耗时；不得把所有工具 item 默认平铺堆积在正文中。
- disclosure 和展开明细不使用横向分割线，通过缩进与间距表达层级。
- 折叠只改变展示密度，不得丢弃 App Server 的 item id、类型、状态或完成事件。
- 上下文整理必须使用 App Server `thread/compact/start` 与 `contextCompaction` item；运行中显示“正在整理上下文 X 秒”，完成后归入“已整理上下文” disclosure。禁止在浏览器或 BFF 中自行总结历史并替换 Harness 上下文。

## ConversationWorkspace

职责：

- 首次提交后将首页居中 composer 切换为持续会话工作区。
- 所有用户输入气泡统一使用 `--cp-user-message-bg` 浅灰背景和 `--cp-user-message-text` 深色文字，包括普通消息、显式 Skill 消息、选择回答和待确认调整；不得按消息类型恢复为黑底白字。
- 使用 App Server `turn/*`、`item/*` 和 delta 通知驱动渲染，不使用本地假回复。
- 底部保留“继续追问”composer，运行中提交按钮切换为停止按钮并调用 `turn/interrupt`。

规则：

- 用户消息右对齐并使用黑色小型气泡；Agent 最终回答使用无气泡 Markdown 正文。
- `commentary` 使用弱化文本，`final_answer` 使用主正文；不得把 raw Responses JSON 展示给用户。
- `item/completed` 是 item 最终状态来源，`turn/completed` 决定处理状态和耗时。
- 会话切换不得中断其他 thread。运行状态由服务端 thread 索引和 App Server `thread/read` 对账，不能只依赖当前 React 组件状态。
- Work 模式可以显示右侧输出/来源面板；面板不得遮挡主内容和底部 composer。
- 生成图片通过登录保护的站内图片路由渲染，不暴露服务器任意文件路径。图片必须按 `sequence + turnId` 渲染在生成它的对话轮次中，不得把历史图片作为全局列表追加到当前 turn 底部。对话中的图片缩略图不显示模型名或独立说明栏；点击缩略图打开无额外卡片文案的全屏预览，支持背景点击、`Escape` 和关闭图标退出，并在关闭后恢复触发按钮焦点。
- Web Search 来源必须来自 Harness tool item 的结构化 `sources`（MCP `result.structuredContent.sources` 或原生 `web_search_call.action.sources`），不得从最终正文正则猜 URL。搜索活动外层按调用次数与失败数汇总，展开后成功项显示来源数量、失败项显示“搜索未完成”，不得逐行重复“完成了搜索”。每次调用随后显示自己的来源标题、域名和可点击原始链接，不得暴露 `commerce_web.search` 等内部工具标识；右侧“来源”面板自动汇总当前线程最近的结构化来源、按规范化 URL 去重并移除 `utm_*` 跟踪参数。来源为空时显示空状态，不提供无后端语义的“添加来源”按钮。
- Harness `agentMessage` 继续使用 GFM Markdown；Web 客户端必须把比较型数据渲染为语义 `table/thead/th/td`，提供清晰表头、行分隔、链接和容器内横向滚动，不得把表格压成空格对齐的纯文本。窄屏只允许表格容器内部滚动，不得造成页面级横向溢出；不要为了表格自研新的 Agent 消息或 Turn 生命周期。
- 来源面板默认只展示最近 3 条，超出部分使用一个“查看其余 N 个来源” disclosure；展开内容限制在面板内部滚动，并提供“收起来源”。来源集合因新搜索发生变化时自动恢复折叠状态。折叠不得删除、重新排序或改变正文中的就地引用。
- 停止按钮只有在真实 `activeTurnId` 可用时才可点击；点击必须经过 BFF 与 Gateway 调用 App Server `turn/interrupt`，并等待 `turn/completed` 的 `interrupted` 状态，禁止只在前端切换为停止态。
- active turn 期间，普通对话的 Enter 或“加入任务队列”按钮必须调用 App Server `thread/queue/add`；带固定 output schema 的托管工作流使用“调整当前方向”并调用 App Server `turn/steer`，不得进入 queue；Shift+Enter 继续换行。composer 上方普通队列只能渲染 `thread/queue/list` 返回的数据，并通过 `thread/queue/changed` 刷新。队列使用一个统一圆角边框容器，内部为连续、紧凑、无独立边框的 `28px` 行，不得把每条消息做成单独卡片；每行提供真实“调整方向”、垃圾桶删除、三点更多菜单；“关闭排队”删除当前普通队列。
- “编辑消息”禁止在队列条内部渲染输入框。它把原文本放回 composer，自动聚焦并把光标移至末尾，同时通过 `thread/queue/delete` 移除该条排队消息；用户再次提交时才重新执行 `thread/queue/add`。删除失败时恢复编辑前草稿并重新读取 queue，避免同一内容同时存在于 queue 和草稿。
- 编辑、单条删除和“关闭排队”使用乐观 UI：本地队列立即移除且不显示 loading，后台执行真实 queue delete；失败时重新调用 `thread/queue/list` 回滚并显示错误。编辑时 composer 立即回填，删除失败则恢复编辑前草稿。只有已提交给 `turn/steer`、等待 Harness `userMessage.clientId` 确认的消息显示“正在调整”运行态。
- 队列更多菜单保持扁平紧凑：宽度约 `156px`、单项高度 `32px`、`10px` 圆角、弱边框与 `--cp-shadow-soft`，不得使用大面积 popover 阴影或为普通队列操作显示 spinner。
- 点击“调整方向”时，普通队列条立即隐藏并进入独立 `pendingSteers` FIFO；原文本以浅灰用户气泡预览，并在其下方左对齐显示一行共享 `cp-running-shimmer` 的“正在调整”文字。该预览不属于正式 `messages` 时间线，禁止用内容相同推测提交成功。Gateway 必须先持久化 pending state，再从普通 Harness queue 删除、调用 `turn/steer` 并立即 `turn/interrupt`；收到 old turn 的 interrupted completion 后，把未确认 steer 作为下一 Harness turn 提交。只有匹配 `clientUserMessageId` 的权威 `userMessage` 才进入正式时间线。若 Harness 已在 idle 窗口自动启动该 queue item，则以历史中的 client id 判定 `alreadyStarted`，禁止报错、丢失或重复。
- 队列容器位于免责声明与 composer 之间；单条队列比 composer 左右各缩进 `16px`，底边与 composer 上沿贴合，不得悬浮在对话正文中或在两者之间插入免责声明。
- SSE 新内容只在用户位于对话底部附近时自动跟随；用户向上滚动后必须暂停自动跟随，禁止把阅读位置强制拖回底部。
- SSE 是低延迟通道，不是唯一事实来源。active turn 期间前端必须每约 `3s` 通过认证 BFF 调用 App Server `thread/read` 做无 loading 的后台对账：持久化历史出现匹配 `userMessage.clientId` 时移除对应 pending preview，并把权威消息按 sequence 合并到正式时间线；thread 进入 completed/failed/interrupted 时用权威 messages、activities、images、duration 与 status 覆盖本地状态并停止计时，同时撤销任何待回答/待审批卡并把孤儿 running activity 标记为 failed。旧卡提交必须返回终态错误并立即退出等待状态。对账不得把待确认输入提前写入正式 messages，也不得改变滚动位置。这样 Gateway 重启、SSE 断线或漏事件时，运行状态最多延迟一个轮询周期恢复，禁止无限显示“正在处理/正在调整/正在等待回答”。
- active turn 的 deadline 必须绑定同一个 Harness `turnId + startedAt`。新的 `turn/started`、直接 start、queue 自动启动或 steer 重提交只要产生新 turn id，就必须建立新计时；旧 timeout closure 在身份不匹配时必须无操作退出。新 turn 处于 `connecting` 且 Harness 尚未切换状态时，对账不得用上一轮 completed/failed/interrupted 快照覆盖新计时、状态或乐观用户消息。
- 首次提交时立即显示的乐观用户消息必须携带发送给 Gateway/App Server 的同一个 `clientUserMessageId`，并标记为 `delivery: pending`。SSE 或 `thread/read` 返回权威 `userMessage` 后必须按该 client id 原位替换为 committed 消息，禁止因 Harness message id 不同而追加第二个相同气泡；不同 client id 的真实重复提交不得被内容去重。
- 暂停跟随后显示圆形“回到底部”按钮：SSE 运行中使用三点上下跳动状态，回复完成后切换为向下箭头；点击后平滑滚到底部并恢复自动跟随，按钮必须有可访问名称和 tooltip。
- 长对话在桌面端显示对话区左侧 Prompt 导航。每个正式用户 Prompt 对应一个刻度；Agent 回复、活动、图片和处理状态不得生成独立刻度。Prompt 刻度位于垂直居中的固定间距栈中，不按照回复高度投影，默认全部左侧对齐且等长。指针进入刻度栈后自动选取最近 Prompt，中心刻度变深并最长，前后相邻刻度按距离对称递减，以 `150ms` 左右的宽度过渡形成金字塔轮廓；离开后全部收回为等长。短对话或无溢出时隐藏，移动端不显示，并在 `prefers-reduced-motion` 下取消宽度动画。
- Prompt 导航不得叠加独立的深色“当前滚动位置”横线，避免它与悬停中心刻度形成两个视觉焦点。弱化视口范围可以保留；悬停刻度只显示对应用户 Prompt 的紧凑预览浮层，点击刻度平滑跳转，轨道点击与方向键、Page Up/Down、Home、End 继续控制中间对话容器。待确认的调整方向只有在 Harness 返回权威 `userMessage` 并进入正式消息时间线后才生成 Prompt 刻度。该控件不得滚动页面、侧栏、顶栏、右侧输出区或底部 composer。
- SSE、历史恢复、图片加载、活动展开和容器尺寸变化后必须通过 `ResizeObserver` 与一帧节流重新测量时间线；测量和对账不得强制改变用户当前阅读位置。

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
