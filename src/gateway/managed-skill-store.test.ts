import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ManagedSkillStore, validateManagedSkillDraft } from "./managed-skill-store.js";

const scope = {
  tenantId: "1db38609-3d70-4dd6-963a-5274383d62f4",
  workspaceId: "18a08712-7f48-45c8-92dc-507ecdcdb782",
  userId: "user-1",
  rootThreadId: "thread-12345678",
  parentThreadId: null,
  model: "gpt-5.6-sol",
};

const draft = {
  name: "commerce-product-copywriter",
  displayName: "商品文案助手",
  description: "为电商商品生成基于已知事实的标题、卖点和渠道文案。",
  shortDescription: "生成可核验的商品文案",
  instructions: "# 商品文案助手\n\n- 先确认商品事实和发布渠道。\n- 不得虚构价格、功效、认证或库存。\n- 输出可直接审核的文案。",
};

test("creates, reads back, and idempotently updates an app-owned instruction-only skill", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "commerce-managed-skill-"));
  const store = new ManagedSkillStore(runtimeRoot);
  const created = await store.publish(draft, scope);
  assert.equal(created.operation, "created");
  const skillPath = join(runtimeRoot, ".agents", "skills", draft.name, "SKILL.md");
  assert.match(await readFile(skillPath, "utf8"), /name: commerce-product-copywriter/);
  assert.match(
    await readFile(join(runtimeRoot, ".agents", "skills", draft.name, "agents", "openai.yaml"), "utf8"),
    /display_name: "商品文案助手"/,
  );

  const unchanged = await store.publish(draft, scope);
  assert.equal(unchanged.operation, "unchanged");
  const updated = await store.publish({ ...draft, shortDescription: "生成并审核商品渠道文案" }, scope);
  assert.equal(updated.operation, "updated");
});

test("rejects reserved names, paths, foreign owners, and symlink targets", async () => {
  assert.throws(
    () => validateManagedSkillDraft({ ...draft, name: "commerce-copywriting" }),
    /unreserved commerce-/,
  );
  assert.throws(
    () => validateManagedSkillDraft({ ...draft, name: "commerce-../escape" }),
    /unreserved commerce-/,
  );

  const runtimeRoot = await mkdtemp(join(tmpdir(), "commerce-managed-skill-security-"));
  const store = new ManagedSkillStore(runtimeRoot);
  await store.publish(draft, scope);
  await assert.rejects(
    store.publish(draft, { ...scope, userId: "another-user" }),
    /another Commerce Pilot principal/,
  );

  const symlinkRoot = await mkdtemp(join(tmpdir(), "commerce-managed-skill-symlink-"));
  const skillRoot = join(symlinkRoot, ".agents", "skills");
  const outside = await mkdtemp(join(tmpdir(), "commerce-managed-skill-outside-"));
  await mkdir(skillRoot, { recursive: true });
  await symlink(outside, join(skillRoot, draft.name));
  await assert.rejects(new ManagedSkillStore(symlinkRoot).publish(draft, scope), /real directory/);
});
