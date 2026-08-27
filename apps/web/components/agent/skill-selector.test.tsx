import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SelectedSkillChip } from "./skill-selector";

describe("SelectedSkillChip", () => {
  it("renders the selected Skill name inside a sent user message", () => {
    const html = renderToStaticMarkup(
      <SelectedSkillChip
        skill={{
          name: "commerce-market-research",
          displayName: "Commerce Market Research",
        }}
        inlineMessage
      />,
    );

    expect(html).toContain('data-selected-skill="commerce-market-research"');
    expect(html).toContain("Commerce Market Research");
  });
});
