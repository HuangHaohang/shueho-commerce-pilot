import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import {
  CREATIVE_METHOD_DEFINITIONS,
  MANAGED_WORKFLOW_IDS,
} from "../codex/managed-workflows.js";
import {
  COMMERCE_INSIGHT_METHODS,
  getCommerceInsightMethodDefinition,
} from "../codex/commerce-analysis-skills.js";
import type { RuntimeScope } from "./agent-event-outbox.js";

const SKILL_NAME_PATTERN = /^commerce-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SKILL_NAMES = new Set([
  ...MANAGED_WORKFLOW_IDS,
  ...Object.values(CREATIVE_METHOD_DEFINITIONS).map((definition) => definition.skillName),
  ...COMMERCE_INSIGHT_METHODS.map(
    (method) => getCommerceInsightMethodDefinition(method).skillName,
  ),
  "commerce-copywriting-intake",
  "skill-creator",
  "skill-installer",
]);
const MANAGED_METADATA_FILENAME = ".commerce-skill.json";
const MAX_MANAGED_SKILLS = 100;

export type ManagedSkillDraft = {
  name: string;
  displayName: string;
  description: string;
  shortDescription: string;
  instructions: string;
};

export type PublishedManagedSkill = ManagedSkillDraft & {
  operation: "created" | "updated" | "unchanged";
  contentHash: string;
};

type ManagedSkillMetadata = {
  version: 1;
  name: string;
  tenantId: string;
  workspaceId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
};

export class ManagedSkillStore {
  private readonly skillRoot: string;
  private readonly tails = new Map<string, Promise<void>>();

  constructor(runtimeRoot: string) {
    this.skillRoot = resolve(runtimeRoot, ".agents", "skills");
  }

  async publish(input: ManagedSkillDraft, scope: RuntimeScope): Promise<PublishedManagedSkill> {
    const draft = validateManagedSkillDraft(input);
    return this.serialize(draft.name, () => this.publishWithinLock(draft, scope));
  }

  private async publishWithinLock(
    draft: ManagedSkillDraft,
    scope: RuntimeScope,
  ): Promise<PublishedManagedSkill> {
    await ensurePrivateDirectory(this.skillRoot);
    const target = resolve(this.skillRoot, draft.name);
    if (!target.startsWith(`${this.skillRoot}${sep}`)) {
      throw new Error("Managed skill target escaped the application skill root.");
    }

    const content = renderManagedSkill(draft);
    const openAiMetadata = renderOpenAiMetadata(draft);
    const contentHash = createHash("sha256").update(content).update("\0").update(openAiMetadata).digest("hex");
    const now = new Date().toISOString();
    const targetState = await readPathState(target);
    if (!targetState) {
      const entries = await readdir(this.skillRoot, { withFileTypes: true });
      const managedSkillCount = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("commerce-")).length;
      if (managedSkillCount >= MAX_MANAGED_SKILLS) {
        throw new Error("Commerce Pilot managed Skill limit has been reached.");
      }
      await this.createSkillDirectory(target, draft, scope, content, openAiMetadata, contentHash, now);
      return { ...draft, operation: "created", contentHash };
    }
    if (targetState !== "directory") {
      throw new Error("Managed skill target must be a real directory.");
    }

    const metadata = await readManagedMetadata(join(target, MANAGED_METADATA_FILENAME));
    if (!metadata) {
      throw new Error("Existing Skill is not owned by the Commerce Pilot managed publisher.");
    }
    if (
      metadata.tenantId !== scope.tenantId ||
      metadata.workspaceId !== scope.workspaceId ||
      metadata.createdByUserId !== scope.userId
    ) {
      throw new Error("Existing Skill belongs to another Commerce Pilot principal.");
    }
    if (metadata.contentHash === contentHash) {
      return { ...draft, operation: "unchanged", contentHash };
    }

