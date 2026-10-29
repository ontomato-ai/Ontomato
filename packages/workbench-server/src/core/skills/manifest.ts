import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import {
  runtimeSkillRefSchema,
  standardSkillFrontmatterSchema,
  type StandardSkillFrontmatter,
} from "@ontomato/contracts/agent-runtime-skills";
import { runtimeRelativePathSchema } from "@ontomato/contracts/agent-runtime-values";

export const SkillIdSchema = runtimeSkillRefSchema.shape.name;
export const SkillTypeSchema = z.enum(["executable", "knowledge"]);
export const SkillCategorySchema = z.enum(["analysis", "visualization"]);

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

const displaySchema = z.object({
  type: SkillTypeSchema,
  category: SkillCategorySchema.default("analysis"),
  title: z.string().optional(),
  tags: z.array(z.string()).default([]),
  version: z.string().default(""),
  outputType: z.enum(["text", "html", "json"]).optional(),
  defaultEnabled: z.boolean().optional(),
});
export type SkillManifest = StandardSkillFrontmatter & z.infer<typeof displaySchema> & {
  scriptPath?: string;
};
export interface ParsedSkillMarkdown {
  frontmatter: StandardSkillFrontmatter;
  manifest: SkillManifest;
  content: string;
}

export function parseSkillMarkdown(markdown: string, scriptPath?: string): ParsedSkillMarkdown | null {
  const parsed = parseSkillMarkdownFrontmatter(markdown);
  if (!parsed) return null;
  try {
    const frontmatter = standardSkillFrontmatterSchema.parse(parsed.frontmatter);
    const m = frontmatter.metadata ?? {};
    const display = displaySchema.parse({
      type: m["ontomato.type"] ?? (scriptPath ? "executable" : "knowledge"),
      category: m["ontomato.category"],
      title: m["ontomato.title"],
      tags: m["ontomato.tags"] ? JSON.parse(m["ontomato.tags"]) : [],
      version: m["ontomato.version"],
      outputType: m["ontomato.outputType"],
      defaultEnabled: m["ontomato.defaultEnabled"] === undefined
        ? undefined : z.enum(["true", "false"]).parse(m["ontomato.defaultEnabled"]) === "true",
    });
    return { frontmatter, manifest: { ...frontmatter, ...display, scriptPath }, content: parsed.content };
  } catch (error) {
    throw new InvalidSkillPackageError(`Invalid standard skill package: ${String(error)}`);
  }
}

export function readSkillMarkdown(skillMdPath: string): ParsedSkillMarkdown | null {
  const scripts = path.join(path.dirname(skillMdPath), "scripts");
  const names: string[] = [];
  const walk = (directory: string, prefix = "") => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(directory, entry.name), prefix + entry.name + "/");
      else if (entry.isFile()) names.push(prefix + entry.name);
    }
  };
  walk(scripts);
  names.sort();
  const name = names.includes("index.mjs") ? "index.mjs" : names[0];
  return parseSkillMarkdown(fs.readFileSync(skillMdPath, "utf8"), name ? `scripts/${name}` : undefined);
}

export function writeSkillMarkdown(file: string, frontmatter: StandardSkillFrontmatter, content: string) {
  const validated = standardSkillFrontmatterSchema.parse(frontmatter);
  fs.writeFileSync(file, `---\n${stringifyYaml(validated, { lineWidth: 0 }).trimEnd()}\n---\n${content}`);
}

export function readSkillLabels(file: string) {
  return z.record(SkillIdSchema, z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    tags: z.array(z.string()).optional(),
  }).strict()).parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
