import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExplicitSkillTurn,
  readVisibleExplicitSkillMessage,
  resolveExplicitSkillFromCatalog,
} from "../codex/explicit-skill.js";

const cwd = "/srv/commerce-runtime";

test("resolves an enabled skill from the App Server catalog and builds native skill input", () => {
  const skill = resolveExplicitSkillFromCatalog(
    {
      data: [
        {
          cwd,
          skills: [
            {
              name: "skill-creator",
              path: "/srv/codex/skills/skill-creator/SKILL.md",
              enabled: true,
            },
          ],
        },
      ],
    },
    cwd,
    "skill-creator",
  );

  assert.deepEqual(skill, {
    name: "skill-creator",
    path: "/srv/codex/skills/skill-creator/SKILL.md",
  });
  assert.deepEqual(buildExplicitSkillTurn(skill!, "创建一个退款审核技能").input, [
    {
      type: "text",
      text: "创建一个退款审核技能",
      text_elements: [],
    },
    {
      type: "skill",
      name: "skill-creator",
      path: "/srv/codex/skills/skill-creator/SKILL.md",
    },
  ]);
  assert.equal(
    readVisibleExplicitSkillMessage("$skill-creator\n创建一个退款审核技能"),
    "创建一个退款审核技能",
  );
});

test("rejects browser paths, disabled skills, unsafe names, and relative catalog paths", () => {
  const catalog = {
    data: [
      {
        cwd,
        skills: [
          { name: "disabled-skill", path: "/srv/skills/disabled/SKILL.md", enabled: false },
          { name: "relative-skill", path: "skills/relative/SKILL.md", enabled: true },
          { name: "commerce-product-main-image", path: "/srv/internal/main/SKILL.md", enabled: true },
        ],
      },
    ],
  };

  assert.equal(resolveExplicitSkillFromCatalog(catalog, cwd, "disabled-skill"), null);
  assert.equal(resolveExplicitSkillFromCatalog(catalog, cwd, "relative-skill"), null);
  assert.equal(resolveExplicitSkillFromCatalog(catalog, cwd, "commerce-product-main-image"), null);
  assert.equal(resolveExplicitSkillFromCatalog(catalog, cwd, "../../host-skill"), null);
});
