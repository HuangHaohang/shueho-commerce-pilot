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
  if (input.category) return input.category;

  const title = input.title.toLowerCase();
  if (/(文案|脚本|图片|视频|主图|种草|上新|创作)/i.test(title)) return "creative";
  if (/(调研|竞品|趋势|市场|洞察|研究)/i.test(title)) return "research";
  if (/(订单|库存|退款|发货|履约|店铺运营|商品上下架)/i.test(title)) return "operations";
  if (/(客服|售后|投诉|评价|工单|纠纷)/i.test(title)) return "support";
  if (/(报表|日报|周报|复盘|销售数据|广告数据|经营分析)/i.test(title)) return "analytics";
  return "general";
}
