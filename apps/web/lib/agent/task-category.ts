export const taskCategoryValues = [
  "creative",
  "research",
  "operations",
  "support",
  "analytics",
  "general",
] as const;

export type TaskCategory = (typeof taskCategoryValues)[number];

export function isTaskCategory(value: unknown): value is TaskCategory {
  return typeof value === "string" && taskCategoryValues.includes(value as TaskCategory);
}

export function resolveTaskCategory(input: {
  category?: TaskCategory | null;
  recipeId?: "copywriting" | null;
  title: string;
}): TaskCategory {
  if (input.recipeId === "copywriting") return "creative";
  return inferTaskCategoryFromTitle(input.title) ?? input.category ?? "general";
}

export function inferTaskCategoryFromTitle(title: string): TaskCategory | null {
  const normalized = title.toLowerCase();
  if (/(调研|竞品|趋势|市场洞察|用户洞察|行业研究)/i.test(normalized)) return "research";
  if (/(订单|库存|退款|发货|履约|店铺运营|商品上下架|商品上架|商品下架)/i.test(normalized)) return "operations";
  if (/(客服|售后|投诉|评价回复|工单|纠纷|客户回复)/i.test(normalized)) return "support";
  if (/(报表|日报|周报|复盘|销售数据|广告数据|经营分析|数据分析)/i.test(normalized)) return "analytics";
  if (/(文案|脚本|图片生成|视频生成|主图|种草|创作|标题改写|卖点)/i.test(normalized)) return "creative";
  if (/(技能|插件|系统配置|使用说明|信息清单)/i.test(normalized)) return "general";
  return null;
}
