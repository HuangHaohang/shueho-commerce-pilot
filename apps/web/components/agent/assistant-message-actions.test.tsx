import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { AssistantMessageActions } from "./assistant-message-actions";

describe("assistant message actions", () => {
  it("renders an accessible Harness retry action beside feedback controls", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AssistantMessageActions
          messageId="agent-message-1"
          copyText="回复"
          feedback={null}
          feedbackSubmitting={false}
          retrying={false}
          retryDisabled={false}
          onFeedback={vi.fn().mockResolvedValue(true)}
          onRetry={vi.fn().mockResolvedValue(true)}
        />
      </TooltipProvider>,
    );

    expect(html).toContain('aria-label="重新尝试"');
    expect(html).not.toContain('aria-label="重新尝试" disabled=""');
  });

  it("disables the action and exposes progress while Harness is reverting the Turn", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AssistantMessageActions
          messageId="agent-message-1"
          copyText="回复"
          feedback={null}
          feedbackSubmitting={false}
          retrying
          retryDisabled
          onFeedback={vi.fn().mockResolvedValue(true)}
          onRetry={vi.fn().mockResolvedValue(true)}
        />
      </TooltipProvider>,
    );

    expect(html).toContain('aria-label="正在重新尝试"');
    expect(html).toContain("animate-spin");
    expect(html).toContain("disabled");
  });
});
