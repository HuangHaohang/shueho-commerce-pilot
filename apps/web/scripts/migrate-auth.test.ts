import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../migrations/048_creative_campaign_review_methods.sql", import.meta.url),
);
const runnerPath = fileURLToPath(new URL("./migrate-auth.ts", import.meta.url));

describe("creative campaign and review method migration", () => {
  it("rebuilds only the creative deliverable check with legacy and new methods", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      "DROP CONSTRAINT IF EXISTS commerce_creative_canvas_node_deliverable_type_check",
    );
    expect(migration).toContain(
      "ADD CONSTRAINT commerce_creative_canvas_node_deliverable_type_check",
    );
    expect(migration).toContain("deliverable_type IS NULL");
    for (const method of [
      "campaign_pack",
      "listing_copy",
      "promotion_copy",
      "main_image",
      "gallery_images",
      "detail_page",
      "shooting_script",
      "video_storyboard",
      "creative_qa",
    ]) {
      expect(migration).toContain(`'${method}'`);
    }
    expect(migration).not.toMatch(/\b(?:DROP TABLE|DELETE|INSERT|UPDATE)\b/i);
  });

  it("registers the append-only migration after the existing canvas migrations", () => {
    const runner = readFileSync(runnerPath, "utf8");
    const previous = runner.indexOf("20260831_047_creative_canvas_reconciliation_delete");
    const current = runner.indexOf("20260901_048_creative_campaign_review_methods");

    expect(previous).toBeGreaterThanOrEqual(0);
    expect(current).toBeGreaterThan(previous);
    expect(runner).toContain("migrations/048_creative_campaign_review_methods.sql");
  });
});
