import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import type { SkillInfo, SkillDeleteResult } from "@ontomato/contracts/skills";
import type { StandardSkillFrontmatter, RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { skillRegistryManager, type SkillRegistryManager } from "../../core/skills/registry/manager";
import type { SkillMeta } from "../../core/skills/types";
import { loadSkillContent, resolveSkillPackageFile } from "../../core/skills/discovery/loader";
import { readSkillPackage } from "../../core/skills/package";
import { InvalidSkillPackageError, normalizeSkillPackagePath, parseSkillMarkdown, readSkillMarkdown, readSkillLabels,
  SkillIdSchema, writeSkillMarkdown } from "../../core/skills/manifest";
import { publicSkillLabelsPath } from "../../content/layout";
import { createLogger } from "../../logging/logger";
import { HttpError } from "../../utils/errors";
import { withDomainSkills } from "./operations";
import { listAnalysisAgentSkillReferences, removeAnalysisAgentSkillReferences,
  restoreAnalysisAgentSkillReferences } from "../assistant/skill-references";

const logger = createLogger("skill-manager");
type SkillOptions = {
  title?: string; description?: string; tags?: string[]; version?: string;
  outputType?: "html" | "json" | "text"; scriptCode?: string; skillContent?: string;
};

export function skillReference(skill: SkillMeta, domainId: string): RuntimeSkillRef {
  return { name: skill.id, namespace: skill.isPublic
    ? { kind: "provider", provider: "workbench" } : { kind: "domain", domainId } };
}
function requireWritable(skill: SkillMeta) {
  if (skill.isPublic) throw new HttpError(403, "Public skills are read-only", "PUBLIC_SKILL_READ_ONLY");
}
function requireSkill(registry: SkillRegistryManager, id: string) {
  const skill = registry.getSkillById(id);
  if (!skill) throw new HttpError(404, `Skill not found: ${id}`, "SKILL_NOT_FOUND");
  return skill;
}
function metadata(options: SkillOptions, previous: Record<string, string> = {}) {
  const next = { ...previous };
  for (const key of ["title", "version", "outputType"] as const)
    if (options[key] !== undefined) next[`ontomato.${key}`] = options[key];
  if (options.tags !== undefined) next["ontomato.tags"] = JSON.stringify(options.tags);
  return next;
}
function newScript() {
  return `import { readFile, mkdir, writeFile } from "node:fs/promises";

const input = JSON.parse(await readFile(process.argv[2], "utf8"));
await mkdir("outputs", { recursive: true });
await writeFile("outputs/result.json", JSON.stringify(input, null, 2));
console.log("outputs/result.json");
`;
}

class SkillManager {
  private info(skill: SkillMeta, registry: SkillRegistryManager, domainId: string, locale?: string): SkillInfo {
    const labelPath = publicSkillLabelsPath();
    const labels = skill.isPublic && locale?.toLowerCase().startsWith("zh") && labelPath
      ? readSkillLabels(labelPath)[skill.id] : undefined;
    const m = skill.manifest;
    return { id: skill.id, skill: skillReference(skill, domainId), type: m.type, category: m.category,
      title: labels?.title ?? m.title, description: labels?.description ?? m.description,
      tags: labels?.tags ?? m.tags, enabled: registry.isSkillEnabled(skill.id), isPublic: skill.isPublic,
      path: skill.path, version: m.version, outputType: m.outputType };
  }
  async getAllSkills(domainId: string, locale?: string): Promise<SkillInfo[]> {
    const registry = await skillRegistryManager.forDomain(domainId);
    return registry.getSkills({ includeDisabled: true }).map((s) => this.info(s, registry, domainId, locale));
  }
  async searchSkills(domainId: string, query: string, locale?: string) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return (await this.getAllSkills(domainId, locale)).filter((s) =>
      [s.id, s.title, s.description, ...s.tags].some((v) => v?.toLowerCase().includes(needle)));
  }
  async toggleSkill(domainId: string, id: string) {
    return withDomainSkills(domainId, async () => {
      const registry = await skillRegistryManager.forDomain(domainId);
      requireSkill(registry, id);
      const enabled = !registry.isSkillEnabled(id);
      registry.setSkillEnabled(id, enabled);
      return { enabled };
    });
  }
  async getSkillReferences(domainId: string, id: string) {
    const skill = requireSkill(await skillRegistryManager.forDomain(domainId), id);
    return listAnalysisAgentSkillReferences(domainId, skillReference(skill, domainId));
  }
  async deleteSkill(domainId: string, id: string): Promise<SkillDeleteResult> {
    return withDomainSkills(domainId, async () => {
      const registry = await skillRegistryManager.forDomain(domainId);
      const skill = requireSkill(registry, id);
      requireWritable(skill);
      const affectedAgents = await listAnalysisAgentSkillReferences(domainId, skillReference(skill, domainId));
      const enabled = registry.isSkillEnabled(id);
      const trash = path.join(skillRegistryManager.getDomainSkillsRoot(domainId), ".trash", randomUUID());
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      fs.renameSync(skill.path, trash);
      let referencesRemoved = false;
      try {
        const cleanedAgentCount = await removeAnalysisAgentSkillReferences(domainId, id);
        referencesRemoved = true;
        registry.removeSkillState(id);
        fs.rmSync(trash, { recursive: true, force: true });
        return { affectedAgents, cleanedAgentCount };
      } catch (error) {
        if (fs.existsSync(trash)) fs.renameSync(trash, skill.path);
        registry.setSkillEnabled(id, enabled);
        if (referencesRemoved) await restoreAnalysisAgentSkillReferences(domainId, id, affectedAgents);
        throw error;
      }
    });
  }

  /** Prepare a complete replacement before changing the editable source directory. */
  private async replace(domainId: string, id: string, previous: SkillMeta | null,
    prepare: (directory: string) => void | Promise<void>): Promise<SkillInfo> {
    const root = skillRegistryManager.getDomainSkillsRoot(domainId);
    const stageRoot = path.join(root, ".staging");
    fs.mkdirSync(stageRoot, { recursive: true });
    const stage = fs.mkdtempSync(path.join(stageRoot, "package-"));
    const directory = path.join(stage, id);
    const destination = previous?.path ?? path.join(root, id);
    const backup = path.join(stage, "previous");
    try {
      if (previous) fs.cpSync(previous.path, directory, { recursive: true, filter: () => true });
      else fs.mkdirSync(directory);
      await prepare(directory);
      await readSkillPackage(directory, { namespace: { kind: "domain", domainId }, name: id });
      if (previous) fs.renameSync(destination, backup);
      try { fs.renameSync(directory, destination); }
      catch (error) {
        if (previous) fs.renameSync(backup, destination);
        throw error;
      }
      try {
        const registry = await skillRegistryManager.forDomain(domainId);
        return this.info(requireSkill(registry, id), registry, domainId);
      } catch (error) {
        fs.rmSync(destination, { recursive: true, force: true });
        if (previous) fs.renameSync(backup, destination);
        throw error;
      }
    } finally {
      try { fs.rmSync(stage, { recursive: true, force: true }); }
      catch (error) { logger.warn("Skill staging cleanup failed", error); }
    }
  }

  async createSkill(domainId: string, id: string, type: SkillInfo["type"], category: SkillInfo["category"], options: SkillOptions) {
    SkillIdSchema.parse(id);
    return withDomainSkills(domainId, async () => {
      const registry = await skillRegistryManager.forDomain(domainId);
      const existing = registry.getSkillById(id);
      if (existing) {
        requireWritable(existing);
        throw new HttpError(409, `Skill already exists: ${id}`, "SKILL_EXISTS", { skillId: id });
      }
      return this.replace(domainId, id, null, (directory) => {
        const frontmatter: StandardSkillFrontmatter = { name: id, description: options.description!,
          metadata: { ...metadata(options), "ontomato.type": type, "ontomato.category": category } };
        if (type === "executable") {
          fs.mkdirSync(path.join(directory, "scripts"));
          fs.writeFileSync(path.join(directory, "scripts/index.mjs"), options.scriptCode || newScript());
        }
        const instructions = type === "executable"
          ? `Write the task input to a JSON file, then run:\n\n\`node skills/${id}/scripts/index.mjs work/input.json\`\n\nRead the output and reference produced files using workspace-relative outputs/ paths.\n`
          : "Describe the method and when to apply it here.\n";
        writeSkillMarkdown(path.join(directory, "SKILL.md"), frontmatter,
          options.skillContent || `# ${options.title || id}\n\n${instructions}`);
      });
    });
  }
  async updateSkill(domainId: string, id: string, options: SkillOptions) {
    return withDomainSkills(domainId, async () => {
      const registry = await skillRegistryManager.forDomain(domainId);
      const skill = requireSkill(registry, id);
      requireWritable(skill);
      return this.replace(domainId, id, skill, (directory) => {
        const file = path.join(directory, "SKILL.md");
        const current = readSkillMarkdown(file)!;
        const frontmatter = { ...current.frontmatter,
          description: options.description ?? current.frontmatter.description,
          metadata: metadata(options, current.frontmatter.metadata) };
        if (options.scriptCode !== undefined && current.manifest.scriptPath)
          fs.writeFileSync(path.join(directory, current.manifest.scriptPath), options.scriptCode);
        writeSkillMarkdown(file, frontmatter, options.skillContent ?? current.content);
      });
    });
  }
  async getSkillScript(domainId: string, id: string): Promise<string | null> {
    const skill = requireSkill(await skillRegistryManager.forDomain(domainId), id);
    return skill.manifest.scriptPath
      ? fs.readFileSync(await resolveSkillPackageFile(skill, skill.manifest.scriptPath), "utf8") : null;
  }
  async getSkillContent(domainId: string, id: string, _locale?: string) {
    return loadSkillContent(requireSkill(await skillRegistryManager.forDomain(domainId), id));
  }
  async exportSkill(domainId: string, id: string): Promise<Buffer> {
    const skill = requireSkill(await skillRegistryManager.forDomain(domainId), id);
    const zip = new AdmZip();
    zip.addLocalFolder(skill.path);
    return zip.toBuffer();
  }
  async importSkill(domainId: string, bytes: Buffer, overwrite = false) {
    return withDomainSkills(domainId, async () => {
      let zip: AdmZip;
      try { zip = new AdmZip(bytes); }
      catch { throw new InvalidSkillPackageError("Cannot read skill ZIP"); }
      const allEntries = zip.getEntries();
      for (const entry of allEntries) {
        if (!normalizeSkillPackagePath(entry.entryName.replace(/\/$/, "")) ||
            ((entry.attr >>> 16) & 0o170000) === 0o120000)
          throw new InvalidSkillPackageError(`Invalid skill ZIP path: ${entry.entryName}`);
      }
      const entries = allEntries.filter((entry) => !entry.isDirectory);
      const roots = entries.filter((entry) => /^(?:[^/]+\/)?SKILL\.md$/.test(entry.entryName));
      if (roots.length !== 1) throw new InvalidSkillPackageError("ZIP must contain one standard skill package");
      const prefix = roots[0]!.entryName.slice(0, -"SKILL.md".length);
      const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      let parsed;
      try { parsed = parseSkillMarkdown(decoder.decode(roots[0]!.getData())); }
      catch (error) { throw new InvalidSkillPackageError(`Invalid SKILL.md: ${String(error)}`); }
      if (!parsed) throw new InvalidSkillPackageError("Standard SKILL.md frontmatter is required");
      const id = parsed.frontmatter.name;
      const registry = await skillRegistryManager.forDomain(domainId);
      const existing = registry.getSkillById(id);
      if (existing) {
        requireWritable(existing);
        if (!overwrite) throw new HttpError(409, `Skill already exists: ${id}`, "SKILL_EXISTS", { skillId: id });
      }
      return this.replace(domainId, id, existing, (directory) => {
        // Overwrite replaces the whole package, including removed resources.
        fs.rmSync(directory, { recursive: true });
        fs.mkdirSync(directory);
        const paths = new Set<string>();
        for (const entry of entries) {
          if (!entry.entryName.startsWith(prefix)) throw new InvalidSkillPackageError("Files outside the skill directory");
          const relative = normalizeSkillPackagePath(entry.entryName.slice(prefix.length));
          if (!relative || paths.has(relative) || ((entry.attr >>> 16) & 0o170000) === 0o120000)
            throw new InvalidSkillPackageError(`Invalid or repeated skill file: ${entry.entryName}`);
          paths.add(relative);
          const file = path.join(directory, relative);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, entry.getData());
        }
      });
    });
  }
}
export const skillManager = new SkillManager();
