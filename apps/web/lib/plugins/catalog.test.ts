import { describe, expect, it } from "vitest";

import {
  buildCommercePluginInventory,
  commercePluginManifestSchema,
  filterCommercePlugins,
} from "./catalog";

const healthySignals = {
  gatewayReady: true,
  providerConfigured: true,
  imageModel: "gpt-image-2",
  managedMcp: {
    state: "ready" as const,
    available: true,
    tools: ["search"],
    error: null,
  },
};

describe("commerce plugin catalog", () => {
  it("publishes valid manifests for the real application-managed capabilities", () => {
    const plugins = buildCommercePluginInventory(healthySignals);

    expect(plugins).toHaveLength(2);
    expect(plugins.every((plugin) => commercePluginManifestSchema.safeParse(plugin.manifest).success)).toBe(true);
    expect(plugins.map((plugin) => plugin.manifest.name)).toEqual([
      "commerce-web-search",
      "commerce-image-generation",
    ]);
  });

  it("derives enablement from runtime evidence instead of manifest defaults", () => {
    const plugins = buildCommercePluginInventory({
      ...healthySignals,
      managedMcp: { state: "failed", available: false, tools: [], error: "MCP failed" },
    });

    expect(plugins[0]).toMatchObject({ enabled: false, health: "unavailable", statusLabel: "MCP failed" });
    expect(plugins[1]).toMatchObject({ enabled: true, health: "ready" });
  });

  it("filters the managed directory by display metadata and registered tool names", () => {
    const plugins = buildCommercePluginInventory(healthySignals);

    expect(filterCommercePlugins(plugins, "公开网络").map((plugin) => plugin.manifest.name)).toEqual([
      "commerce-web-search",
    ]);
    expect(filterCommercePlugins(plugins, "commerce_image.generate").map((plugin) => plugin.manifest.name)).toEqual([
      "commerce-image-generation",
    ]);
    expect(filterCommercePlugins(plugins, "  ")).toHaveLength(2);
  });

  it("rejects manifests that request an invalid package name", () => {
    expect(
      commercePluginManifestSchema.safeParse({
        name: "../unsafe",
        version: "1.0.0",
        description: "unsafe",
        interface: {
          displayName: "Unsafe",
          shortDescription: "Unsafe",
          category: "自动化",
          capabilities: [],
          icon: "search",
          coverImage: "/plugins/unsafe.png",
        },
        components: { skills: [], mcpServers: [], tools: [], ui: false },
        security: { network: "none", dataAccess: "none", writeEffects: false },
      }).success,
    ).toBe(false);
  });
});
