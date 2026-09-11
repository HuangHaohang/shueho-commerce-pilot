import type { GeneratedImageItem } from "@/lib/agent/use-agent-thread";

/** Only the primary edited image defines identity; extra reference images do not merge assets. */
export function imageAssetRoot(filename: string, images: readonly GeneratedImageItem[]): string {
  const byFilename = new Map(images.map((image) => [image.filename, image]));
  const seen = new Set<string>();
  let current = filename;
  while (!seen.has(current)) {
    seen.add(current);
    const parent = byFilename.get(current)?.sourceFilenames[0];
    if (!parent || !byFilename.has(parent)) return current;
    current = parent;
  }
  return [...seen].sort()[0] ?? filename;
}
export function imageAssetVersions(filename: string, images: readonly GeneratedImageItem[]): GeneratedImageItem[] {
  const root = imageAssetRoot(filename, images);
  return images.filter((image) => imageAssetRoot(image.filename, images) === root)
    .sort((a, b) => Number(a.filename.split("-")[0]) - Number(b.filename.split("-")[0]) || a.filename.localeCompare(b.filename));
}
