import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import type { AnalysisAgentSkillReference, SkillCatalog, SkillInfo, SkillDeleteResult, SkillFile } from "@ontomato/contracts/skills";
import type { StandardSkillFrontmatter } from "@ontomato/contracts/agent-runtime-skills";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { isProtectedSkillName } from "../../core/skills/providers";
import { skillRegistryManager } from "../../core/skills/registry/manager";
import { skillWriteRestriction, type SkillEntry } from "../../core/skills/types";
import { readSkillPackage } from "../../core/skills/package";
import { InvalidSkillPackageError, normalizeSkillPackagePath, parseSkillMarkdown, readSkillLabels } from "../../core/skills/manifest";
import { publicSkillLabelsPath, publicSkillTranslationsRoot, publicSkillsRoot } from "../../content/layout";
import { resolveLocale } from "../../i18n";
import { assertManagement } from "../../identity/management";
import { createLogger } from "../../logging/logger";
import { HttpError } from "../../utils/errors";
import { withDomainSkills } from "./operations";
import { readSkillView } from "./view";
import { listAnalysisAgentSkillReferences, removeAnalysisAgentSkillReferences } from "../assistant/skill-references";

const logger = createLogger("skill-manager");
interface ReferenceAccess {
  credentials: AssistantCredentials;
  readableAgentIds(ids: readonly string[]): Promise<ReadonlySet<string>>;
}

