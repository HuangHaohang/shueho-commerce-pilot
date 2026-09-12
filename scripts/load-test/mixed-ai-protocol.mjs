import { createHash, randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScaleWeb } from './read-fixture-policy.mjs';

export const PAID_AUTHORIZATION = 'company-100-user-ai-image-acceptance-2026-09-12';
export const TERMINAL = new Set(['completed', 'failed', 'interrupted']);
const artifactRoot = fileURLToPath(new URL('../../.runtime/scale-validation/', import.meta.url));
export function privatePath(value) {
  const path = resolve(value ?? '');
  const inside = relative(artifactRoot, path);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Use a private artifact path below .runtime/scale-validation.');
  return path;
}
export function mixedConfig(env) {
  if (env.LOADTEST_PAID_AUTHORIZATION !== PAID_AUTHORIZATION) throw new Error('Explicit paid acceptance scope is required.');
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(env.LOADTEST_MODEL ?? 'gpt-5.6-luna')) throw new Error('Invalid configured model identifier.');
  const bounded = (value, fallback, min, max) => {
    const number = Number(value ?? fallback);
    if (!Number.isInteger(number) || number < min || number > max) throw new Error('Invalid bounded load-test setting.');
    return number;
  };
  return {
    baseUrl: validateScaleWeb(env.LOADTEST_BASE_URL),
    usersFile: privatePath(env.LOADTEST_USERS_FILE), outputDir: privatePath(env.LOADTEST_OUTPUT_DIR),
    model: env.LOADTEST_MODEL ?? 'gpt-5.6-luna',
    requestTimeoutMs: bounded(env.LOADTEST_REQUEST_TIMEOUT_MS, 40_000, 1_000, 60_000),
    turnTimeoutMs: bounded(env.LOADTEST_TURN_TIMEOUT_MS, 660_000, 10_000, 900_000),
    readDurationMs: bounded(env.LOADTEST_READ_DURATION_MS, 120_000, 10_000, 600_000),
    pollMs: bounded(env.LOADTEST_POLL_MS, 3_000, 1_000, 30_000),
    usageFile: env.LOADTEST_USAGE_RECEIPTS_FILE ? privatePath(env.LOADTEST_USAGE_RECEIPTS_FILE) : null,
  };
}
export function validateMixedUsers(users) {
  if (!Array.isArray(users) || users.length !== 100 || users.some(user =>
    typeof user.cookie !== 'string' || !user.cookie || /[\r\n]/.test(user.cookie) ||
    typeof user.threadId !== 'string' || !/^[a-zA-Z0-9_-]{8,200}$/.test(user.threadId)) ||
    new Set(users.map(user => user.cookie)).size !== 100 || new Set(users.map(user => user.threadId)).size !== 100) {
    throw new Error('Provide exactly 100 distinct authenticated users and distinct native threads.');
  }
}
export function fixtureFingerprint(users) { return createHash('sha256').update(users.map(user => user.threadId).join('\n')).digest('hex'); }
export function createMixedPlan(users, model) {
  validateMixedUsers(users);
  return {
    schemaVersion: 1, authorization: PAID_AUTHORIZATION, runId: randomUUID(), createdAt: new Date().toISOString(),
    fixtureFingerprint: fixtureFingerprint(users), model,
    scope: { textTurns: 21, imageTurns: 11, requestedImageArtifacts: 11, readingUsers: 100,
      note: '32 logical user Turns are not a provider-response or spending cap. title_generation, native image requests and subagent responses may add billable calls. Only the full root-scoped usage ledger establishes actual consumption; application quotas remain authoritative.' },
    phases: { preflight: 'not_started', batch: 'not_started' },
    entries: Array.from({ length: 32 }, (_, user) => ({ user, threadId: users[user].threadId, clientRequestId: randomUUID(),
      phase: user < 2 ? 'preflight' : 'batch', kind: user === 1 || user >= 22 ? 'image' : 'text', dispatchAttempted: false,
      outcome: 'not_submitted', usage: { status: 'requires_ledger_readback', rows: [] } })),
  };
}
export function assertPhaseCanDispatch(receipt, phase) {
  if (!['preflight', 'batch'].includes(phase) || receipt.phases[phase] !== 'not_started' ||
    receipt.entries.some(entry => entry.phase === phase && entry.dispatchAttempted)) throw new Error('This phase cannot be submitted again; use reconcile only.');
  if (phase === 'batch' && (receipt.phases.preflight !== 'finished' || receipt.entries.filter(entry => entry.phase === 'preflight').some(entry => entry.outcome !== 'completed_verified'))) {
    throw new Error('The paid preflight must complete with native history and artifact readback before the batch.');
  }
}
export function syntheticPrompt(entry) {
  return entry.kind === 'image'
    ? `这是已授权的内部并发验收，请仅用原生图片生成工具生成一张 1024×1024 概念图：无品牌蓝色陶瓷杯，圆形把手，白色背景，柔和光影，无文字无标识。这是虚构概念图，不是真实在售产品，不需要上传实物或读取商品资料。只生成一张，完成后结束。不要联网、调用外部数据工具或重复生成。验收编号 ${entry.user + 1}。`
    : `这是已授权的内部并发验收，仅依据以下合成资料完成中文商品介绍：虚构的无品牌蓝色陶瓷杯，容量 300mL，圆形把手，可用作饮水杯。给出标题和约 120 字正文。不要虚构保温、耐热、认证、销量或价格。不要联网、调用工具或生成图片。验收编号 ${entry.user + 1}。`;
}

