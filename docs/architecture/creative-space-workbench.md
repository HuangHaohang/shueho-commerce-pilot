# Creative Space Workbench

Commerce Pilot's Creative Space is a three-pane, browser-based workbench built directly on the open-source Codex App Server harness.

## Product Model

- Clicking **创作空间** enters the workbench directly; it does not open a secondary generator menu.
- The left pane lists creative projects.
- The center pane is an infinite commerce canvas. It stays visually empty until the selected project produces a real deliverable, while retaining neutral pan/zoom chrome.
- The right pane is the normal Harness conversation, including streamed items, native questions, queueing, interruption, attachments, image generation, recovery, and history.

Creative Space does not introduce a separate project conversation system:

```text
Creative project = persisted Codex thread
User request or revision = Codex Turn
Conversation/tool/media progress = Codex Item stream
Canvas source = persisted final Agent and native image Items
Canvas editing state = tenant-owned nodes, layout and append-only revisions
```

The PostgreSQL thread index remains an ownership and navigation index. Codex App Server is authoritative for conversation history and Turn state. Canvas tables do not create a second Agent loop or message store: they bind application editing state to immutable Harness source ids.

## Managed Workflow

The browser may request only the fixed `commerce-creative-project` workflow. The BFF maps it to:

- `recipe_id = creative_project`;
- `category = creative`.

Gateway resolves the application-owned `commerce-creative-project` Skill and calls native `turn/start` with:

- the user's original text;
- an App Server `skill` input item for the project workflow;
- when selected, one application-managed specialist `skill` input item resolved from a closed business method id;
- the fixed structured-output schema shared by creative text deliveries.

The specialist method registry is application code, not browser-authored prompt text:

| Business method | Managed Skill |
|---|---|
| Campaign 资产包 | `commerce-campaign-pack` |
| 商品标题与文案 | `commerce-listing-copy` |
| 推广文案 | `commerce-promotion-copy` |
| 商品主图 | `commerce-product-main-image` |
| 副图与场景图 | `commerce-product-gallery` |
| 商品详情页 | `commerce-product-detail-page` |
| 产品拍摄脚本 | `commerce-product-shooting-script` |
| 短视频脚本与分镜 | `commerce-short-video-storyboard` |
| 创作合规检查 | `commerce-creative-qa` |

The browser may send only the allowlisted `creativeMethod` value. Gateway rejects unknown values and resolves the application-owned Skill path. It never accepts a Skill path, Skill body, developer instruction, output schema, tool definition, or runtime root from the browser. The specialist Skill refines the commerce deliverable; it does not create another thread, Turn, prompt chain, or project store.

The Skill treats later Turns as revisions of the current project unless the user clearly starts another deliverable. It asks high-impact missing questions only through native `item/tool/requestUserInput`. It does not run a prompt chain, hidden revision loop, or second Agent session.

`commerce-campaign-pack` requires a current canonical Product revision and returns at least four canvas blocks: Campaign brief, product-claim matrix, channel-derivative matrix, and separate product-fidelity / claim-evidence / brand / channel QA gates. `commerce-creative-qa` reviews those four layers independently with `pass / hold / fail`; it never collapses them into an opaque total score. Missing reference media, claim proof, brand authority, or current channel rules is `hold / unavailable`, never an inferred pass.

Creative direction changes submitted while a Turn is active use native `turn/steer`. They remain inside the same schema-constrained Turn and do not create an application-owned queue or a second Agent loop. Native `thread/queue/*` remains available for ordinary conversation input; managed workflows never enter it because App Server's queue contract has no per-submission `outputSchema`.

The browser assigns each steer one stable `clientUserMessageId`, renders it as pending, and waits for the authoritative Harness `userMessage.clientId` through the owned thread readback before clearing the composer. An ambiguous HTTP failure is retried only with that same id. The Gateway serializes steering per thread, checks native `thread/items/list` before dispatch, and reads back the same id after an uncertain App Server response, so a retry cannot inject a second copy. The Creative Space composer exposes only the five application-shipped Studio Skills returned enabled by native skills/list. BFF and Gateway allow one of those exact names alongside commerce-creative-project, excluding a simultaneous specialist creativeMethod. Gateway appends the resolved native Skill item without duplicating user text or replacing the managed output schema. Native retry preserves that selection. Arbitrary explicit Skills remain unavailable within managed workflows.

