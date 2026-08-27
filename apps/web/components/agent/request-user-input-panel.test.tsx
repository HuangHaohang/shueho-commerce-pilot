import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentRequestUserInputPanel } from "./request-user-input-panel";

describe("AgentRequestUserInputPanel", () => {
  it("renders a direct text field for a Harness question without options", () => {
    const html = renderToStaticMarkup(
      <AgentRequestUserInputPanel
        questions={[{
          id: "scope",
          header: "范围",
          question: "研究什么范围？",
          isOther: false,
          isSecret: false,
          options: [],
        }]}
        submitting={false}
        onSubmit={() => undefined}
      />,
    );

    expect(html).toContain("<textarea");
    expect(html).toContain("填写你的答案");
    expect(html).not.toContain(">其他<");
  });

  it("masks secret request_user_input answers", () => {
    const html = renderToStaticMarkup(
      <AgentRequestUserInputPanel
        questions={[{
          id: "credential",
          header: "凭证",
          question: "请输入凭证",
          isOther: true,
          isSecret: true,
          options: [],
        }]}
        submitting={false}
        onSubmit={() => undefined}
      />,
    );

    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
  });
});