/** Stateful UTF-8 + SSE parser: chunk boundaries may split a character or CRLF. */
export function createSseParser(onFrame, maximumFrameCharacters = 2_000_000) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  function drain(final = false) {
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      if (frame.length > maximumFrameCharacters) throw new Error('SSE frame exceeded the safe bound.');
      buffer = buffer.slice(match.index + match[0].length);
      const data = [], events = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        if (line.startsWith('event:')) events.push(line.slice(6).replace(/^ /, ''));
      }
      if (data.length) onFrame({ event: events.at(-1) ?? 'message', data: data.join('\n') });
    }
    if (buffer.length > maximumFrameCharacters) throw new Error('SSE frame exceeded the safe bound.');
    if (final && buffer.trim()) throw new Error('SSE stream ended with a partial frame.');
  }
  return { push(bytes) { buffer += decoder.decode(bytes, { stream: true }); drain(); }, finish() { buffer += decoder.decode(); drain(true); } };
}

/** Cancel observation promptly even if transport read/cancel cleanup never settles. */
export async function drainAbortableBody(body, signal, onChunk) {
  const reader = body.getReader();
  let releaseAbort;
  const aborted = new Promise(resolve => { releaseAbort = () => resolve({ aborted: true }); });
  const cancel = () => {
    releaseAbort();
    try { void Promise.resolve(reader.cancel()).catch(() => undefined); } catch { /* cancellation is best effort */ }
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  let completed = false;
  try {
    while (!signal.aborted) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.aborted) return false;
      if (next.done) { completed = true; return true; }
      onChunk(next.value);
    }
    return false;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!completed && !signal.aborted) cancel();
    try { reader.releaseLock(); } catch { /* a pending transport read is abandoned */ }
  }
}

