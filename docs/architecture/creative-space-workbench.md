# Creative Space Workbench

Commerce Pilot's Creative Space is a three-pane, browser-based workbench built directly on the open-source Codex App Server harness.

## Product Model

- Clicking **创作空间** enters the workbench directly; it does not open a secondary generator menu.
- The left pane lists creative projects.
- The center pane is a blank creative canvas until the selected project produces a deliverable.
- The right pane is the normal Harness conversation, including streamed items, native questions, queueing, interruption, attachments, image generation, recovery, and history.

Creative Space does not introduce a separate project conversation system:

```text
Creative project = persisted Codex thread
User request or revision = Codex Turn
Conversation/tool/media progress = Codex Item stream
Canvas = projection of persisted final Agent Items
```

The PostgreSQL thread index remains an ownership and navigation index. Codex App Server is authoritative for conversation history and Turn state.

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
| 商品标题与文案 | `commerce-listing-copy` |
| 推广文案 | `commerce-promotion-copy` |
| 商品主图 | `commerce-product-main-image` |
| 副图与场景图 | `commerce-product-gallery` |
| 商品详情页 | `commerce-product-detail-page` |
| 产品拍摄脚本 | `commerce-product-shooting-script` |
| 短视频脚本与分镜 | `commerce-short-video-storyboard` |

The browser may send only the allowlisted `creativeMethod` value. Gateway rejects unknown values and resolves the application-owned Skill path. It never accepts a Skill path, Skill body, developer instruction, output schema, tool definition, or runtime root from the browser. The specialist Skill refines the commerce deliverable; it does not create another thread, Turn, prompt chain, or project store.

The Skill treats later Turns as revisions of the current project unless the user clearly starts another deliverable. It asks high-impact missing questions only through native `item/tool/requestUserInput`. It does not run a prompt chain, hidden revision loop, or second Agent session.

Creative direction changes submitted while a Turn is active use native `turn/steer`. They remain inside the same schema-constrained Turn and do not create an application-owned queue or a second Agent loop. Native `thread/queue/*` remains available for ordinary conversation input; managed workflows never enter it because App Server's queue contract has no per-submission `outputSchema`.

The browser assigns each steer one stable `clientUserMessageId`, renders it as pending, and waits for the authoritative Harness `userMessage.clientId` through the owned thread readback before clearing the composer. An ambiguous HTTP failure is retried only with that same id. The Gateway serializes steering per thread, checks native `thread/items/list` before dispatch, and reads back the same id after an uncertain App Server response, so a retry cannot inject a second copy. Because the project workflow is fixed, the Creative Space composer omits the unrestricted explicit Skill selector. Its business-method selector is a separate closed control that maps to the application registry and never exposes arbitrary Skills.

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

## Canvas Projection

The canvas owns no independent business state. It selects the newest completed creative delivery Turn by Harness sequence and groups:

1. its completed final assistant Item containing the structured document and delivery metadata;
2. every native `imageGeneration` artifact from that same Turn, projected through the ownership-checked BFF;
3. legacy completed final assistant text when no structured delivery exists.

Commentary, streaming fragments, user messages, and conversational `responseType=answer` replies do not replace the current canvas. A revision Turn returns the complete latest draft, so the canvas can project it deterministically without storing a browser-authored version history. Main-image and gallery Turns therefore retain every native image from their delivery instead of showing only the last one; the companion final message contributes labels and review notes but never becomes a duplicate media artifact.

When no persisted delivery exists, the canvas remains blank.

## Native Media Boundary

Image requests use the Harness-native `image_gen` tool. The resulting `imageGeneration` Item is the artifact authority. Gateway may persist the completed tenant-owned file and expose an ownership-checked BFF URL, but it must not issue a duplicate Provider request, expose base64 or host paths, or create a browser image-generation endpoint.

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

## Security And Ownership

Browser requests cannot provide a Skill path, output schema, tool definition, `cwd`, sandbox policy, provider identity, or tenant scope. Every project read, Turn, event stream, attachment, image artifact, and deletion rechecks authenticated ownership through the BFF.

Future canvas writes to commerce systems must use application-owned tools with authorization, approval, idempotency, audit, and downstream readback. A model statement or canvas update alone is never proof of an external write.

## Responsive Layout

Desktop uses three panes:

- project navigation: `--cp-sidebar-width`;
- canvas: remaining width;
- Harness conversation: `360px` to `430px`.

Composer popovers are collision-bound to the Harness conversation pane. Wide workbench pickers such as the Product Library switch to a compact, single-column surface instead of covering the creative canvas. Product selection updates the unsent composer context directly; removing the final product returns the next Turn to automatic product matching without changing an active Harness Turn.

At narrower widths the workbench uses a controlled **项目 / 画布 / 对话** view switch instead of forcing three tall panes into one page. The Project tab renders the full-height scrollable project sidebar in place, while the active Conversation view keeps the composer reachable at 390 px width. Product and method controls stay inside the compact rail, and no page-level horizontal scrolling is allowed. The visual language remains the project-wide quiet grayscale system; Creative Space does not introduce a separate theme, font, radius, or color palette.
