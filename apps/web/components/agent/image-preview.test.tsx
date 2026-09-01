import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImagePreview } from "./image-preview";

describe("ImagePreview", () => {
  it("renders an in-page preview trigger instead of a new-tab link", () => {
    const html = renderToStaticMarkup(
      <ImagePreview
        src="/api/agent/threads/thread-1/attachments/image-1"
        thumbnailAlt="商品参考图.jpg"
        previewAlt="商品参考图.jpg 预览"
        triggerLabel="预览上传图片 商品参考图.jpg"
        triggerClassName="preview-trigger"
        imageClassName="preview-image"
      />,
    );

    expect(html).toContain("<button");
    expect(html).toContain('aria-label="预览上传图片 商品参考图.jpg"');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('target="_blank"');
  });
});