## Product Grounding And Project Recovery

Product selection remains a Turn-scoped business context, not text copied into the project prompt. In selected mode the BFF checks `product_catalog.read`, validates at most twenty canonical Product ids under the current workspace, creates one immutable selection set, and binds it only after App Server returns the authoritative Turn id. The specialist Skill must call `commerce_product.get_selected_product_context` before using selected facts. Product titles, descriptions, attributes, source labels, and issue text remain untrusted tenant data rather than instructions.

When an existing project is selected, the browser calls:

```text
GET /api/agent/threads/{threadId}/product-context
```

The route requires `requireAgentThreadContext(..., "product_catalog.read")`, rechecks `getAgentThreadForUser`, and queries the newest selection set whose `turn_id` is non-null. SQL contains explicit tenant, workspace, user, and thread predicates inside the normal forced-RLS transaction. The result is exactly:

```json
{
  "turnId": "turn-id-or-null",
  "products": [],
  "resolvedAt": "ISO-8601"
}
```

`products` contains at most twenty canonical summary fields: id, title, SPU, status, variant count, source label, revision timestamp, and optional image URL. It never includes raw import records, mapping documents/evidence, arbitrary attributes, connector configuration, secret handles, or credentials. A project without a successfully bound selected-product Turn returns `turnId: null` and an empty array. Restoring this selection affects only the next unsent Turn; it does not mutate a running Turn or inject a synthetic user message into Harness history.

## Infinite Canvas And Revisions

The canvas reconciles completed creative Items into bounded application nodes:

1. `document` nodes render structured title, body, CTA and compliance notes with an explicit edit mode;
2. `image` nodes reference one ownership-checked native `imageGeneration` artifact and store only editable text overlays and review metadata;
3. `table` nodes render script/storyboard columns and rows as semantic editable tables.

The managed creative output schema includes `canvasBlocks`. The model may describe document, image-overlay, or table content, but it never supplies coordinates, database ids, Harness ids, artifact URLs or UI commands. Gateway/BFF reconciliation binds the completed `threadId`, `turnId`, `agentMessage` Item id and native image artifact id. Legacy final messages are deterministically projected into document or table nodes.

`commerce_creative_canvas_node` stores immutable source identity and current business metadata. `commerce_creative_canvas_node_revision` is append-only and distinguishes `harness` snapshots from `user` edits. Layout, viewport and message references live in separate forced-RLS tables. Manual editing never mutates App Server history; restoring a version appends a new user revision. A later Agent revision remains a new Harness Turn and completed Item.

Each assistant Item may reference multiple nodes through `commerce_creative_canvas_message_ref`. Clicking a reply reference centers and selects the node; clicking a node scrolls to the originating assistant Item. “在对话中修改” only prepares a visible follow-up in the existing composer and uses the existing managed workflow on submission.

### Image Studio And Immutable Edit Versions

Clicking a completed generated image in the conversation or its canvas node opens the same in-workbench, Codex-style Image Studio rather than navigating to an artifact URL. The studio provides two views:

- **Focused** inspects one owned image at a bounded zoom level;
- **Canvas** shows the generated images from the same Codex thread and allows at most four explicit edit sources;

Both views share the application's global `AgentComposer` as the one bottom natural-language composer. Image Studio injects selected-image, comment and resize context into that component; it must not define a separate textarea, send button, keyboard-submit path or visual input system. Focused exposes Codex-like `添加评论`, `移除` and `调整大小` actions: comments become coordinate-bound instructions, while remove/resize only prepare visible natural-language requests. Canvas provides multi-selection and version navigation. There is no separate direct-design or layer-editing mode in Image Studio.

