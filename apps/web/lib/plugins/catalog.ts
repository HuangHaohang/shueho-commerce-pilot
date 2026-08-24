import { z } from "zod";

export const commercePluginManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1).max(240),
  interface: z.object({
    displayName: z.string().min(1).max(80),
    shortDescription: z.string().min(1).max(120),
    category: z.enum(["研究", "创作", "电商运营", "数据", "自动化"]),
    capabilities: z.array(z.string().min(1).max(40)).max(8),
  }),
  components: z.object({
    skills: z.array(z.string()).default([]),
    mcpServers: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    ui: z.boolean().default(false),
  }),
  security: z.object({
    network: z.enum(["none", "provider-only", "managed-service"]),
    dataAccess: z.enum(["none", "public-web", "tenant-artifacts", "commerce-records"]),
    writeEffects: z.boolean(),
  }),
});

export type CommercePluginManifest = z.infer<typeof commercePluginManifestSchema>;

export type CommercePluginInventoryItem = {
  manifest: CommercePluginManifest;
  source: "application-managed";
  installed: true;
  enabled: boolean;
  health: "ready" | "degraded" | "unavailable";
  statusLabel: string;
  lockedReason: string;
};

export type PluginRuntimeSignals = {
  gatewayReady: boolean;
  providerConfigured: boolean;
  imageModel: string | null;
  managedMcp: {
    state: "unknown" | "loading" | "ready" | "failed";
    available: boolean;
    tools: string[];
    error: string | null;
  };
};

const builtinManifests = [
  commercePluginManifestSchema.parse({
    name: "commerce-web-search",
    version: "1.0.0",
    description: "通过应用托管的 commerce_web MCP 检索公开网页并返回结构化来源。",
    interface: {
      displayName: "网页搜索",
      shortDescription: "检索公开网页并为回答提供可核验来源",
      category: "研究",
      capabilities: ["只读", "公开网络", "结构化来源"],
    },
    components: {
      mcpServers: ["commerce_web"],
      tools: ["commerce_web.search"],
    },
    security: {
      network: "provider-only",
      dataAccess: "public-web",
      writeEffects: false,
    },
  }),
  commercePluginManifestSchema.parse({
    name: "commerce-image-generation",
    version: "1.0.0",
    description: "通过应用注册的 commerce_image.generate 工具生成租户归属的图片制品。",
    interface: {
      displayName: "图片生成",
      shortDescription: "生成商品主图、场景图和电商创意素材",
      category: "创作",
      capabilities: ["生成内容", "租户制品", "无宿主文件访问"],
    },
    components: {
      tools: ["commerce_image.generate"],
    },
    security: {
      network: "provider-only",
      dataAccess: "tenant-artifacts",
      writeEffects: false,
    },
  }),
] as const;

export function buildCommercePluginInventory(
  signals: PluginRuntimeSignals,
): CommercePluginInventoryItem[] {
  return builtinManifests.map((manifest) => {
    if (manifest.name === "commerce-web-search") {
      const enabled =
        signals.gatewayReady &&
        signals.managedMcp.state === "ready" &&
        signals.managedMcp.available &&
        signals.managedMcp.tools.includes("search");
      return {
        manifest,
        source: "application-managed",
        installed: true,
        enabled,
        health: enabled ? "ready" : signals.managedMcp.state === "failed" ? "unavailable" : "degraded",
        statusLabel: enabled ? "运行正常" : signals.managedMcp.error || "等待 MCP 运行时",
        lockedReason: "由 Commerce Pilot 托管并按线程校验 MCP 工具目录。",
      };
    }

    const enabled = signals.gatewayReady && signals.providerConfigured && Boolean(signals.imageModel);
    return {
      manifest,
      source: "application-managed",
      installed: true,
      enabled,
      health: enabled ? "ready" : "unavailable",
      statusLabel: enabled ? `运行正常 · ${signals.imageModel}` : "图片 Provider 未配置",
      lockedReason: "由 Commerce Pilot 注册为应用工具，图片制品绑定租户与线程。",
    };
  });
}