async function readableReferences(references: readonly AnalysisAgentSkillReference[], access: ReferenceAccess) {
  const readable = await access.readableAgentIds(references.map(({ id }) => id));
  return references.filter(({ id }) => readable.has(id));
}
/** The restriction is null only for a domain file, so a writable skill always has a source directory. */
function requireWritable(skill: SkillEntry) {
  const restriction = skillWriteRestriction(skill);
  if (restriction?.kind === "public") throw new HttpError(403, "Public skills are read-only", "PUBLIC_SKILL_READ_ONLY");
  if (restriction?.kind === "provider")
    throw new HttpError(403, `Skill ${skill.skill.name} is provided by ${restriction.providerName}; change it at its provider`,
      "SKILL_PROVIDER_READ_ONLY", { providerId: restriction.providerId, providerName: restriction.providerName });
  if (skill.source.kind !== "domain") throw new Error(`Skill ${skill.skill.name} has no writable file source`);
  return skill.source;
}
/** The one standard skill package in a ZIP, with its entries under `prefix`. */
function openSkillZip(bytes: Buffer) {
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
  if (isProtectedSkillName(id)) throw new InvalidSkillPackageError("This skill name is reserved");
  return { id, manifest: parsed.manifest, entries, prefix };
}
class SkillManager {
  describeSkill(skill: SkillEntry, locale?: string): SkillInfo {
    const labelPath = publicSkillLabelsPath();
    const isPublic = skill.source.kind === "public";
    const labels = isPublic && labelPath && resolveLocale(locale).toLowerCase().startsWith("zh")
      ? readSkillLabels(labelPath)[skill.skill.name] : undefined;
    return { id: skill.skill.name, skill: skill.skill, isPublic,
      path: skill.source.kind === "provider" ? undefined : skill.source.path,
      writeRestriction: skillWriteRestriction(skill),
      title: labels?.title ?? skill.skill.name, description: labels?.description ?? skill.manifest.description };
  }
  describeSkills(entries: readonly SkillEntry[], locale?: string): SkillInfo[] {
    return entries.map((entry) => this.describeSkill(entry, locale));
  }
  async getAllSkills(domainId: string, credentials: AssistantCredentials): Promise<SkillCatalog> {
    await assertManagement(workbenchManagement.skillLibraryRead, { domainId }, credentials);
    const { registry, diagnostics } = await readSkillView(domainId, credentials);
    return { skills: this.describeSkills(registry.getSkills(), credentials.locale), ...(diagnostics && { diagnostics }) };
  }
  async getSkillInfo(domainId: string, id: string, credentials: AssistantCredentials) {
    return this.describeSkill(await this.requireReadableSkill(domainId, id, credentials), credentials.locale);
  }
  async requireReadableSkill(domainId: string, id: string, credentials: AssistantCredentials) {
    await assertManagement(workbenchManagement.skillLibraryRead, { domainId }, credentials);
    const view = await readSkillView(domainId, credentials);
    return view.requireSkillById(id);
  }
  async requireSkillResource(domainId: string, id: string, credentials: AssistantCredentials) {
    const view = await readSkillView(domainId, credentials);
    const skill = view.requireSkillById(id);
    // Saved outputs still fetch public and provider resources through their source's admission rules.
    if (skill.source.kind === "domain") {
      await assertManagement(workbenchManagement.skillLibraryRead, { domainId }, credentials);
    }
    return skill;
  }
  async searchSkills(domainId: string, query: string, credentials: AssistantCredentials): Promise<SkillCatalog> {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      await assertManagement(workbenchManagement.skillLibraryRead, { domainId }, credentials);
      return { skills: [] };
    }
    const catalogue = await this.getAllSkills(domainId, credentials);
    return { ...catalogue, skills: catalogue.skills.filter(skill =>
      [skill.id, skill.title, skill.description].some(value => value.toLowerCase().includes(needle))) };
  }
  async getSkillReferences(domainId: string, id: string, access: ReferenceAccess) {
    const skill = await this.requireReadableSkill(domainId, id, access.credentials);
    const references = await listAnalysisAgentSkillReferences(domainId, skill.skill);
    return readableReferences(references, access);
  }
  private async requireSkillForChange(domainId: string, id: string, credentials: AssistantCredentials) {
    await assertManagement(workbenchManagement.skillLibraryChange, { domainId }, credentials);
    const view = await readSkillView(domainId, credentials);
    return view.requireSkillById(id);
  }
  async getDeleteSkillRestriction(domainId: string, id: string, credentials: AssistantCredentials) {
    return skillWriteRestriction(await this.requireSkillForChange(domainId, id, credentials));
  }
  async getDeleteSkillReferences(domainId: string, id: string, access: ReferenceAccess) {
    const skill = await this.requireSkillForChange(domainId, id, access.credentials);
    if (skillWriteRestriction(skill)) return null;
    const references = await listAnalysisAgentSkillReferences(domainId, skill.skill);
    return readableReferences(references, access);
  }
  async deleteSkill(domainId: string, id: string, access: ReferenceAccess): Promise<SkillDeleteResult> {
    return withDomainSkills(domainId, async () => {
      const skill = await this.requireSkillForChange(domainId, id, access.credentials);
      const source = requireWritable(skill);
      const references = await listAnalysisAgentSkillReferences(domainId, skill.skill);
      const affectedAgents = await readableReferences(references, access);
      const trash = path.join(skillRegistryManager.getDomainSkillsRoot(domainId), ".trash", randomUUID());
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      fs.renameSync(source.path, trash);
      try {
        await removeAnalysisAgentSkillReferences(domainId, id);
      } catch (error) {
        fs.renameSync(trash, source.path);
        throw error;
      }
      fs.rmSync(trash, { recursive: true, force: true });
      return { affectedAgents, cleanedAgentCount: affectedAgents.length };
    });
  }

  /** Prepare a complete replacement before changing the editable source directory. */
  private async replace(domainId: string, manifest: StandardSkillFrontmatter, previousPath: string | null,
    prepare: (directory: string) => void | Promise<void>): Promise<SkillInfo> {
    const id = manifest.name;
    const root = skillRegistryManager.getDomainSkillsRoot(domainId);
    const stageRoot = path.join(root, ".staging");
    fs.mkdirSync(stageRoot, { recursive: true });
    const stage = fs.mkdtempSync(path.join(stageRoot, "package-"));
    const directory = path.join(stage, id);
    const destination = previousPath ?? path.join(root, id);
    const backup = path.join(stage, "previous");
    try {
      if (previousPath) fs.cpSync(previousPath, directory, { recursive: true, filter: () => true });
      else fs.mkdirSync(directory);
      await prepare(directory);
      const skill = { namespace: { kind: "domain" as const, domainId }, name: id };
      await readSkillPackage(directory, skill);
      if (previousPath) fs.renameSync(destination, backup);
      try { fs.renameSync(directory, destination); }
      catch (error) {
        if (previousPath) fs.renameSync(backup, destination);
        throw error;
      }
      return this.describeSkill({ skill, manifest, source: { kind: "domain", path: destination },
        provide: () => readSkillPackage(destination, skill) });
    } finally {
      try { fs.rmSync(stage, { recursive: true, force: true }); }
      catch (error) { logger.warn("Skill staging cleanup failed", error); }
    }
  }

  /** The package's files, relative to its root, for a reader to browse. */
  async listSkillFiles(domainId: string, id: string, credentials: AssistantCredentials): Promise<SkillFile[]> {
    const skill = await this.requireReadableSkill(domainId, id, credentials);
    return (await skill.provide()).files.map((file) => ({ path: file.path, size: Buffer.byteLength(file.content, "utf8") }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  }
  /**
   * One file of the package as text (packages are UTF-8 throughout). A public skill's instructions are shown in the
   * reader's language when the edition ships a translation, which is the body alone: the package's own frontmatter
   * stays over it.
   */
  async readSkillFile(domainId: string, id: string, requestedPath: string, credentials: AssistantCredentials): Promise<string> {
    const skill = await this.requireReadableSkill(domainId, id, credentials);
    const relative = normalizeSkillPackagePath(requestedPath);
    if (!relative) throw new HttpError(400, `Invalid skill file path: ${requestedPath}`, "INVALID_SKILL_FILE_PATH");
    const source = (await skill.provide()).files.find((file) => file.path === relative)?.content;
    if (source === undefined) throw new HttpError(404, `Skill file not found: ${relative}`, "SKILL_FILE_NOT_FOUND");
    const translations = publicSkillTranslationsRoot();
    const translated = skill.source.kind === "public" && translations
      ? path.join(translations, resolveLocale(credentials.locale), path.relative(publicSkillsRoot(), skill.source.path), relative) : null;
    if (!translated || !fs.existsSync(translated)) return source;
    const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0] ?? "";
    return frontmatter + fs.readFileSync(translated, "utf8");
  }
  async exportSkill(domainId: string, id: string, credentials: AssistantCredentials): Promise<Buffer> {
    const skill = await this.requireReadableSkill(domainId, id, credentials);
    const zip = new AdmZip();
    for (const file of (await skill.provide()).files) zip.addFile(file.path, Buffer.from(file.content, "utf8"));
    return zip.toBuffer();
  }
  /** Inspect the replacement for a confirmed overwrite. */
  async inspectImport(domainId: string, bytes: Buffer, credentials: AssistantCredentials, overwrite: boolean) {
    await assertManagement(workbenchManagement.skillLibraryChange, { domainId }, credentials);
    if (!overwrite) return null;
    const { id } = openSkillZip(bytes);
    const existing = (await readSkillView(domainId, credentials)).registry.getSkillById(id);
    if (!existing) return null;
    requireWritable(existing);
    return this.describeSkill(existing, credentials.locale);
  }
  async importSkill(domainId: string, bytes: Buffer, credentials: AssistantCredentials, overwrite = false) {
    return withDomainSkills(domainId, async () => {
      await assertManagement(workbenchManagement.skillLibraryChange, { domainId }, credentials);
      const { id, manifest, entries, prefix } = openSkillZip(bytes);
      const { registry } = await readSkillView(domainId, credentials);
      const existing = registry.getSkillById(id);
      if (!existing && registry.hasRegisteredName(id))
        throw new HttpError(409, "This skill name is unavailable", "SKILL_NAME_UNAVAILABLE");
      let previousPath: string | null = null;
      if (existing) {
        previousPath = requireWritable(existing).path;
        if (!overwrite) throw new HttpError(409, `Skill already exists: ${id}`, "SKILL_EXISTS", { skillId: id });
      }
      return this.replace(domainId, manifest, previousPath, (directory) => {
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
