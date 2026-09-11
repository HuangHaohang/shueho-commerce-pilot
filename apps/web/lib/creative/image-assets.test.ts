import { describe, expect, it } from "vitest";
import { imageAssetRoot, imageAssetVersions } from "./image-assets";
import type { GeneratedImageItem } from "@/lib/agent/use-agent-thread";
const image = (filename: string, sourceFilenames: string[] = []): GeneratedImageItem => ({ id: filename, filename, sourceFilenames, sequence: 0, turnId: null, url: filename, model: "fixture" });
describe("image asset identity", () => {
  it("keeps references independent and groups branched edits with their primary source", () => {
    const images = [image("1-root"), image("2-logo"), image("3-edit", ["1-root", "2-logo"]), image("4-branch", ["1-root"]), image("5-edit", ["3-edit"])];
    expect(imageAssetVersions("5-edit", images).map(x => x.filename)).toEqual(["1-root", "3-edit", "4-branch", "5-edit"]);
    expect(imageAssetRoot("2-logo", images)).toBe("2-logo");
  });
  it("an explicit independent copy starts a new identity", () => {
    const images = [image("1-root"), image("2-copy"), image("3-edit", ["2-copy"])];
    expect(imageAssetVersions("3-edit", images).map(x => x.filename)).toEqual(["2-copy", "3-edit"]);
  });
});
