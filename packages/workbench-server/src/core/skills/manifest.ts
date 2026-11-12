import fs from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  runtimeSkillRefSchema,
  standardSkillFrontmatterSchema,
  type StandardSkillFrontmatter,
} from "@ontomato/contracts/agent-runtime-skills";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";

export const SkillIdSchema = runtimeSkillRefSchema.shape.name;

export class InvalidSkillPackageError extends Error {
  readonly code = "INVALID_SKILL_PACKAGE";
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "InvalidSkillPackageError";
  }
}

export function normalizeSkillPackagePath(value: string): string | null {
  const result = runtimeRelativePathSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseSkillMarkdownFrontmatter(markdown: string) {
  const sections = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!sections) {
    if (markdown.startsWith("---")) throw new InvalidSkillPackageError("Invalid SKILL.md frontmatter");
    return null;
  }
  try {
    return { frontmatter: parseYaml(sections[1]!) as unknown, content: sections[2]! };
  } catch (error) {
    throw new InvalidSkillPackageError(`Invalid SKILL.md YAML: ${String(error)}`);
  }
}

/** A package is its standard frontmatter; anything else in `metadata` is the package's own and the platform reads none of it. */
export type SkillManifest = StandardSkillFrontmatter;
export interface ParsedSkillMarkdown {
  manifest: SkillManifest;
  content: string;
}

export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown | null {
  const parsed = parseSkillMarkdownFrontmatter(markdown);
  if (!parsed) return null;
  try {
    return { manifest: standardSkillFrontmatterSchema.parse(parsed.frontmatter), content: parsed.content };
  } catch (error) {
    throw new InvalidSkillPackageError(`Invalid standard skill package: ${String(error)}`);
  }
}

export function readSkillMarkdown(skillMdPath: string): ParsedSkillMarkdown | null {
  return parseSkillMarkdown(fs.readFileSync(skillMdPath, "utf8"));
}

/** An edition's names and descriptions of the built-in skills, in its own language, keyed by skill name. */
export function readSkillLabels(file: string) {
  return z.record(SkillIdSchema, z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
  }).strict()).parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
