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
    icon: z.enum(["search", "image", "package"]),
    coverImage: z.string().startsWith("/plugins/"),
  }),
  components: z.object({
    skills: z.array(z.string()).default([]),
    mcpServers: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    displayNames: z.record(z.string(), z.string().min(1).max(80)).default({}),
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

export type PluginInventoryResponse = {
  plugins: CommercePluginInventoryItem[];
  policy: {
    installMode: "application-managed";
    arbitraryPackages: false;
    hostExecution: false;
    runtimeFoundation: "codex-app-server";
  };
};

export type PluginRuntimeSignals = {
  gatewayReady: boolean;
  providerConfigured: boolean;
  imageModel: string | null;
  nativeImageGeneration: boolean;
  managedMcp: {
    state: "unknown" | "loading" | "ready" | "failed";
    available: boolean;
    tools: string[];
    error: string | null;
  };
  productCatalog: {
    configured: boolean;
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
      icon: "search",
      coverImage: "/plugins/web-search-cover.png",
    },
    components: {
      mcpServers: ["commerce_web"],
      tools: ["commerce_web.search"],
      displayNames: {
        commerce_web: "网页检索服务",
        "commerce_web.search": "搜索公开网页",
      },
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
    description: "通过 Codex Harness 原生 image_gen 工具生成租户归属的图片制品。",
    interface: {
      displayName: "图片生成",
      shortDescription: "生成商品主图、场景图和电商创意素材",
      category: "创作",
      capabilities: ["生成内容", "租户制品", "无宿主文件访问"],
      icon: "image",
      coverImage: "/plugins/image-generation-cover.png",
    },
    components: {
      tools: ["image_gen"],
      displayNames: {
        image_gen: "生成电商图片",
      },
    },
    security: {
      network: "provider-only",
      dataAccess: "tenant-artifacts",
      writeEffects: false,
    },
  }),
  commercePluginManifestSchema.parse({
    name: "commerce-product-library",
    version: "1.1.0",
    description: "将企业自有产品源归一为可审计的 Product/SPU 与 Variant/SKU 主数据，并通过 Codex Harness 工具为电商任务提供有界产品上下文。",
    interface: {
      displayName: "产品库",
      shortDescription: "归一企业产品数据，并为 Agent 提供可信商品上下文",
      category: "数据",
      capabilities: ["对话式接入", "产品主数据", "来源留存", "AI 字段映射", "工作区隔离"],
      icon: "package",
      coverImage: "/plugins/product-library-cover.png",
    },
    components: {
      tools: [
        "commerce_product.list_connectors",
        "commerce_product.list_sources",
        "commerce_product.list_imports",
        "commerce_product.create_import_from_artifact",
        "commerce_product.create_source_draft",
        "commerce_product.test_source",
        "commerce_product.search_products",
        "commerce_product.get_product",
        "commerce_product.get_selected_product_context",
        "commerce_product.inspect_import",
        "commerce_product.propose_mapping",
        "commerce_product.validate_mapping",
        "commerce_product.activate_import",
        "commerce_product.import_status",
      ],
      displayNames: {
        "commerce_product.list_connectors": "查看可用接入方式",
        "commerce_product.list_sources": "查看已接入数据源",
        "commerce_product.list_imports": "查看导入批次",
        "commerce_product.create_import_from_artifact": "从会话文件创建导入",
        "commerce_product.create_source_draft": "创建数据源配置",
        "commerce_product.test_source": "测试数据源连接",
        "commerce_product.search_products": "搜索产品",
        "commerce_product.get_product": "读取产品详情",
        "commerce_product.get_selected_product_context": "读取已选产品上下文",
        "commerce_product.inspect_import": "检查导入批次",
        "commerce_product.propose_mapping": "生成字段映射建议",
        "commerce_product.validate_mapping": "验证字段映射",
        "commerce_product.activate_import": "发布导入结果",
        "commerce_product.import_status": "读取导入状态",
      },
      ui: true,
    },
    security: {
      network: "none",
      dataAccess: "commerce-records",
      writeEffects: true,
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

    if (manifest.name === "commerce-product-library") {
      const enabled = signals.gatewayReady && signals.productCatalog?.configured === true;
      return {
        manifest,
        source: "application-managed",
        installed: true,
        enabled,
        health: enabled ? "ready" : "degraded",
        statusLabel: enabled ? "运行正常 · 工作区产品主数据" : "等待产品库控制服务",
        lockedReason: "产品事实由工作区 RLS、字段来源和 Harness 工具共同约束；导入发布需要授权、幂等与读回。",
      };
    }

    const enabled =
      signals.gatewayReady &&
      signals.providerConfigured &&
      signals.nativeImageGeneration &&
      Boolean(signals.imageModel);
    return {
      manifest,
      source: "application-managed",
      installed: true,
      enabled,
      health: enabled ? "ready" : "unavailable",
      statusLabel: enabled ? `运行正常 · ${signals.imageModel}` : "图片 Provider 未配置",
      lockedReason: "由 Codex Harness 原生执行，Commerce Pilot 仅保存租户与线程归属的图片制品。",
    };
  });
}

export function filterCommercePlugins(
  plugins: CommercePluginInventoryItem[],
  query: string,
): CommercePluginInventoryItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) {
    return plugins;
  }

  return plugins.filter((plugin) => {
    const searchableText = [
      plugin.manifest.interface.displayName,
      plugin.manifest.interface.shortDescription,
      plugin.manifest.interface.category,
      ...plugin.manifest.interface.capabilities,
      ...plugin.manifest.components.skills,
      ...plugin.manifest.components.mcpServers,
      ...plugin.manifest.components.tools,
      ...Object.values(plugin.manifest.components.displayNames),
    ]
      .join(" ")
      .toLocaleLowerCase("zh-CN");

    return searchableText.includes(normalizedQuery);
  });
}

export async function getPluginInventory(): Promise<PluginInventoryResponse> {
  const response = await fetch("/api/plugins", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as PluginInventoryResponse | { error?: string } | null;
  if (!response.ok || !payload || !("plugins" in payload)) {
    throw new Error(payload && "error" in payload ? payload.error : "Plugin inventory unavailable.");
  }
  return payload;
}
