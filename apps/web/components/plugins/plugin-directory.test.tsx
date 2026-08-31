import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buildCommercePluginInventory } from "@/lib/plugins/catalog";
import { TooltipProvider } from "@/components/ui/tooltip";

import { MANAGED_PLUGIN_GRID_CLASS_NAME, ManagedPluginGrid, PluginDetail } from "./plugin-directory";

const plugins = buildCommercePluginInventory({
  gatewayReady: true,
  providerConfigured: true,
  imageModel: "gpt-image-2",
  nativeImageGeneration: true,
  managedMcp: {
    state: "ready",
    available: true,
    tools: ["search"],
    error: null,
  },
  productCatalog: { configured: true },
});

describe("ManagedPluginGrid", () => {
  it("renders every managed plugin through one shared responsive item grid", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ManagedPluginGrid plugins={plugins} onOpen={vi.fn()} />
      </TooltipProvider>,
    );

    expect(MANAGED_PLUGIN_GRID_CLASS_NAME).toContain("repeat(auto-fit,minmax(240px,1fr))");
    expect(html.match(/data-managed-plugin-item=/g)).toHaveLength(3);
    expect(html).toContain('data-managed-plugin-item="commerce-web-search"');
    expect(html).toContain('data-managed-plugin-item="commerce-image-generation"');
    expect(html).toContain('data-managed-plugin-item="commerce-product-library"');
    expect(html).toContain("网页搜索");
    expect(html).toContain("图片生成");
    expect(html).toContain("产品库");
  });

  it("keeps component names Chinese and technical ids as secondary code", () => {
    for (const plugin of plugins) {
      for (const componentId of [
        ...plugin.manifest.components.skills,
        ...plugin.manifest.components.mcpServers,
        ...plugin.manifest.components.tools,
      ]) {
        expect(plugin.manifest.components.displayNames[componentId]).toBeTruthy();
      }
    }

    expect(plugins[0].manifest.components.displayNames["commerce_web.search"]).toBe("搜索公开网页");
    expect(plugins[1].manifest.components.displayNames.image_gen).toBe("生成电商图片");
    expect(plugins[2].manifest.components.displayNames["commerce_product.activate_import"]).toBe("发布导入结果");

    for (const plugin of plugins) {
      const detailHtml = renderToStaticMarkup(<PluginDetail plugin={plugin} onBack={vi.fn()} />);
      expect(detailHtml).not.toMatch(/>Tool<|>MCP<|>Skill</);
      for (const componentId of [
        ...plugin.manifest.components.skills,
        ...plugin.manifest.components.mcpServers,
        ...plugin.manifest.components.tools,
      ]) {
        expect(detailHtml).toContain(plugin.manifest.components.displayNames[componentId]);
        expect(detailHtml).toContain(`<code class="mt-0.5 block break-all font-mono text-[11px] leading-4 text-[var(--cp-text-muted)]">${componentId}</code>`);
      }
    }
  });

  it("offers real conversational and workspace entry points on the product plugin detail", () => {
    const productPlugin = plugins.find((plugin) => plugin.manifest.name === "commerce-product-library");
    expect(productPlugin).toBeTruthy();
    const html = renderToStaticMarkup(
      <PluginDetail
        plugin={productPlugin!}
        onBack={vi.fn()}
        onOpenProductLibrary={vi.fn()}
        onStartProductOnboarding={vi.fn()}
      />,
    );

    expect(html).toContain("接入你的企业产品");
    expect(html).toContain("通过对话接入");
    expect(html).toContain("管理产品库");
    expect(html).toContain("让 Harness 逐步引导");
  });
});
