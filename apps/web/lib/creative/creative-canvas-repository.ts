import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";

import type {
  CreativeCanvasLayout,
  CreativeCanvasMessageReference,
  CreativeCanvasNodeContent,
  CreativeCanvasNodeRecord,
  CreativeCanvasSourceNode,
  CreativeCanvasState,
  CreativeCanvasViewport,
} from "./creative-canvas-types";

type CanvasNodeRow = {
  id: string;
  source_kind: CreativeCanvasNodeRecord["sourceKind"];
  source_item_id: string;
  source_block_key: string;
  source_turn_id: string | null;
  source_sequence: number;
  message_item_id: string | null;
  node_type: CreativeCanvasNodeRecord["nodeType"];
  deliverable_type: string | null;
  channel: string | null;
  title: string;
  revision_id: string;
  revision: number;
  revision_origin: CreativeCanvasNodeRecord["revision"]["origin"];
  revision_content: CreativeCanvasNodeContent;
  revision_created_at: Date;
  revision_count: number | string;
  previous_revision_id: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  locked: boolean;
};

type MessageRefRow = {
  message_item_id: string;
  node_id: string;
  node_type: CreativeCanvasMessageReference["nodeType"];
  title: string;
};

type ViewportRow = { x: number; y: number; zoom: number };

export class CreativeCanvasRepositoryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CreativeCanvasRepositoryError";
  }
}

export async function reconcileCreativeCanvasState(
  scope: EnterpriseScope,
  threadId: string,
  sources: CreativeCanvasSourceNode[],
  options: { sourceHistoryComplete: boolean },
): Promise<CreativeCanvasState> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `creative-canvas:${scope.tenantId}:${scope.workspaceId}:${scope.userId}:${threadId}`,
    ]);
    for (const source of sources) {
      await reconcileSourceNode(client, scope, threadId, source);
    }
    if (options.sourceHistoryComplete) {
      const activeSourceKeys = sources.map((source) =>
        [source.sourceKind, source.sourceItemId, source.sourceBlockKey].join("\u001f"));
      await client.query(
        `DELETE FROM commerce_creative_canvas_node node
       WHERE node.tenant_id = $1 AND node.workspace_id = $2
         AND node.user_id = $3 AND node.thread_id = $4
         AND node.source_kind IN ('agent_message', 'image_generation')
         AND NOT (
           (node.source_kind || chr(31) || node.source_item_id || chr(31) || node.source_block_key)
           = ANY($5::text[])
         )
         AND NOT EXISTS (
           SELECT 1 FROM commerce_creative_canvas_node_revision revision
           WHERE revision.tenant_id = node.tenant_id
             AND revision.workspace_id = node.workspace_id
             AND revision.node_id = node.id
             AND revision.origin = 'user'
         )`,
        [scope.tenantId, scope.workspaceId, scope.userId, threadId, activeSourceKeys],
      );
    }
    return readCreativeCanvasStateWithClient(client, scope, threadId);
  });
}

export async function readCreativeCanvasState(
  scope: EnterpriseScope,
  threadId: string,
): Promise<CreativeCanvasState> {
  return withEnterpriseDatabaseContext(scope, (client) =>
    readCreativeCanvasStateWithClient(client, scope, threadId));
}

