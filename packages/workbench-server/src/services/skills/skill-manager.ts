import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import type { SkillInfo, SkillDeleteResult, SkillFile } from "@ontomato/contracts/skills";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { skillRegistryManager, type SkillRegistryManager } from "../../core/skills/registry/manager";
import type { SkillMeta } from "../../core/skills/types";
import { resolveSkillPackageFile } from "../../core/skills/discovery/loader";
import { readSkillPackage } from "../../core/skills/package";
import { InvalidSkillPackageError, normalizeSkillPackagePath, parseSkillMarkdown, readSkillLabels } from "../../core/skills/manifest";
import { publicSkillLabelsPath, publicSkillTranslationsRoot, publicSkillsRoot } from "../../content/layout";
import { resolveLocale } from "../../i18n";
import { createLogger } from "../../logging/logger";
import { HttpError } from "../../utils/errors";
import { withDomainSkills } from "./operations";
import { listAnalysisAgentSkillReferences, removeAnalysisAgentSkillReferences,
  restoreAnalysisAgentSkillReferences } from "../assistant/skill-references";

const logger = createLogger("skill-manager");
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
class SkillManager {
  private info(skill: SkillMeta, domainId: string, locale?: string): SkillInfo {
    const labelPath = publicSkillLabelsPath();
    const labels = skill.isPublic && labelPath && resolveLocale(locale).toLowerCase().startsWith("zh")
      ? readSkillLabels(labelPath)[skill.id] : undefined;
    return { id: skill.id, skill: skillReference(skill, domainId), isPublic: skill.isPublic, path: skill.path,
      title: labels?.title ?? skill.id, description: labels?.description ?? skill.manifest.description };
  }
  async getAllSkills(domainId: string, locale?: string): Promise<SkillInfo[]> {
    const registry = await skillRegistryManager.forDomain(domainId);
    return registry.getSkills().map((s) => this.info(s, domainId, locale));
  }
  async searchSkills(domainId: string, query: string, locale?: string) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return (await this.getAllSkills(domainId, locale)).filter((s) =>
      [s.id, s.title, s.description].some((v) => v.toLowerCase().includes(needle)));
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
      const trash = path.join(skillRegistryManager.getDomainSkillsRoot(domainId), ".trash", randomUUID());
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      fs.renameSync(skill.path, trash);
      let referencesRemoved = false;
      try {
        const cleanedAgentCount = await removeAnalysisAgentSkillReferences(domainId, id);
        referencesRemoved = true;
        fs.rmSync(trash, { recursive: true, force: true });
        return { affectedAgents, cleanedAgentCount };
      } catch (error) {
        if (fs.existsSync(trash)) fs.renameSync(trash, skill.path);
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
        return this.info(requireSkill(registry, id), domainId);
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

  /** The package's files, relative to its root, for a reader to browse. */
  async listSkillFiles(domainId: string, id: string): Promise<SkillFile[]> {
    const skill = requireSkill(await skillRegistryManager.forDomain(domainId), id);
    const entries = await fs.promises.readdir(skill.path, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return { path: path.relative(skill.path, file).split(path.sep).join("/"), size: fs.statSync(file).size };
    }).sort((a, b) => (a.path < b.path ? -1 : 1));
  }
  /**
   * One file of the package as text (packages are UTF-8 throughout). A public skill's instructions are shown in the
   * reader's language when the edition ships a translation, which is the body alone: the package's own frontmatter
   * stays over it.
   */
  async readSkillFile(domainId: string, id: string, requestedPath: string, locale?: string): Promise<string> {
    const relative = normalizeSkillPackagePath(requestedPath);
    if (!relative) throw new HttpError(400, `Invalid skill file path: ${requestedPath}`, "INVALID_SKILL_FILE_PATH");
    const skill = requireSkill(await skillRegistryManager.forDomain(domainId), id);
    const source = fs.readFileSync(await resolveSkillPackageFile(skill, relative), "utf8");
    const translations = publicSkillTranslationsRoot();
    const translated = skill.isPublic && translations
      ? path.join(translations, resolveLocale(locale), path.relative(publicSkillsRoot(), skill.path), relative) : null;
    if (!translated || !fs.existsSync(translated)) return source;
    const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
    return frontmatter + fs.readFileSync(translated, "utf8");
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
      const id = parsed.manifest.name;
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