Every Image Studio modification is a new Harness Turn in the same creative-project thread. The browser submits only bounded generated-image filenames through `imageEditSourceFilenames`; the authenticated BFF verifies that the persisted Recipe is `creative_project`, and Gateway reloads each artifact from the application-owned `GeneratedImageStore`, requires exact thread ownership, and converts it to a native `localImage` input. Browser URLs, host paths, base64, Provider credentials, masks, raw App Server inputs, direct Provider requests, and Provider identity are never accepted.

The edit Turn uses the normal `commerce-creative-project` managed Skill and the existing actor-authorized Provider path. Completion still requires a native `imageGeneration` Item. Each saved artifact records immutable `sourceFilenames`, so the browser can display a real parent-to-child version chain while retaining every source image. Harness-native reply retry reconstructs those generated-image `localImage` inputs from the authoritative source `userMessage`; it never downloads through the browser or fabricates an edit request.

Region comments are model instructions tied to visible percentage coordinates, not a claim of a Provider-native pixel mask. A future true mask tool may be added only when the selected Harness/Provider contract can preserve mask semantics through the same owned Turn and native Item lifecycle.

Completed assistant replies expose a compact retry action, but retry remains a native Harness history operation rather than an application-authored duplicate prompt. The browser submits only the authoritative assistant Item id. The BFF resolves that Item to its terminal Turn under the current tenant, reserves normal Turn quota, and clones any immutable selected-product revision references. Gateway then reads the original Harness `userMessage`, recovers only application-registered workflow and specialist identities, and rebuilds tenant attachment inputs from the owned artifact store. Paginated threads use native `thread/revert` with `beforeTurnId` equal to the source Turn; legacy threads use the Harness compatibility method `thread/rollback` with the exact target-through-latest Turn count. Both paths then start the replacement with native `turn/start`. The stable Codex thread remains the project authority, and the reverted reply plus all later Turns leave the active Harness history. A browser cannot supply replacement text, Skill paths, output schemas, attachment paths, product revisions, runtime policy, or the history boundary.

Retry is always an explicit user action. It does not silently replay a failed or uncertain paid provider request: external-data calls still pass live authorization, approval, budget reservation, exact-once dispatch, audit and settlement inside the replacement Turn. If `thread/revert` succeeds but the replacement `turn/start` response is uncertain, the client reconciles current Harness state before enabling another retry.

Commentary, streaming fragments, user messages, and conversational `responseType=answer` replies never materialize persisted nodes. While a Turn runs, the canvas may show a non-persisted activity state, but a source node is created only from completed authoritative Items. When no persisted delivery exists, the canvas contains no example or fake asset nodes.

Exact duplicate final `agentMessage` Items inside one Turn are coalesced by phase and content for browser/history projection. A `main_image` or `gallery_images` claim without a completed native image artifact materializes no canvas node and is shown in conversation as “图片未生成”. Reconciliation deletes obsolete unedited source projections under the same user-scoped RLS transaction; any node with a user revision is retained.

## Native Media Boundary

Hosted model metadata selects native direct tools through App Server `model_catalog_json`. This explicitly overrides model-default code-mode routing without introducing an application agent loop; the standalone code-mode host is disabled. Image generation remains an original Harness tool and Item, with the same tenant and Provider boundaries.

Image requests remain inside the Harness. A namespace `image_gen` extension call or a Provider-hosted Responses `image_generation_call` must first become a native `imageGeneration` Item; that Item is the sole artifact authority. The application-owned Codex patch performs the hosted-output projection in real time and during history replay without dispatching another Provider request. Gateway may persist the completed tenant-owned file and expose an ownership-checked BFF URL, but it must not parse rollout files, fabricate an Item, expose base64/host paths, or create a browser image-generation endpoint.

Image-capable Responses requests use zero request retries, zero stream retries, and a 120-second SSE idle deadline. A disconnect or idle expiry is an uncertain paid result and requires authoritative readback plus explicit user retry; it is never replayed automatically.