    await writePrivateAtomic(join(target, "SKILL.md"), content);
    await writePrivateAtomic(join(target, "agents", "openai.yaml"), openAiMetadata);
    await writePrivateAtomic(
      join(target, MANAGED_METADATA_FILENAME),
      `${JSON.stringify({ ...metadata, updatedAt: now, contentHash } satisfies ManagedSkillMetadata)}\n`,
    );
    return { ...draft, operation: "updated", contentHash };
  }

  private async createSkillDirectory(
    target: string,
    draft: ManagedSkillDraft,
    scope: RuntimeScope,
    content: string,
    openAiMetadata: string,
    contentHash: string,
    now: string,
  ): Promise<void> {
    const staging = join(this.skillRoot, `.${draft.name}.${randomUUID()}.tmp`);
    await mkdir(join(staging, "agents"), { recursive: true, mode: 0o700 });
    try {
      await Promise.all([
        writeFile(join(staging, "SKILL.md"), content, { encoding: "utf8", mode: 0o600 }),
        writeFile(join(staging, "agents", "openai.yaml"), openAiMetadata, {
          encoding: "utf8",
          mode: 0o600,
        }),
        writeFile(
          join(staging, MANAGED_METADATA_FILENAME),
          `${JSON.stringify({
            version: 1,
            name: draft.name,
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            createdByUserId: scope.userId,
            createdAt: now,
            updatedAt: now,
            contentHash,
          } satisfies ManagedSkillMetadata)}\n`,
          { encoding: "utf8", mode: 0o600 },
        ),
      ]);
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  private async serialize<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    this.tails.set(name, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(name) === current) this.tails.delete(name);
    }
  }
}

export function validateManagedSkillDraft(value: unknown): ManagedSkillDraft {
  if (!isRecord(value)) throw new Error("Managed Skill draft must be an object.");
  const name = readBoundedText(value.name, "Skill name", 3, 64).toLowerCase();
  if (!SKILL_NAME_PATTERN.test(name) || RESERVED_SKILL_NAMES.has(name)) {
    throw new Error("Skill name must use an unreserved commerce-* slug.");
  }
  return {
    name,
    displayName: readBoundedText(value.displayName, "Skill display name", 2, 64),
    description: readBoundedText(value.description, "Skill description", 20, 500),
    shortDescription: readBoundedText(value.shortDescription, "Skill short description", 6, 160),
    instructions: readBoundedText(value.instructions, "Skill instructions", 40, 20_000),
  };
}

export function renderManagedSkill(draft: ManagedSkillDraft): string {
  return `---
name: ${draft.name}
description: ${JSON.stringify(draft.description)}
---

${draft.instructions.trim()}
`;
}

function renderOpenAiMetadata(draft: ManagedSkillDraft): string {
  return `interface:
  display_name: ${JSON.stringify(draft.displayName)}
  short_description: ${JSON.stringify(draft.shortDescription)}
policy:
  allow_implicit_invocation: true
`;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const state = await readPathState(path);
  if (state !== "directory") throw new Error("Managed Skill root must be a real directory.");
  await chmod(path, 0o700);
}

async function writePrivateAtomic(path: string, content: string): Promise<void> {
  const directory = resolve(path, "..");
  await ensurePrivateDirectory(directory);
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

async function readManagedMetadata(path: string): Promise<ManagedSkillMetadata | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(value)) return null;
    if (
      value.version !== 1 ||
      typeof value.name !== "string" ||
      typeof value.tenantId !== "string" ||
      typeof value.workspaceId !== "string" ||
      typeof value.createdByUserId !== "string" ||
      typeof value.createdAt !== "string" ||
      typeof value.updatedAt !== "string" ||
      typeof value.contentHash !== "string"
    ) {
      return null;
    }
    return value as ManagedSkillMetadata;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readPathState(path: string): Promise<"directory" | "file" | "symlink" | null> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return "symlink";
    if (stats.isDirectory()) return "directory";
    return "file";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function readBoundedText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length < min || text.length > max || text.includes("\0")) {
    throw new Error(`${label} must contain between ${min} and ${max} characters.`);
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