export async function saveCreativeCanvasNodeRevision(
  scope: EnterpriseScope,
  threadId: string,
  nodeId: string,
  content: CreativeCanvasNodeContent,
): Promise<CreativeCanvasNodeRecord> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `creative-canvas-node:${scope.tenantId}:${scope.workspaceId}:${nodeId}`,
    ]);
    const node = await client.query<{ node_type: CreativeCanvasNodeRecord["nodeType"] }>(
      `SELECT node_type FROM commerce_creative_canvas_node
       WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND user_id = $4 AND thread_id = $5
       LIMIT 1`,
      [nodeId, scope.tenantId, scope.workspaceId, scope.userId, threadId],
    );
    const nodeType = node.rows[0]?.node_type;
    if (!nodeType) {
      throw new CreativeCanvasRepositoryError("画布节点不存在。", "CANVAS_NODE_NOT_FOUND", 404);
    }
    if (content.kind !== nodeType) {
      throw new CreativeCanvasRepositoryError("画布节点类型不匹配。", "CANVAS_NODE_TYPE_MISMATCH", 409);
    }
    const serialized = JSON.stringify(content);
    const hash = sha256(serialized);
    await client.query(
      `INSERT INTO commerce_creative_canvas_node_revision
         (tenant_id, workspace_id, user_id, thread_id, node_id, revision, origin, content, content_sha256)
       SELECT $2, $3, $4, $5, $1,
              COALESCE(MAX(revision), 0) + 1, 'user', $6::jsonb, $7
       FROM commerce_creative_canvas_node_revision
       WHERE tenant_id = $2 AND workspace_id = $3 AND node_id = $1`,
      [nodeId, scope.tenantId, scope.workspaceId, scope.userId, threadId, serialized, hash],
    );
    await client.query(
      `UPDATE commerce_creative_canvas_node
       SET title = $6
       WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND user_id = $4 AND thread_id = $5`,
      [nodeId, scope.tenantId, scope.workspaceId, scope.userId, threadId, content.title],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
         (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
       VALUES ($1, $2, $3, 'creative_canvas.node.edit', 'creative_canvas_node', $4, 'succeeded',
               jsonb_build_object('threadId', $5::text, 'nodeType', $6::text))`,
      [scope.tenantId, scope.workspaceId, scope.userId, nodeId, threadId, nodeType],
    );
    const state = await readCreativeCanvasStateWithClient(client, scope, threadId);
    const updated = state.nodes.find((entry) => entry.id === nodeId);
    if (!updated) {
      throw new CreativeCanvasRepositoryError("画布节点无法读回。", "CANVAS_NODE_READBACK_FAILED", 500);
    }
    return updated;
  });
}

export async function restoreCreativeCanvasNodeRevision(
  scope: EnterpriseScope,
  threadId: string,
  nodeId: string,
  revisionId: string,
): Promise<CreativeCanvasNodeRecord> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `creative-canvas-node:${scope.tenantId}:${scope.workspaceId}:${nodeId}`,
    ]);
    const source = await client.query<{ content: CreativeCanvasNodeContent }>(
      `SELECT revision.content
       FROM commerce_creative_canvas_node_revision revision
       INNER JOIN commerce_creative_canvas_node node
         ON node.tenant_id = revision.tenant_id
        AND node.workspace_id = revision.workspace_id
        AND node.id = revision.node_id
       WHERE revision.id = $1 AND revision.node_id = $2
         AND revision.tenant_id = $3 AND revision.workspace_id = $4
         AND revision.user_id = $5 AND revision.thread_id = $6
         AND node.user_id = $5 AND node.thread_id = $6
       LIMIT 1`,
      [revisionId, nodeId, scope.tenantId, scope.workspaceId, scope.userId, threadId],
    );
    const content = source.rows[0]?.content;
    if (!content) {
      throw new CreativeCanvasRepositoryError("画布版本不存在。", "CANVAS_REVISION_NOT_FOUND", 404);
    }
    const serialized = JSON.stringify(content);
    await client.query(
      `INSERT INTO commerce_creative_canvas_node_revision
         (tenant_id, workspace_id, user_id, thread_id, node_id, revision, origin, content, content_sha256)
       SELECT $2, $3, $4, $5, $1,
              COALESCE(MAX(revision), 0) + 1, 'user', $6::jsonb, $7
       FROM commerce_creative_canvas_node_revision
       WHERE tenant_id = $2 AND workspace_id = $3 AND node_id = $1`,
      [nodeId, scope.tenantId, scope.workspaceId, scope.userId, threadId, serialized, sha256(serialized)],
    );
    await client.query(
      `UPDATE commerce_creative_canvas_node
       SET title = $6
       WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND user_id = $4 AND thread_id = $5`,
      [nodeId, scope.tenantId, scope.workspaceId, scope.userId, threadId, content.title],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
         (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
       VALUES ($1, $2, $3, 'creative_canvas.node.restore', 'creative_canvas_node', $4, 'succeeded',
               jsonb_build_object('threadId', $5::text, 'sourceRevisionId', $6::text))`,
      [scope.tenantId, scope.workspaceId, scope.userId, nodeId, threadId, revisionId],
    );
    const state = await readCreativeCanvasStateWithClient(client, scope, threadId);
    const restored = state.nodes.find((entry) => entry.id === nodeId);
    if (!restored) {
      throw new CreativeCanvasRepositoryError("画布版本无法读回。", "CANVAS_REVISION_READBACK_FAILED", 500);
    }
    return restored;
  });
}