The BFF and Gateway enforce high-cost media prerequisites before `turn/start`. `campaign_pack`, `main_image`, `gallery_images`, and `creative_qa` require an explicitly selected canonical Product revision. `main_image` and `gallery_images` additionally require a tenant/thread/request-owned attachment whose detected artifact kind is `image`; a catalog URL, no attachment, or a document attachment cannot pass the gate. Browser validation is immediate feedback only; Gateway artifact ownership and detected-kind checks are authoritative.

A catalog `image_url` is display metadata, not permission to fetch an arbitrary network resource or a native image input. Product-accurate main images, gallery images, detail visuals, and storyboard frames require a user attachment or a future immutable Product Media revision that the application has ingested, MIME/size/hash checked, authorized to this tenant/thread, and supplied to Harness as a tenant-scoped `localImage`. Without that reference, Skills may produce text, scripts, page structure, image briefs, or explicitly conceptual imagery, but must not claim faithful product appearance.

Rendered video remains unavailable and its control is disabled. The current Provider relay has no video route, the runtime has no video tool or native `videoGeneration` Item, and an image sequence is not a rendered video. A future video flow must use an application-owned tool with a free plan/quote, explicit `commerce/approval/*`, live RBAC, budget reservation, UUID idempotency, exact-once asynchronous dispatch, verified callback or status polling, tenant-owned artifact storage, audit/billing settlement, and final content readback. Uncertain submissions are never retried automatically. Until then the Skill may produce scripts, storyboards, shot lists, keyframe images, or production briefs without claiming that a video was rendered.

## Project Navigation And Recovery

- The project list is the authenticated user's tenant/workspace-scoped `creative` thread index.
- Selecting a project uses `thread/read` and paginated Turn history without resuming execution.
- Selecting a project independently restores the newest bound product summary set through the authenticated no-store endpoint above; a stale selection is discarded if authorization or schema validation fails.
- The next model Turn resumes the stored thread through the existing Gateway/App Server path.
- Running projects retain their authoritative Harness status when the user switches projects.
- Creating a blank project resets only the current client projection; the project is persisted when its first Turn creates the Codex thread.
- Generated titles continue to use the server-owned title model and `thread/name/set` readback.
- Canvas reconciliation reads bounded Harness history pages and records whether the source window is complete. An incomplete window may upsert every source it actually read, but it cannot delete any existing projection. The UI explicitly states that unloaded historical assets were retained. Complete history alone may delete an obsolete, unedited source projection, and any node with a user revision remains protected.

## Security And Ownership

Browser requests cannot provide a Skill path, output schema, tool definition, `cwd`, sandbox policy, provider identity, or tenant scope. Every project read, Turn, event stream, attachment, image artifact, and deletion rechecks authenticated ownership through the BFF.

Future canvas writes to commerce systems must use application-owned tools with authorization, approval, idempotency, audit, and downstream readback. A model statement or canvas update alone is never proof of an external write.

## Responsive Layout

Desktop uses three panes:

- project navigation: `--cp-sidebar-width`;
- canvas: remaining width;
- Harness conversation: `360px` to `430px`.

Composer popovers are collision-bound to the Harness conversation pane. Wide workbench pickers such as the Product Library switch to a compact, single-column surface instead of covering the creative canvas. Product selection updates the unsent composer context directly; removing the final product returns the next Turn to automatic product matching without changing an active Harness Turn.

At narrower widths the workbench uses a controlled **项目 / 画布 / 对话** view switch instead of forcing three tall panes into one page. The Project tab renders the full-height scrollable project sidebar in place, the Canvas tab keeps pan/zoom and selected-node editing inside the viewport, and the Conversation view keeps the composer reachable at 390 px width. Product and method controls stay inside the compact rail, and no page-level horizontal scrolling is allowed. The visual language remains the project-wide quiet grayscale system; Creative Space does not introduce a separate theme, font, radius, or color palette.

### Delivery presentation latency

The browser hides incomplete managed JSON envelopes behind a generation status. Complete drafts render as formatted content; malformed completed envelopes show a format error rather than raw JSON. Canvas loading is represented only by the toolbar request state; no overlay waits indefinitely for a streamed message id to match a history id. A terminal Turn triggers reconciliation again. Concurrent refresh triggers are coalesced into one active request and one queued readback; successful responses become visible immediately. Requests time out after 20 seconds with an explicit refresh action, and switching threads invalidates stale responses. Newly reconciled nodes enter the viewport automatically; initial project history still respects the saved viewport.

