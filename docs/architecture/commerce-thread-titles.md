# Commerce Thread Titles

All ordinary conversations and Task Recipe threads use the same server-owned title pipeline.

## Lifecycle

1. The BFF creates the thread with the provisional title `新任务` and an optional validated `recipeId`.
2. The user turn starts immediately; title generation never blocks Agent execution.
3. After the first completed result, the web client requests title generation without sending title content.
4. The BFF rechecks thread ownership and idempotency.
5. The Gateway reads the authoritative App Server thread history and extracts the first user goal plus latest completed assistant result.
6. The configured title model generates a short outcome-oriented title.
7. The Gateway calls App Server `thread/name/set` and returns the title.
8. The BFF stores the same title, model id, and generation timestamp in the tenant-scoped task index.

## Model Policy

`COMMERCE_TITLE_MODEL` defaults to `gpt-5.3-codex-spark`. Gateway startup does not silently substitute another model. Every generation verifies that the exact model id exists in the Provider `/models` response. If the model is unavailable or generation fails, the thread keeps the provisional title and can retry later.

The prompt asks for a business object plus completed outcome, rejects technical prefixes such as `任务` or `对话`, and uses a fixed JSON schema containing only `title`.

## Security And Accounting

- The browser cannot choose the title model, submit a title, or provide thread history excerpts.
- The BFF checks tenant, workspace, user, and thread ownership before every request.
- App Server history is the source of title context.
- Generated titles are normalized and length-bounded before persistence.
- Provider usage is emitted as `title_generation` for normal enterprise accounting.
- `recipeId` is persisted independently, so changing a title cannot change which specialized workspace opens.
