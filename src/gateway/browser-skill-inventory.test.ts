import assert from "node:assert/strict";
import test from "node:test";

import { readBrowserSkillInventory } from "./browser-skill-inventory.js";

test("removes internal workflow and specialist Skills from the browser inventory", () => {
  const runtimeRoot = "/srv/commerce-runtime";
  const result = readBrowserSkillInventory({
    data: [{
      cwd: runtimeRoot,
      skills: [
        { name: "commerce-creative-project", path: "/private/base", enabled: true },
        { name: "commerce-product-main-image", path: "/private/main", enabled: true },
        { name: "skill-creator", path: "/system/creator", enabled: true },
        { name: "commerce-custom-review", path: "/tenant/custom", enabled: true },
      ],
    }],
  }, runtimeRoot);

  assert.deepEqual(result.skills.map((skill) => skill.name), [
    "skill-creator",
    "commerce-custom-review",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /\/private\/base|\/private\/main/);
});