export async function saveCreativeCanvasNodeLayout(
  scope: EnterpriseScope,
  threadId: string,
  nodeId: string,
  layout: CreativeCanvasLayout,
): Promise<CreativeCanvasLayout> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<{
      x: number;
      y: number;
      width: number;
      height: number;
      z_index: number;
      locked: boolean;
    }>(
      `UPDATE commerce_creative_canvas_layout
       SET x = $6, y = $7, width = $8, height = $9, z_index = $10, locked = $11
       WHERE node_id = $1 AND tenant_id = $2 AND workspace_id = $3
         AND user_id = $4 AND thread_id = $5
       RETURNING x, y, width, height, z_index, locked`,
      [
        nodeId,
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        threadId,
        layout.x,
        layout.y,
        layout.width,
        layout.height,
        layout.zIndex,
        layout.locked,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new CreativeCanvasRepositoryError("画布节点不存在。", "CANVAS_NODE_NOT_FOUND", 404);
    }
    return toLayout(row);
  });
}

export async function saveCreativeCanvasViewport(
  scope: EnterpriseScope,
  threadId: string,
  viewport: CreativeCanvasViewport,
): Promise<CreativeCanvasViewport> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<ViewportRow>(
      `INSERT INTO commerce_creative_canvas_viewport
         (tenant_id, workspace_id, user_id, thread_id, x, y, zoom)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, workspace_id, user_id, thread_id) DO UPDATE
       SET x = EXCLUDED.x, y = EXCLUDED.y, zoom = EXCLUDED.zoom
       RETURNING x, y, zoom`,
      [scope.tenantId, scope.workspaceId, scope.userId, threadId, viewport.x, viewport.y, viewport.zoom],
    );
    const row = result.rows[0];
    return { x: row?.x ?? viewport.x, y: row?.y ?? viewport.y, zoom: row?.zoom ?? viewport.zoom };
  });
}