export async function stopSubscription(subscription, timeoutMs = 1_000) {
  subscription.stop.abort();
  let timer;
  try {
    return await Promise.race([
      subscription.done.then(() => true, () => false),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
export function safeError(error) { return ['AbortError', 'TimeoutError', 'TypeError'].includes(error?.name) ? error.name : 'read_or_transport_failure'; }
export function visibleAssistantText(content) {
  if (typeof content !== 'string') return '';
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!normalized.startsWith('{')) return normalized;
  try {
    const value = JSON.parse(normalized);
    return [value.title, value.body, value.message, value.reportMarkdown].filter(part => typeof part === 'string' && part.trim()).join('\n');
  } catch { return ''; }
}
export function assessReadback(entry, status, history, images) {
  const userItems = history.messages.filter(message => message.role === 'user' && message.clientId === entry.clientRequestId);
  const turns = [...new Set(userItems.map(message => message.turnId).filter(Boolean))];
  const turnId = entry.turnId ?? (turns.length === 1 ? turns[0] : null);
  const matchingImages = images.filter(image => image.turnId === turnId);
  const filenames = matchingImages.map(image => image.filename);
  const assistantItems = history.messages.filter(message => message.turnId === turnId && message.role === 'assistant' && message.phase !== 'commentary' && visibleAssistantText(message.content));
  const allNativeImages = history.activities.filter(activity => activity.turnId === turnId && activity.kind === 'image');
  const nativeImages = allNativeImages.filter(activity => activity.status === 'completed');
  const terminal = turnId && status.id === entry.threadId && status.lastTurnId === turnId && TERMINAL.has(status.status) ? status.status : null;
  const historyTerminal = history.thread?.id === entry.threadId && history.thread?.lastTurnId === turnId && history.thread?.status === terminal;
  const duplicate = turns.length > 1 || userItems.length !== 1 || (turns.length === 1 && turns[0] !== turnId) || new Set(filenames).size !== filenames.length;
  const correctArtifacts = entry.kind === 'image' ? filenames.length === 1 && nativeImages.length === 1 && allNativeImages.length === 1
    : filenames.length === 0 && allNativeImages.length === 0 && assistantItems.length > 0;
  return { turnId, terminal, historyTerminal, userItemCount: userItems.length, assistantItemCount: assistantItems.length,
    imageItemCount: nativeImages.length, imageAttemptCount: allNativeImages.length, filenames, duplicate, correctArtifacts,
    verified: terminal === 'completed' && historyTerminal && !duplicate && correctArtifacts };
}
export function matchUsage(entry, receipt) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.source !== 'commerce_agent_usage_event' || !Array.isArray(receipt.rows)) return { status: 'requires_ledger_readback', rows: [] };
  const rows = receipt.rows.filter(row => row.threadId === entry.threadId && row.turnId === entry.turnId).map(row => ({
    id: row.id, responseId: row.responseId, providerId: row.providerId, model: row.model, source: row.source ?? 'unspecified', usageStatus: row.usageStatus,
    totalTokens: row.totalTokens, inputTokens: row.inputTokens, outputTokens: row.outputTokens,
  }));
  const valid = rows.length > 0 && rows.every(row => [row.id, row.responseId, row.providerId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 255) &&
    [row.totalTokens, row.inputTokens, row.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) && row.usageStatus === 'reported') &&
    new Set(rows.map(row => `${row.providerId}:${row.responseId}`)).size === rows.length;
  return { status: valid ? 'matched_operator_ledger_readback' : 'missing_or_incomplete_ledger', capturedAt: receipt.capturedAt, rows: valid ? rows : [] };
}

export function summarizeRunUsage(entries, receipt) {
  if (!receipt || receipt.schemaVersion !== 1 || receipt.source !== 'commerce_agent_usage_event' || !Array.isArray(receipt.rows)) {
    return { status: 'requires_full_root_ledger_export', providerResponses: null, totalTokens: null };
  }
  const roots = new Set(entries.filter(entry => entry.dispatchAttempted).map(entry => entry.threadId));
  const rows = receipt.rows.filter(row => roots.has(row.rootThreadId ?? row.threadId));
  const knownSources = ['codex_harness', 'commerce_web_mcp', 'commerce_web_tool', 'commerce_image_tool', 'title_generation'];
  const valid = rows.length > 0 && rows.every(row => [row.id, row.responseId, row.providerId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 255) &&
    knownSources.includes(row.source) && row.usageStatus === 'reported' && Number.isSafeInteger(row.totalTokens) && row.totalTokens >= 0);
  const unique = new Set(rows.map(row => `${row.providerId}:${row.responseId}`)).size === rows.length;
  const scope = receipt.scope;
  const fullScope = scope?.includesDescendants === true && scope?.includesAllSources === true && Array.isArray(scope.rootThreadIds) &&
    [...roots].every(id => scope.rootThreadIds.includes(id));
  return {
    status: valid && unique && fullScope ? 'matched_full_root_ledger_readback' : 'incomplete_root_ledger',
    capturedAt: receipt.capturedAt, fullScope, observedRows: rows.length,
    providerResponses: valid && unique ? rows.length : null,
    totalTokens: valid && unique ? rows.reduce((sum, row) => sum + row.totalTokens, 0) : null,
    bySource: valid && unique ? knownSources.map(source => ({ source, responses: rows.filter(row => row.source === source).length,
      totalTokens: rows.filter(row => row.source === source).reduce((sum, row) => sum + row.totalTokens, 0) })) : [],
    descendantResponses: valid && unique ? rows.filter(row => row.threadId !== row.rootThreadId && row.rootThreadId).length : null,
    ledgerRows: valid && unique ? rows.map(row => ({ id: row.id, responseId: row.responseId, providerId: row.providerId,
      rootThreadId: row.rootThreadId ?? row.threadId, threadId: row.threadId, turnId: row.turnId, source: row.source, model: row.model, totalTokens: row.totalTokens })) : [],
    note: 'Provider response count includes title_generation and descendant agents; it is not the number of user Turns. Token counts are measured usage, not an invented monetary price.',
  };
}
