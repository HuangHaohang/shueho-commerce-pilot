import { describe, expect, it } from "vitest";

import { buildCopywritingRecipeQuestions, summarizeRecipeAnswers } from "./recipe";

describe("copywriting recipe intake", () => {
  it("asks only missing high-impact decisions", () => {
    expect(buildCopywritingRecipeQuestions("给这款包写一套上新文案").map((question) => question.id)).toEqual([
      "publication_channel",
      "expression_direction",
    ]);
    expect(buildCopywritingRecipeQuestions("给这款包写一套小红书自然种草文案")).toEqual([]);
  });

  it("always offers an Agent-decides path for ordinary users", () => {
    const questions = buildCopywritingRecipeQuestions("写一套上新文案");
    expect(questions.every((question) => question.options.some((option) => option.label === "让我决定"))).toBe(true);
  });

  it("turns selected answers into execution context", () => {
    const questions = buildCopywritingRecipeQuestions("写一套上新文案");
    expect(
      summarizeRecipeAnswers(questions, {
        publication_channel: { answers: ["小红书"] },
        expression_direction: { answers: ["自然种草"] },
      }),
    ).toContain("小红书");
  });
});
