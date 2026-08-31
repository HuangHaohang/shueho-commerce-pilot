import { agentWorkflowValues } from "@/lib/agent/task-category";

export const creativeMethodValues = [
  "listing_copy",
  "promotion_copy",
  "main_image",
  "gallery_images",
  "detail_page",
  "shooting_script",
  "video_storyboard",
] as const;

export type CreativeMethod = (typeof creativeMethodValues)[number];

export const creativeMethodSkillNames = {
  listing_copy: "commerce-listing-copy",
  promotion_copy: "commerce-promotion-copy",
  main_image: "commerce-product-main-image",
  gallery_images: "commerce-product-gallery",
  detail_page: "commerce-product-detail-page",
  shooting_script: "commerce-product-shooting-script",
  video_storyboard: "commerce-short-video-storyboard",
} as const satisfies Record<CreativeMethod, `commerce-${string}`>;

const appOwnedManagedSkillNames = new Set<string>([
  ...agentWorkflowValues,
  ...Object.values(creativeMethodSkillNames),
]);

export function isAppOwnedManagedSkillName(value: unknown): value is string {
  return typeof value === "string" && appOwnedManagedSkillNames.has(value);
}

export const creativeMethodOptions = [
  {
    value: "listing_copy",
    label: "商品标题与文案",
    shortDescription: "生成标题、卖点和商品页文案",
    skillName: creativeMethodSkillNames.listing_copy,
  },
  {
    value: "promotion_copy",
    label: "推广文案",
    shortDescription: "生成广告、活动与社媒推广内容",
    skillName: creativeMethodSkillNames.promotion_copy,
  },
  {
    value: "main_image",
    label: "商品主图",
    shortDescription: "规划并生成聚焦商品主体的主图",
    skillName: creativeMethodSkillNames.main_image,
  },
  {
    value: "gallery_images",
    label: "副图与场景图",
    shortDescription: "生成卖点、场景与规格图片组",
    skillName: creativeMethodSkillNames.gallery_images,
  },
  {
    value: "detail_page",
    label: "商品详情页",
    shortDescription: "生成详情页结构、图位与销售文案",
    skillName: creativeMethodSkillNames.detail_page,
  },
  {
    value: "shooting_script",
    label: "产品拍摄脚本",
    shortDescription: "生成镜头、动作、台词与拍摄说明",
    skillName: creativeMethodSkillNames.shooting_script,
  },
  {
    value: "video_storyboard",
    label: "短视频分镜",
    shortDescription: "生成短视频脚本、分镜与字幕规划",
    skillName: creativeMethodSkillNames.video_storyboard,
  },
] as const satisfies ReadonlyArray<{
  value: CreativeMethod;
  label: string;
  shortDescription: string;
  skillName: (typeof creativeMethodSkillNames)[CreativeMethod];
}>;

export function isCreativeMethod(value: unknown): value is CreativeMethod {
  return typeof value === "string" && creativeMethodValues.includes(value as CreativeMethod);
}

export function creativeMethodLabel(method: CreativeMethod): string {
  return creativeMethodOptions.find((option) => option.value === method)?.label ?? method;
}

export function creativeMethodSkillName(
  method: CreativeMethod,
): (typeof creativeMethodSkillNames)[CreativeMethod] {
  return creativeMethodSkillNames[method];
}
