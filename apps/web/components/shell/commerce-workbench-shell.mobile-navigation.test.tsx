import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  MobileTopbar,
  Sidebar,
  moreNavItems,
  primaryNavItems,
  runSidebarNavigation,
  type SidebarProps,
} from "./commerce-workbench-shell";

function sidebarProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    user: null,
    activeView: "plugins",
    canOpenEnterpriseAdmin: false,
    threads: [],
    activeThreadId: null,
    navigationLocked: false,
    deletingThreadIds: new Set(),
    selectionMode: false,
    selectedThreadIds: new Set(),
    onNewTask: vi.fn(),
    onOpenThread: vi.fn(),
    onToggleSelectionMode: vi.fn(),
    onToggleThreadSelection: vi.fn(),
    onRequestThreadDeletion: vi.fn(),
    onOpenProductInsights: vi.fn(),
    onOpenCreative: vi.fn(),
    onOpenPlugins: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenAuth: vi.fn(),
    onLogout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("mobile workbench navigation", () => {
  it("uses a real Sheet trigger instead of a behaviorless menu icon", () => {
    const html = renderToStaticMarkup(
      <MobileTopbar
        user={null}
        onOpenAuth={vi.fn()}
        onLogout={vi.fn().mockResolvedValue(undefined)}
        renderNavigation={() => <div>移动导航内容</div>}
      />,
    );

    expect(html).toContain('aria-label="打开导航"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('data-state="closed"');
  });

  it("reuses the Sidebar navigation model in a visible mobile variant", () => {
    const html = renderToStaticMarkup(<Sidebar {...sidebarProps()} mobile />);

    expect(html).toContain('data-sidebar-variant="mobile"');
    expect(html).toContain("新任务");
    expect(html).toContain("商品决策");
    expect(html).toContain("创作空间");
    expect(html).toContain("资料库");
    expect(html).toContain("更多");
    expect(html).toContain('aria-label="资料库：资料库功能尚未接入"');
    expect(html).toContain("资料库功能尚未接入");
    expect(html).not.toContain('aria-label="搜索"');
    expect(html).not.toContain('aria-label="收起侧栏"');
  });

  it("keeps unavailable navigation entries disabled from the shared data source", () => {
    expect(primaryNavItems.find((item) => item.label === "资料库")?.disabledReason).toBe("资料库功能尚未接入");
    expect(moreNavItems.find((item) => item.label === "已安排")?.disabledReason).toBe("已安排功能尚未接入");
  });

  it("runs the selected navigation action before closing the Sheet", () => {
    const order: string[] = [];

    runSidebarNavigation(
      () => order.push("creative"),
      () => order.push("close"),
    );

    expect(order).toEqual(["creative", "close"]);
  });
});
