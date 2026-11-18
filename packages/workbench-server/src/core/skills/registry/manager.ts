import fs from "node:fs";
import path from "node:path";
import {
  runtimeSkillKey,
  standardSkillFrontmatterSchema,
  type RuntimeSkillRef,
  type StandardSkillFrontmatter,
} from "@ontomato/contracts/agent-runtime-skills";
import { domainSkillsRoot, publicSkillsRoot } from "../../../content/layout";
import { SkillScanner } from "../discovery/scanner";
import { InvalidSkillPackageError } from "../manifest";
import { parseSkillPackage, readSkillPackage } from "../package";
import { registeredSkillProviders, type SkillProvider } from "../providers";
import type { SkillEntry, SkillMeta, SkillSource } from "../types";

function refLabel(ref: RuntimeSkillRef) {
  return ref.namespace.kind === "provider" ? `${ref.namespace.provider}/${ref.name}` : `${ref.namespace.domainId}/${ref.name}`;
}
function sourceLabel(source: SkillSource) {
  if (source.kind === "public") return "the public skill packages";
  if (source.kind === "domain") return "the domain skill packages";
  return `provider "${source.providerName}" (${source.providerId})`;
}

export class SkillRegistryManager {
  private skills: SkillEntry[] = [];
  constructor(private readonly root: string, private readonly publicScanner: SkillScanner,
    private readonly domainId: string, private readonly providers: readonly SkillProvider[]) {}

  private fileEntry(meta: SkillMeta, source: { kind: "public" | "domain"; path: string }): SkillEntry {
    const skill: RuntimeSkillRef = source.kind === "public"
      ? { namespace: { kind: "provider", provider: "workbench" }, name: meta.id }
      : { namespace: { kind: "domain", domainId: this.domainId }, name: meta.id };
    return { skill, manifest: meta.manifest, source, provide: () => readSkillPackage(source.path, skill) };
  }

  private async providerEntries(): Promise<SkillEntry[]> {
    const entries: SkillEntry[] = [];
    for (const provider of this.providers) {
      for (const offering of await provider.list({ domainId: this.domainId })) {
        const { skill } = offering;
        if (skill.namespace.kind === "domain" && skill.namespace.domainId !== this.domainId)
          throw new InvalidSkillPackageError(`Skill provider "${provider.name}" (${provider.id}) offered ${refLabel(skill)} `
            + `while reading domain "${this.domainId}"`);
        let manifest: StandardSkillFrontmatter;
        try { manifest = standardSkillFrontmatterSchema.parse(offering.manifest); }
        catch (error) {
          throw new InvalidSkillPackageError(`Skill provider "${provider.name}" (${provider.id}) returned an invalid `
            + `manifest for ${refLabel(skill)}: ${String(error)}`);
        }
        if (manifest.name !== skill.name)
          throw new InvalidSkillPackageError(`Skill provider "${provider.name}" (${provider.id}) returned manifest `
            + `"${manifest.name}" for ${refLabel(skill)}`);
        const key = runtimeSkillKey(skill);
        const source: SkillSource = { kind: "provider", providerId: provider.id, providerName: provider.name };
        entries.push({ skill, manifest, source, provide: async () => {
          const pkg = await offering.provide();
          if (runtimeSkillKey(pkg.skill) !== key)
            throw new InvalidSkillPackageError(`Skill provider "${provider.name}" (${provider.id}) supplied `
              + `${refLabel(pkg.skill)} for ${refLabel(skill)}`);
          return parseSkillPackage(pkg.files, pkg.skill);
        } });
      }
    }
    return entries;
  }

  async initialize() {
    const entries = [
      ...(await this.publicScanner.scan()).map((meta) => this.fileEntry(meta, { kind: "public", path: meta.path })),
      ...(await new SkillScanner(this.root).scan()).map((meta) => this.fileEntry(meta, { kind: "domain", path: meta.path })),
      ...await this.providerEntries(),
    ];
    const byName = new Map<string, SkillEntry>();
    for (const entry of entries) {
      const existing = byName.get(entry.skill.name);
      if (existing)
        throw new InvalidSkillPackageError(`Skill name "${entry.skill.name}" (${refLabel(entry.skill)}) from `
          + `${sourceLabel(entry.source)} conflicts with ${sourceLabel(existing.source)} (${refLabel(existing.skill)}); `
          + `names are unique across all manageable sources`);
      byName.set(entry.skill.name, entry);
    }
    this.skills = entries;
  }

  getSkills() {
    return this.skills;
  }
  getSkillById(id: string) { return this.skills.find((entry) => entry.skill.name === id) ?? null; }
  getSkillByRef(ref: RuntimeSkillRef) {
    const key = runtimeSkillKey(ref);
    return this.skills.find((entry) => runtimeSkillKey(entry.skill) === key) ?? null;
  }
}

export class DomainSkillRegistryManager {
  private readonly publicScanner: SkillScanner;
  constructor(skillsRoot = publicSkillsRoot(), private readonly domainsRoot = domainSkillsRoot()) {
    this.publicScanner = new SkillScanner(skillsRoot, true);
  }
  getDomainSkillsRoot(domainId: string) {
    if (!domainId.trim()) throw new Error("domainId is required");
    return path.join(this.domainsRoot, encodeURIComponent(domainId).replace(/\./g, "%2E"));
  }
  async publicSkills() { return this.publicScanner.scan(); }
  async forDomain(domainId: string) {
    const root = this.getDomainSkillsRoot(domainId);
    await fs.promises.mkdir(root, { recursive: true });
    const registry = new SkillRegistryManager(root, this.publicScanner, domainId, registeredSkillProviders());
    await registry.initialize();
    return registry;
  }
}
export const skillRegistryManager = new DomainSkillRegistryManager();