Canvas interactions use title-bar node dragging, left-button background panning and independent document/table scroll regions. The toolbar navigates nodes individually by immutable node id; explicit navigation is consumed once so subsequent editing and dragging cannot replay the previous focus request. Saved viewports below 50% zoom open focused on the latest node instead of leaving every delivery unreadably small. These controls change only the existing owned layout/viewport state and do not modify Harness source Items.

Image download uses the existing authenticated generated-image BFF with `download=1`, streaming the owned original file with attachment disposition after the same artifact permission and thread ownership checks. Conversation cards, canvas image cards and Image Studio expose explicit detail/download actions. Download never generates another image and does not rasterize application text overlays.

### Harness-owned image planning

The Agent interprets the user's image request in context using the Codex Harness and its native tool contracts. Application instructions do not map image-role keywords to fixed output counts, prescribe one call per role, or impose a collage policy. The application renders and persists actual native imageGeneration Items without adding Provider calls or fabricating artifacts.

### Turn preparation latency

After creating an owned thread, the browser establishes its authenticated event stream and uploads pending attachments concurrently, awaiting both before submitting the Turn. The same ordering applies when replacing a stale-contract thread. Gateway resolves bound attachments, generated-image edit inputs, and the selected native Skill inventory concurrently after scope checks; every preparation must succeed before native `turn/start`. This removes serial preparation waits without changing Harness lifecycle, authorization, or dispatch count.

### In-place image editing

The image editor reuses the workbench AgentComposer and submits edits to the existing Harness thread without closing the dialog. Annotation fields occupy a separate responsive panel. Pending edit UI snapshots existing image IDs and source filenames, follows the live hook running state rather than sidebar metadata, and displays a frosted progress overlay. A new native image associated with those sources is selected in place; the existing shared image stream also updates conversation and canvas projection. Drafts are cleared only when that artifact arrives, and retained on rejected or unsuccessful edits. This is presentation state only, with no extra generation dispatch or synthetic Harness lifecycle event.

The image editor's shared composer exposes the existing file picker, attachment previews, removal and validation. It uses the same pending-attachment state as the outer composer. Edit submission uploads those files through the owned-thread attachment route, then sends both attachment IDs and selected generated-image source filenames in one native Turn. A rejected submission restores pending files; accepted files remain in the thread history. Selecting a textual “upload” option alone never creates an attachment.

Pending image edits are stored in the project navigation provider, not in the dialog lifetime. Canvas source nodes and the reopened editor share this state and show the same frosted progress indicator. The mounted workbench clears it on the associated native image result or the observed running Turn ending, even when the dialog is closed. Opening or closing the editor never sends an interrupt or clears pending execution state.

Image-edit messages retain their Harness instruction text and source image filename in native history. The browser projects the application-generated edit envelope as annotation cards and a source preview, resolving the filename only against the current owned thread image inventory. Coordinate markers and cards reopen that source with its annotations and focused annotation ID. Legacy messages may recover the source through the native edited-image Turn association; without that association the UI reports that the original cannot be located instead of guessing. No synthetic Harness items or history rewrites are used.

Native request_user_input questions are also rendered inside the image editor using the same request ID and answer handler. Answers remain text-only. If an essential user file is missing, the Agent explains the missing material and finishes the native Turn; the user then attaches the file through the shared composer. File selection never sends an interrupt, and there is no separate upload-and-pause control, automatic continuation, synthetic question response, or inferred upload from answer wording.

Empty structured body fields do not constitute a copywriting draft: the browser renders a nonempty companion message when present, otherwise leaves progress to native execution/image activity. Missing titles do not inject a fabricated document heading. Empty envelopes must not materialize document nodes.

### Image workbench conversation projection