async function reconcileSourceNode(
  client: PoolClient,
  scope: EnterpriseScope,
  threadId: string,
  source: CreativeCanvasSourceNode,
): Promise<void> {
  const nodeResult = await client.query<{ id: string }>(
    `INSERT INTO commerce_creative_canvas_node
       (tenant_id, workspace_id, user_id, thread_id, source_kind, source_item_id,
        source_block_key, source_turn_id, source_sequence, message_item_id,
        node_type, deliverable_type, channel, title)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (
       tenant_id, workspace_id, user_id, thread_id,
       source_kind, source_item_id, source_block_key
     ) DO UPDATE
     SET source_turn_id = EXCLUDED.source_turn_id,
         source_sequence = EXCLUDED.source_sequence,
         message_item_id = COALESCE(EXCLUDED.message_item_id, commerce_creative_canvas_node.message_item_id),
         deliverable_type = EXCLUDED.deliverable_type,
         channel = EXCLUDED.channel,
         title = CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM commerce_creative_canvas_node_revision revision
             WHERE revision.tenant_id = commerce_creative_canvas_node.tenant_id
               AND revision.workspace_id = commerce_creative_canvas_node.workspace_id
               AND revision.node_id = commerce_creative_canvas_node.id
               AND revision.origin = 'user'
           ) THEN EXCLUDED.title
           ELSE commerce_creative_canvas_node.title
         END
     RETURNING id`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      threadId,
      source.sourceKind,
      source.sourceItemId,
      source.sourceBlockKey,
      source.sourceTurnId,
      source.sourceSequence,
      source.messageItemId,
      source.nodeType,
      source.deliverableType,
      source.channel,
      source.title,
    ],
  );
  const nodeId = nodeResult.rows[0]?.id;
  if (!nodeId) throw new Error("Creative canvas source node could not be reconciled.");

  const serialized = JSON.stringify(source.content);
  await client.query(
    `INSERT INTO commerce_creative_canvas_node_revision
       (tenant_id, workspace_id, user_id, thread_id, node_id, revision, origin, content, content_sha256)
     VALUES ($1, $2, $3, $4, $5, 1, 'harness', $6::jsonb, $7)
     ON CONFLICT (tenant_id, workspace_id, node_id, content_sha256)
       WHERE origin = 'harness'
     DO NOTHING`,
    [scope.tenantId, scope.workspaceId, scope.userId, threadId, nodeId, serialized, sha256(serialized)],
  );
  await client.query(
    `INSERT INTO commerce_creative_canvas_layout
       (tenant_id, workspace_id, user_id, thread_id, node_id, x, y, width, height, z_index, locked)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (node_id) DO NOTHING`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      threadId,
      nodeId,
      source.layout.x,
      source.layout.y,
      source.layout.width,
      source.layout.height,
      source.layout.zIndex,
      source.layout.locked,
    ],
  );
  if (source.messageItemId) {
    await client.query(
      `INSERT INTO commerce_creative_canvas_message_ref
         (tenant_id, workspace_id, user_id, thread_id, message_item_id, node_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [scope.tenantId, scope.workspaceId, scope.userId, threadId, source.messageItemId, nodeId],
    );
  }
}

async function readCreativeCanvasStateWithClient(
  client: PoolClient,
  scope: EnterpriseScope,
  threadId: string,
): Promise<CreativeCanvasState> {
  const nodeResult = await client.query<CanvasNodeRow>(
      `SELECT node.id, node.source_kind, node.source_item_id, node.source_block_key,
              node.source_turn_id, node.source_sequence, node.message_item_id,
              node.node_type, node.deliverable_type, node.channel, node.title,
              revision.id AS revision_id, revision.revision,
              revision.origin AS revision_origin, revision.content AS revision_content,
              revision.created_at AS revision_created_at,
              (SELECT COUNT(*)
               FROM commerce_creative_canvas_node_revision history
               WHERE history.tenant_id = node.tenant_id
                 AND history.workspace_id = node.workspace_id
                 AND history.node_id = node.id) AS revision_count,
              (SELECT history.id
               FROM commerce_creative_canvas_node_revision history
               WHERE history.tenant_id = node.tenant_id
                 AND history.workspace_id = node.workspace_id
                 AND history.node_id = node.id
               ORDER BY history.revision DESC
               OFFSET 1 LIMIT 1) AS previous_revision_id,
              layout.x, layout.y, layout.width, layout.height, layout.z_index, layout.locked
       FROM commerce_creative_canvas_node node
       INNER JOIN LATERAL (
         SELECT id, revision, origin, content, created_at
         FROM commerce_creative_canvas_node_revision candidate
         WHERE candidate.tenant_id = node.tenant_id
           AND candidate.workspace_id = node.workspace_id
           AND candidate.node_id = node.id
         ORDER BY candidate.revision DESC
         LIMIT 1
       ) revision ON true
       INNER JOIN commerce_creative_canvas_layout layout
         ON layout.tenant_id = node.tenant_id
        AND layout.workspace_id = node.workspace_id
        AND layout.node_id = node.id
       WHERE node.tenant_id = $1 AND node.workspace_id = $2
         AND node.user_id = $3 AND node.thread_id = $4
       ORDER BY node.source_sequence, node.created_at, node.id`,
      [scope.tenantId, scope.workspaceId, scope.userId, threadId],
    );
  const messageRefResult = await client.query<MessageRefRow>(
      `SELECT ref.message_item_id, ref.node_id, node.node_type, node.title
       FROM commerce_creative_canvas_message_ref ref
       INNER JOIN commerce_creative_canvas_node node
         ON node.tenant_id = ref.tenant_id
        AND node.workspace_id = ref.workspace_id
        AND node.id = ref.node_id
       WHERE ref.tenant_id = $1 AND ref.workspace_id = $2
         AND ref.user_id = $3 AND ref.thread_id = $4
       ORDER BY node.source_sequence, node.created_at`,
      [scope.tenantId, scope.workspaceId, scope.userId, threadId],
    );
  const viewportResult = await client.query<ViewportRow>(
      `SELECT x, y, zoom FROM commerce_creative_canvas_viewport
       WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3 AND thread_id = $4
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId, scope.userId, threadId],
    );
  return {
    threadId,
    nodes: nodeResult.rows.map(toNodeRecord),
    messageRefs: messageRefResult.rows.map((row) => ({
      messageItemId: row.message_item_id,
      nodeId: row.node_id,
      nodeType: row.node_type,
      title: row.title,
    })),
    viewport: viewportResult.rows[0]
      ? { x: viewportResult.rows[0].x, y: viewportResult.rows[0].y, zoom: viewportResult.rows[0].zoom }
      : null,
    resolvedAt: new Date().toISOString(),
  };
}

function toNodeRecord(row: CanvasNodeRow): CreativeCanvasNodeRecord {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceItemId: row.source_item_id,
    sourceBlockKey: row.source_block_key,
    sourceTurnId: row.source_turn_id,
    sourceSequence: row.source_sequence,
    messageItemId: row.message_item_id,
    nodeType: row.node_type,
    deliverableType: row.deliverable_type,
    channel: row.channel,
    title: row.title,
    revision: {
      id: row.revision_id,
      number: row.revision,
      origin: row.revision_origin,
      content: row.revision_content,
      createdAt: row.revision_created_at.toISOString(),
    },
    revisionCount: Number(row.revision_count),
    previousRevisionId: row.previous_revision_id,
    layout: toLayout(row),
  };
}

function toLayout(row: {
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  locked: boolean;
}): CreativeCanvasLayout {
  return {
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    zIndex: row.z_index,
    locked: row.locked,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
