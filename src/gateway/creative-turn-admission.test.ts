import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCreativeProductContext,
  validateCreativeReferenceMedia,
} from "./creative-turn-admission.js";

test("commercial campaign, image, and QA methods require an explicit Product revision", () => {
  for (const method of ["campaign_pack", "main_image", "gallery_images", "creative_qa"] as const) {
    assert.equal(validateCreativeProductContext(method, "auto")?.code, "CREATIVE_PRODUCT_REQUIRED");
    assert.equal(validateCreativeProductContext(method, "selected"), null);
  }
  assert.equal(validateCreativeProductContext("listing_copy", "auto"), null);
});

test("main and gallery generation require a real image artifact rather than a document", () => {
  assert.equal(
    validateCreativeReferenceMedia("main_image", ["document"])?.code,
    "CREATIVE_REFERENCE_IMAGE_REQUIRED",
  );
  assert.equal(
    validateCreativeReferenceMedia("gallery_images", [])?.code,
    "CREATIVE_REFERENCE_IMAGE_REQUIRED",
  );
  assert.equal(validateCreativeReferenceMedia("main_image", ["image"]), null);
  assert.equal(validateCreativeReferenceMedia("campaign_pack", ["document"]), null);
});
