import type { ClipboardEvent } from "react";

/** Consume actual clipboard image files; ordinary text retains native paste. */
export function pasteComposerImages(
  event: ClipboardEvent<HTMLElement>,
  onAddFiles: (files: File[]) => void,
): void {
  if (event.defaultPrevented) return;
  const items = Array.from(event.clipboardData.items);
  const itemFiles = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  const images = itemFiles.length
    ? itemFiles
    : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
  if (!images.length) return;
  event.preventDefault();
  const extensions: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  };
  onAddFiles(images.map((file, index) => {
    const extension = extensions[file.type];
    if (!extension || /\.(png|jpe?g|webp)$/i.test(file.name)) return file;
    return new File([file], `粘贴图片-${index + 1}.${extension}`, { type: file.type, lastModified: file.lastModified });
  }));
}
