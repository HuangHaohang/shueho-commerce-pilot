import type { ConversationMessage, GeneratedImageItem } from "@/lib/agent/use-agent-thread";

export function imageEditSource(message: ConversationMessage, images: readonly GeneratedImageItem[]): string | null {
  if (message.role !== "user" || !/请基于本轮选中的 \d+ 张图片生成一个实际编辑后的新图片版本。/.test(message.content)) return null;
  const filename = message.content.match(/^批注原图：(.+)$/m)?.[1]
    ?? images.find((image) => message.turnId && image.turnId === message.turnId)?.sourceFilenames[0];
  return filename && images.some((image) => image.filename === filename) ? filename : null;
}

export function imageEditFamily(filename: string, images: readonly GeneratedImageItem[]): Set<string> {
  const family = new Set([filename]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const image of images) {
      if (!family.has(image.filename) && !image.sourceFilenames.some((source) => family.has(source))) continue;
      for (const name of [image.filename, ...image.sourceFilenames]) {
        if (!family.has(name)) { family.add(name); changed = true; }
      }
    }
  }
  return family;
}
