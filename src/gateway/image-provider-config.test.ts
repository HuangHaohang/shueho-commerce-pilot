import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMERCE_IMAGE_QUALITIES,
  parseImageModel,
  parseImageQuality,
} from "./config.js";

test("accepts the provider image variants and every application-owned quality", () => {
  for (const model of [
    "gpt-image-2",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
  ]) {
    assert.equal(parseImageModel(model), model);
  }
  for (const quality of COMMERCE_IMAGE_QUALITIES) {
    assert.equal(parseImageQuality(quality), quality);
  }
  assert.equal(parseImageModel(undefined), "gpt-image-2");
  assert.equal(parseImageQuality(undefined), "auto");
});

test("rejects path-like models and unsupported qualities before App Server starts", () => {
  for (const model of ["", "../gpt-image-2", "gpt image", "x".repeat(129)]) {
    if (model === "") assert.equal(parseImageModel(model), "gpt-image-2");
    else assert.throws(() => parseImageModel(model), /valid provider model id/);
  }
  for (const quality of ["ultra", "XHIGH", "high "]) {
    if (quality === "high ") assert.equal(parseImageQuality(quality), "high");
    else assert.throws(() => parseImageQuality(quality), /low, medium, high/);
  }
});
