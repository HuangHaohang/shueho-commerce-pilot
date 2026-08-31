import type { CreativeMethod } from "./creative-method-contract";

export type CreativeMethodGroupId = "listing" | "promotion" | "video";

export type CreativeMethodPresentation = {
  group: CreativeMethodGroupId;
  starterPrompt: string;
  requirement: string;
};

export const creativeMethodGroupLabels = {
  listing: "商品上架",
  promotion: "营销推广",
  video: "短视频",
} as const satisfies Record<CreativeMethodGroupId, string>;

export const creativeMethodPresentation = {
  listing_copy: {
    group: "listing",
    starterPrompt:
      "请基于我选中的产品，生成适合目标电商平台的商品标题、核心卖点和商品页基础文案；如果平台或受众会明显影响结果，请先问我。",
    requirement: "请先通过下方“产品库”选择至少一个产品；平台不明确时，Harness 会继续询问。",
  },
  promotion_copy: {
    group: "promotion",
    starterPrompt:
      "请基于我选中的产品，生成一套面向目标人群的电商推广文案，包括核心利益点、正文和行动引导；不要编造折扣、库存或功效。",
    requirement: "请先通过下方“产品库”选择产品；如有活动规则或禁用词，可一并上传。",
  },
  main_image: {
    group: "listing",
    starterPrompt:
      "请基于我选中的产品和商品参考图，规划并生成一张适合目标电商平台的商品主图，保持商品外观、颜色和结构准确。",
    requirement: "需要通过下方“产品库”选择产品，并提供可识别商品外观的参考图。",
  },
  gallery_images: {
    group: "listing",
    starterPrompt:
      "请基于我选中的产品和商品参考图，规划并生成一组副图与场景图，分别表达核心卖点、使用场景和规格信息。",
    requirement: "需要通过下方“产品库”选择产品，并提供商品参考图；系统会先确认图片组用途。",
  },
  detail_page: {
    group: "listing",
    starterPrompt:
      "请基于我选中的产品，生成适合目标电商平台的详情页图文方案，包括页面结构、销售文案、图位说明和需要补充的素材；若已提供足够的商品参考图，同时使用原生图片生成能力制作关键详情图。",
    requirement: "请先通过下方“产品库”选择产品；没有足够参考图时只交付结构、文案和图位，不会声称已生成详情图。",
  },
  shooting_script: {
    group: "video",
    starterPrompt:
      "请基于我选中的产品，生成一份可直接执行的电商拍摄脚本，列出镜头、时长、画面动作、台词、字幕、道具和商品展示重点。",
    requirement: "请先通过下方“产品库”选择产品；目标平台和视频时长不明确时会继续询问。",
  },
  video_storyboard: {
    group: "video",
    starterPrompt:
      "请基于我选中的产品，生成一份短视频脚本与分镜，明确每个镜头的时长、画面、口播、字幕、转场和商品卖点。",
    requirement: "请先通过下方“产品库”选择产品；当前生成脚本与分镜，不会冒充已生成视频成片。",
  },
} as const satisfies Record<CreativeMethod, CreativeMethodPresentation>;

export function creativeMethodStarterPrompt(method: CreativeMethod): string {
  return creativeMethodPresentation[method].starterPrompt;
}

export function creativeMethodRequirement(method: CreativeMethod): string {
  return creativeMethodPresentation[method].requirement;
}

export function creativeMethodActiveRequirement(
  method: CreativeMethod,
  selectedProductCount: number,
): string {
  if (selectedProductCount < 1) return creativeMethodRequirement(method);
  const selected = `已选择 ${selectedProductCount} 个产品。`;
  if (method === "main_image") return `${selected} 请再提供可识别商品外观的参考图。`;
  if (method === "gallery_images") return `${selected} 请再提供商品参考图；Harness 会先确认图片组用途。`;
  if (method === "detail_page") {
    return `${selected} 没有足够参考图时只交付结构、文案和图位，不会声称已生成详情图。`;
  }
  if (method === "promotion_copy") return `${selected} 如有活动规则或禁用词，可一并上传。`;
  if (method === "shooting_script") return `${selected} 目标平台和视频时长不明确时，Harness 会继续询问。`;
  if (method === "video_storyboard") return `${selected} 当前生成脚本与分镜，不会冒充已生成视频成片。`;
  return `${selected} 平台或受众不明确时，Harness 会继续询问。`;
}
