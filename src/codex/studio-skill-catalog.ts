// Application-owned presentation metadata migrated from Creative Studio's active v2 catalog.
// Only attach this metadata after native skills/list confirms availability.
export type StudioSkillPresentation = {
  order: number; id: string; name: string; title: string; category: string; summary: string;
  required_assets: string; preview_url: string; version: number;
  preview_layout: "strips" | "a-plus" | "cover";
  preview_examples: Array<{ title: string; url: string; detail_url?: string; product_fraction?: number }>;
};
export const STUDIO_SKILLS: readonly StudioSkillPresentation[] = [
  {
    "order": 0,
    "id": "product-listing-v2",
    "name": "studio-product-listing-v2",
    "title": "商品主图与卖点图",
    "category": "电商",
    "summary": "用清晰的产品图讲清卖点",
    "required_assets": "产品图片、产品名称与真实卖点",
    "preview_url": "/skill-demos/product-listing.webp",
    "version": 2,
    "preview_layout": "strips",
    "preview_examples": [
      {
        "title": "银饰主图",
        "url": "/skill-demos/product-listing.webp"
      },
      {
        "title": "护肤精华",
        "url": "/skill-demos/product-listing-skincare-v2.jpg"
      }
    ]
  },
  {
    "order": 1,
    "id": "a-plus-v2",
    "name": "studio-a-plus-v2",
    "title": "商品详情与 A+ 内容",
    "category": "电商",
    "summary": "把产品信息整理成一组视觉内容",
    "required_assets": "产品图片、功能说明与展示平台",
    "preview_url": "/skill-demos/a-plus-patches-v2.jpg",
    "version": 2,
    "preview_layout": "a-plus",
    "preview_examples": [
      {
        "title": "星形贴片",
        "url": "/skill-demos/a-plus-patches-v2.jpg",
        "detail_url": "/skill-demos/a-plus-patches-detail-v2.jpg",
        "product_fraction": 0.415
      },
      {
        "title": "陶瓷咖啡器具",
        "url": "/skill-demos/a-plus-coffee-v2.jpg",
        "detail_url": "/skill-demos/a-plus-coffee-detail-v2.jpg",
        "product_fraction": 0.384
      }
    ]
  },
  {
    "order": 2,
    "id": "lifestyle-v2",
    "name": "studio-lifestyle-v2",
    "title": "产品生活场景",
    "category": "场景",
    "summary": "让产品自然融入日常生活",
    "required_assets": "产品图片、场景和使用方式",
    "preview_url": "/skill-demos/lifestyle.webp",
    "version": 2,
    "preview_layout": "cover",
    "preview_examples": [
      {
        "title": "咖啡日常",
        "url": "/skill-demos/lifestyle.webp"
      },
      {
        "title": "便携音箱",
        "url": "/skill-demos/lifestyle-speaker-v2.jpg"
      }
    ]
  },
  {
    "order": 3,
    "id": "brand-v2",
    "name": "studio-brand-v2",
    "title": "品牌产品视觉",
    "category": "品牌",
    "summary": "统一产品展示的色彩与气质",
    "required_assets": "产品图片、品牌名称与视觉偏好",
    "preview_url": "/skill-demos/brand.webp",
    "version": 2,
    "preview_layout": "cover",
    "preview_examples": [
      {
        "title": "耳机品牌",
        "url": "/skill-demos/brand.webp"
      },
      {
        "title": "皮具品牌",
        "url": "/skill-demos/brand-bags-v2.jpg"
      }
    ]
  },
  {
    "order": 4,
    "id": "creative-v2",
    "name": "studio-creative-v2",
    "title": "广告创意视觉",
    "category": "创意",
    "summary": "用鲜明的画面表达一个创意",
    "required_assets": "产品或主题、核心信息与投放用途",
    "preview_url": "/skill-demos/creative.webp",
    "version": 2,
    "preview_layout": "cover",
    "preview_examples": [
      {
        "title": "柑橘创意",
        "url": "/skill-demos/creative.webp"
      },
      {
        "title": "香氛创意",
        "url": "/skill-demos/creative-perfume-v2.jpg"
      }
    ]
  }
];

export function studioSkillPresentation(name: string): StudioSkillPresentation | undefined {
  return STUDIO_SKILLS.find((skill) => skill.name === name);
}

export function isStudioSkillName(value: unknown): value is string {
  return typeof value === "string" && STUDIO_SKILLS.some((skill) => skill.name === value);
}