The fullscreen editor uses a full-height image preview beside a 380–400px panel containing collapsible annotations, scrollable edit history/native activities, native questions, and the shared composer. The external conversation projects each recognized image-edit Turn as a clickable summary with its actual latest artifact; its detailed messages, artifacts and activities appear inside the editor. Image families follow native sourceFilenames links, and edit association uses the application edit envelope source filename with native result association as a legacy fallback. Unassociated historical messages are retained in the ordinary conversation rather than guessed or hidden. This is a browser projection over the same Harness thread, not a new conversation runtime, history rewrite or second submission.

### Media-only completion

Pure image generation/editing completes with native artifacts, without application-requested post-generation summary, creative review, compliance notes, manual-check list or inspection calls. The creative structured envelope for this case is an empty answer with no canvasBlocks; image projection remains driven independently by native imageGeneration Items. Native turn/completed remains authoritative; the Gateway does not interrupt a successful tool to fabricate completion. Explicit user requests for text/review are distinct work. Authorization, tenant ownership, artifact persistence and security audit remain mandatory.

The installed App Server imageGeneration contract exposes a final result and lifecycle events, not partial-image preview notifications. The Provider relay streams the upstream response unchanged but must not invent partial native Items or issue a second image request. Actual progressive preview requires supported native partial-image events end to end; a top-to-bottom reveal of an already completed image is not generation streaming.

Image position notes are edited in a marker-anchored Radix Popover rather than a permanent sidebar list. Direct image clicks create a position, hovering a marker previews its text, and clicking reopens the local editor. Notes remain part of the existing native edit request; closing a note editor neither submits a Turn nor interrupts execution.

During an active Turn, browser status reconciliation also reads persisted thread images and merges by filename, allowing lost/reconnected SSE artifact notifications to recover before turn/completed. Editor activity presentation coalesces native/tool image activity into one status and distinguishes returned tool, loading artifact and available image from Turn completion; image tool completion alone never asserts an available image.

Image-editor busy presentation is scoped to the active source filename, not merely existence of a project pending edit. Only that source in focused view receives the progress overlay while submission/native running is active. Navigation and zoom remain available during another image edit; submission still respects the thread running boundary. A result from another source cannot replace the current image or clear its local draft.

Focused image submissions use exactly the currently displayed source filename; collection selection cannot silently substitute a previously selected image. Switching from collection to a focused image resets old source annotations. Position instructions explicitly use the full current source with top-left origin and left-to-right/top-to-bottom percentages; they are target locations, not panel indices or a crop rectangle. Region extraction still belongs to native tool reasoning; ambiguous boundaries require clarification rather than implicit centered crops.

### 原图区域定位

图片编辑支持点击锚点和拖动矩形选区。位置数据以完整原图左上角为原点，保存百分比 x/y/width/height，创建时记录原图 filename、artifact ID 和 naturalWidth/naturalHeight。指针坐标通过实际图片的显示边界换算，反向拖动归一化为左上角与正宽高，取消手势不创建批注。选区与具体原图产物绑定，不迁移到其他版本；历史消息显示选框并允许重新打开原图修改。

修改请求继续通过现有 Harness turn 提交原图和区域数据，没有增加独立模型调用。矩形范围是明确的定位信息，并非原生生图工具的蒙版能力。当前没有新增像素裁切工具或选区参考图附件；不得把重新生成描述为无损原图提取，也不得承诺选区外像素不变。

### 独立图片编辑会话与项目汇集

`commerce_creative_image_session` 持久化项目 thread、原图 filename 与原生编辑 thread 的关系，按 tenant/workspace/user 强制 RLS。首次打开原图通过现有受控 thread.create 入口创建 Harness thread，同一原图复用会话，编辑产物重新打开时回到其生成会话。项目锁防止重复创建，并与项目删除排队互斥。应用只持久化关联，不复制或改写原生对话历史。

图片编辑窗口中的发送、附件、原生提问回答、停止操作均指向编辑 thread。各会话挂载独立的原生事件订阅和恢复适配器，关闭窗口不停止任务，离开项目仅断开 UI 订阅，重新进入从 Harness 加载状态。项目主对话继续使用自己的 thread；项目画布按服务端授权关系汇集原生图片产物，外层编辑入口仅显示可点击记录卡片。图片编辑 thread 从顶层项目列表隐藏，删除项目时由原有持久删除 worker 先清理关联编辑 thread。

