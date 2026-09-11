import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { STUDIO_SKILLS } from "./studio-skill-catalog.js";

// These are shipped application assets, never browser-selected paths or plugins.
export async function installStudioSkills(runtimeRoot: string): Promise<void> {
  const sourceRoot = resolve("runtime/skills");
  for (const directory of [runtimeRoot, join(runtimeRoot, ".agents"), join(runtimeRoot, ".agents/skills")]) {
    await privateDirectory(directory);
  }
  for (const skill of STUDIO_SKILLS) {
    const target = join(runtimeRoot, ".agents/skills", skill.name);
    for (const directory of [target, join(target, "agents"), join(target, "assets")]) {
      await privateDirectory(directory);
    }
    for (const file of ["SKILL.md", "agents/openai.yaml", "assets/preview.webp"]) {
      const source = join(sourceRoot, skill.name, file);
      if (!(await lstat(source)).isFile()) throw new Error("Bundled Skill source must be a regular file.");
      const content = await readFile(source);
      const destination = join(target, file);
      const current = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (current && !current.isFile()) throw new Error("Bundled Skill target must be a regular file.");
      if (current && (await readFile(destination)).equals(content)) continue;
      const temporary = `${destination}.${process.pid}.tmp`;
      await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
      await rename(temporary, destination);
    }
  }
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory()) throw new Error("Bundled Skill directory must not be a symbolic link.");
}
