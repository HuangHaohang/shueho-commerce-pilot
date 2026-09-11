import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { STUDIO_SKILLS } from "../codex/studio-skill-catalog.js";
import { installStudioSkills } from "../codex/studio-skills.js";
import { buildExplicitSkillTurn, resolveExplicitSkillFromCatalog } from "../codex/explicit-skill.js";
import { readBrowserSkillInventory } from "./browser-skill-inventory.js";

test("bundled studio skills install idempotently with every demo available and native explicit invocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-studio-skills-"));
  try {
    await installStudioSkills(root);
    const entries = [];
    for (const skill of STUDIO_SKILLS) {
      const path = join(root, ".agents/skills", skill.name, "SKILL.md");
      const before = await stat(path);
      assert.match(await readFile(path, "utf8"), new RegExp(`name: ${skill.name}`));
      assert.ok((await stat(join(root, ".agents/skills", skill.name, "assets/preview.webp"))).size > 0);
      for (const asset of [skill.preview_url, ...skill.preview_examples.flatMap((example) => [example.url, ...(example.detail_url ? [example.detail_url] : [])])]) {
        assert.match(asset, /^\/skill-demos\/[a-z0-9-]+\.(jpg|webp)$/);
        assert.ok((await stat(join("apps/web/public", asset))).size > 0);
      }
      await installStudioSkills(root);
      assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
      entries.push({ name: skill.name, path, enabled: true });
    }
    const catalog = { data: [{ cwd: root, skills: entries }] };
    const inventory = readBrowserSkillInventory(catalog, root);
    assert.equal(inventory.skills.length, 5);
    assert.ok(inventory.skills.every((skill) => skill.presentation && skill.applicationManaged));
    assert.equal(JSON.stringify(inventory).includes(root), false);
    for (const entry of entries) {
      const selection = resolveExplicitSkillFromCatalog(catalog, root, entry.name);
      assert.ok(selection);
      const input = buildExplicitSkillTurn(selection, "保留这句用户请求").input;
      assert.deepEqual(input.map((item) => item.type), ["text", "skill"]);
      assert.deepEqual(input[1], { type: "skill", name: entry.name, path: entry.path });
      const disabledCatalog = { data: [{ cwd: root, skills: [{ ...entry, enabled: false }] }] };
      assert.equal(resolveExplicitSkillFromCatalog(disabledCatalog, root, entry.name), null);
    }
    assert.deepEqual(readBrowserSkillInventory({ data: [{ cwd: root, skills: [] }] }, root).skills, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bundled installer refuses a linked runtime skill directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "commerce-studio-link-"));
  const other = await mkdtemp(join(tmpdir(), "commerce-studio-target-"));
  try {
    await symlink(other, join(root, ".agents"));
    await assert.rejects(installStudioSkills(root), /symbolic link/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});