跨 thread 原图引用仅允许同一已授权项目的产物。BFF 每次提交重新核对图片元数据、来源 thread 所有权和持久项目关系，向内部 Gateway 发送授权的 filename/sourceThreadId 绑定。Gateway 在应用管理的元数据卷记录文件级引用授权，原生重试可继续引用同一原图；不复制原图、不合成 imageGeneration Item、不开放通用文件访问。删除任一相关 thread 清理授权。现有 tenant/workspace/user 并发额度和原生每 thread turn 生命周期保持生效。

### 项目切换缓存

浏览器内的主对话适配器保留最近 12 个会话的消息、图片、活动和历史分页快照；切换先展示缓存，再校验原生状态，校验期间不允许提交新 Turn。已结束且目录更新时间未变化的近期快照使用轻量 status 请求，最新 Turn ID 与状态一致时复用历史；运行中、超出 60 秒或状态变化则重新读取 Harness 历史。缓存只用于显示，不替代 Harness 持久历史、事件或权限校验，reset/auth 边界清空。

创作工作区在项目切换时保留最近 12 个项目的画布快照，并后台重新校验画布来源。已打开的图片编辑会话控制器移到项目视图切换边界之外，在同一创作工作区内切换项目时保留内容和原生订阅；离开创作工作区或清空项目时释放。没有把租户对话内容写入 localStorage 或公共全局缓存。

### 图片资产与版本入口

图片卡片按原生产物的主编辑来源（sourceFilenames 的第一项）归并，额外参考图不合并为同一资产。卡片保留原资产的画布身份和布局，显示最新产物；既有重复节点的人工内容不删除，显示层按资产折叠。版本面板展示全部原始版本，支持双图并列比较及选择旧版继续编辑。会话查找按资产根原图复用最早关联的原生编辑 thread；较早分散在其他关联 thread 或项目中的编辑历史在内部工作区只读展示，原生历史不搬迁、不改写。项目对话移除所有每轮编辑记录投影。

“另存为独立图片”是应用资产复制操作：BFF 重新检查项目与来源 thread 所有权，内部 Gateway 复制原始字节并记录 copyOf/copyRequestId，清空编辑父版本关系形成新的独立资产根。请求标识用于幂等复制；它不调用模型、不合成 Harness imageGeneration Item，也不算新的一次生图。复制元数据仍在应用管理的产物卷，按来源 thread 的正常删除策略清理。

同一资产更新原生图片快照时，画布仓库在节点 upsert 行锁与项目事务锁内计算 MAX(revision)+1，不能继续固定写入 revision=1。相同 Harness 内容仍通过内容哈希幂等去重；旧版本保持不变。

## 2026-09 本地并发验证后的读取与恢复约束

运行中的图片编辑通过受所有权检查的 `GET /api/agent/threads/:threadId/images` 同步产物库存，不再为找新图每三秒读取整段 Harness 历史。项目画布读取子编辑会话的图片也使用库存；完整对话继续由 Harness 分页管理。Gateway 对自己的图片元数据建立按线程索引，冷读合并并发请求且限制文件并发，原子元数据写入和目录变化使缓存失效；该缓存不能替代每个 BFF 请求的授权检查。

图片版本祖先查询仅在单次请求内共享已验证元数据；重开已有编辑会话不消耗新建会话的限流预算。迁移 052 为会话关系增加租户、工作区、用户、线程的复合外键。已有会话的原生历史不得被替换；仅对 Harness 确认丢失、没有首次执行时间且没有任何 Turn 预留的空会话，在数据库锁保护下替换应用绑定并调用原生 thread/start。网络错误或已接受过执行的会话不走空会话重建。

本地压测的实测范围、结果与生产未验收项见 [2026-09-11 报告](../reports/2026-09-11-local-launch-load-test.md)。
