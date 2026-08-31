import type { CreativeMethod } from "../codex/managed-workflows.js";

export type CreativeTurnAdmissionFailure = {
  code: "CREATIVE_PRODUCT_REQUIRED" | "CREATIVE_REFERENCE_IMAGE_REQUIRED";
  message: string;
};

const selectedProductRequiredMethods = new Set<CreativeMethod>([
  "campaign_pack",
  "main_image",
  "gallery_images",
  "creative_qa",
]);

const referenceImageRequiredMethods = new Set<CreativeMethod>([
  "main_image",
  "gallery_images",
]);

export function validateCreativeProductContext(
  method: CreativeMethod | null,
  mode: "auto" | "selected" | "none",
): CreativeTurnAdmissionFailure | null {
  if (!method || !selectedProductRequiredMethods.has(method) || mode === "selected") return null;
  return {
    code: "CREATIVE_PRODUCT_REQUIRED",
    message: "This creative method requires an explicitly selected canonical Product revision.",
  };
}

export function validateCreativeReferenceMedia(
  method: CreativeMethod | null,
  attachmentKinds: readonly ("image" | "document")[],
): CreativeTurnAdmissionFailure | null {
  if (!method || !referenceImageRequiredMethods.has(method) || attachmentKinds.includes("image")) {
    return null;
  }
  return {
    code: "CREATIVE_REFERENCE_IMAGE_REQUIRED",
    message: "Product main and gallery image generation require a tenant-owned image attachment in this Turn.",
  };
}
