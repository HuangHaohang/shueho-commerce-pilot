import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TurnFailureNotice } from "./turn-failure-notice";

describe("Turn failure notice", () => {
  it("offers continuation even when no assistant reply or persisted error text exists", () => {
    const html = renderToStaticMarkup(<TurnFailureNotice error={null} canContinue continuing={false} onContinue={vi.fn()} />);
    expect(html).toContain("继续任务");
    expect(html).toContain('role="alert"');
  });
  it("never offers continuation for a nonterminal streaming error", () => {
    const html = renderToStaticMarkup(<TurnFailureNotice error="正在核对任务状态" canContinue={false} continuing={false} onContinue={vi.fn()} />);
    expect(html).not.toContain("<button");
  });
  it("disables repeat clicks during readback", () => {
    const html = renderToStaticMarkup(<TurnFailureNotice error={null} canContinue continuing onContinue={vi.fn()} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain("正在核对任务状态");
  });
});
