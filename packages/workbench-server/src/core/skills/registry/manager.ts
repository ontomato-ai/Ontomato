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
import {
  isProtectedSkillName, protectedSkillRef, registeredSkillProviders,
  type ProtectedSkillOffering, type SkillOffering, type SkillPackage, type RegisteredSkillProvider,
} from "../providers";
import type { SkillEntry, SkillMeta, SkillSource } from "../types";

function refLabel(ref: RuntimeSkillRef) {
  return ref.namespace.kind === "provider" ? `${ref.namespace.provider}/${ref.name}` : `${ref.namespace.domainId}/${ref.name}`;
}
function sourceLabel(source: SkillSource) {
  if (source.kind === "public") return "the public skill packages";
  if (source.kind === "domain") return "the domain skill packages";
  return `provider "${source.providerName}" (${source.providerId})`;
}
/** Keep the provider failure and its cause, adding which source failed and at what. */
function providerFailure(provider: RegisteredSkillProvider, action: string, error: unknown, includeDetail: boolean) {
  const detail = includeDetail ? `: ${error instanceof Error ? error.message : String(error)}` : "";
  return Object.assign(new Error(`Skill provider "${provider.name}" (${provider.id}) failed to ${action}${detail}`,
    { cause: error }), { code: "SKILL_SOURCE_UNAVAILABLE", status: 502 });
}

export class SkillRegistryManager {
  private skills: SkillEntry[] = [];
  private names = new Set<string>();
  constructor(private readonly root: string, private readonly publicScanner: SkillScanner,
    private readonly domainId: string, private readonly providers: readonly RegisteredSkillProvider[]) {}

  private fileEntry(meta: SkillMeta, source: { kind: "public" | "domain"; path: string }): SkillEntry {
    const skill: RuntimeSkillRef = source.kind === "public"
      ? { namespace: { kind: "provider", provider: "workbench" }, name: meta.id }
      : { namespace: { kind: "domain", domainId: this.domainId }, name: meta.id };
    return { skill, manifest: meta.manifest, source, provide: () => readSkillPackage(source.path, skill) };
  }

  private async listProvider(provider: RegisteredSkillProvider) {
    try { return await provider.list({ domainId: this.domainId }); }
    catch (error) { throw providerFailure(provider, "list skills", error, false); }
  }

  private async providerEntry(provider: RegisteredSkillProvider, skill: RuntimeSkillRef,
    readManifest: () => StandardSkillFrontmatter | Promise<StandardSkillFrontmatter>, provide: () => Promise<SkillPackage>,
    protectedSource = false,
  ): Promise<SkillEntry> {
    let manifest: StandardSkillFrontmatter;
    try { manifest = standardSkillFrontmatterSchema.parse(await readManifest()); }
    catch (error) {
      if (protectedSource) throw providerFailure(provider, `read the manifest for ${refLabel(skill)}`, error, false);
      throw new InvalidSkillPackageError(`Skill provider "${provider.name}" (${provider.id}) returned an invalid `
        + `manifest for ${refLabel(skill)}: ${String(error)}`);
    }
    if (manifest.name !== skill.name)
      throw new InvalidSkillPackageError(`Skill provider "${provider.name}" (${provider.id}) returned a mismatched manifest `
        + `for ${refLabel(skill)}`);
    const key = runtimeSkillKey(skill);
    const source: SkillSource = { kind: "provider", providerId: provider.id, providerName: provider.name };
    return { skill, manifest, source, provide: async () => {
      let pkg: SkillPackage;
      try { pkg = await provide(); }
      catch (error) { throw providerFailure(provider, `supply ${refLabel(skill)}`, error, !protectedSource); }
      if (runtimeSkillKey(pkg.skill) !== key)
        throw new InvalidSkillPackageError(`Skill provider "${provider.name}" (${provider.id}) supplied `
          + `a different skill for ${refLabel(skill)}`);
      try { return parseSkillPackage(pkg.files, pkg.skill); }
      catch (error) { throw providerFailure(provider, `supply ${refLabel(skill)}`, error, !protectedSource); }
    } };
  }

  async initialize(admit?: AdmitSkills) {
    const entries = [
      ...(await this.publicScanner.scan()).map((meta) => this.fileEntry(meta, { kind: "public", path: meta.path })),
      ...(await new SkillScanner(this.root).scan()).map((meta) => this.fileEntry(meta, { kind: "domain", path: meta.path })),
    ];
    const byName = new Map<string, Pick<SkillEntry, "skill" | "source">>();
    const reserveName = (skill: RuntimeSkillRef, source: SkillSource, protectedSource: boolean) => {
      if (!protectedSource && isProtectedSkillName(skill.name))
        throw new InvalidSkillPackageError("A skill source uses a reserved name");
      const existing = byName.get(skill.name);
      if (existing)
        throw new InvalidSkillPackageError(protectedSource ? "Protected skill identities conflict"
          : `Skill name "${skill.name}" (${refLabel(skill)}) from ${sourceLabel(source)} conflicts with `
            + `${sourceLabel(existing.source)} (${refLabel(existing.skill)}); names are unique across all manageable sources`);
      byName.set(skill.name, { skill, source });
    };
    for (const { skill, source } of entries) reserveName(skill, source, false);
    const publicOfferings: { provider: RegisteredSkillProvider; offering: SkillOffering }[] = [];
    const protectedOfferings: { provider: RegisteredSkillProvider; offering: ProtectedSkillOffering; skill: RuntimeSkillRef }[] = [];
    for (const provider of this.providers) {
      const source = { kind: "provider" as const, providerId: provider.id, providerName: provider.name };
      for (const offering of await this.listProvider(provider)) {
        if ("kind" in offering) {
          const skill = protectedSkillRef(provider.id, this.domainId, offering.sourceKey);
          reserveName(skill, source, true);
          protectedOfferings.push({ provider, offering, skill });
        } else {
          const { skill } = offering;
          if (skill.namespace.kind === "domain" && skill.namespace.domainId !== this.domainId)
            throw new InvalidSkillPackageError(`Skill provider "${provider.name}" (${provider.id}) offered ${refLabel(skill)} `
              + `while reading domain "${this.domainId}"`);
          reserveName(skill, source, false);
          publicOfferings.push({ provider, offering });
        }
      }
    }
    const visibility = await admit?.(protectedOfferings.map(({ provider, offering, skill }) => ({
      providerId: provider.id, sourceKey: offering.sourceKey, skill,
      resourceIds: offering.resourceIds, entrances: offering.entrances,
    })));
    this.names = new Set(byName.keys());
    this.skills = entries.filter(entry => visibility?.public(entry.skill) ?? true);
    for (const { provider, offering } of publicOfferings) {
      if (visibility?.public(offering.skill) ?? true)
        this.skills.push(await this.providerEntry(provider, offering.skill, () => offering.manifest, offering.provide.bind(offering)));
    }
    for (const { provider, offering, skill } of protectedOfferings) {
      if (visibility?.protected(skill))
        this.skills.push(await this.providerEntry(provider, skill, () => offering.readManifest(skill), () => offering.provide(skill), true));
    }
  }

  getSkills() {
    return this.skills;
  }
  hasRegisteredName(id: string) { return this.names.has(id); }
  getSkillById(id: string) { return this.skills.find((entry) => entry.skill.name === id) ?? null; }
  getSkillByRef(ref: RuntimeSkillRef) {
    const key = runtimeSkillKey(ref);
    return this.skills.find((entry) => runtimeSkillKey(entry.skill) === key) ?? null;
  }
}

export type ListedProtectedSkill = Pick<ProtectedSkillOffering, "sourceKey" | "resourceIds" | "entrances"> & {
  providerId: string;
  skill: RuntimeSkillRef;
};
type AdmitSkills = (sources: readonly ListedProtectedSkill[]) => Promise<{
  public(skill: RuntimeSkillRef): boolean;
  protected(skill: RuntimeSkillRef): boolean;
}>;

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
  async forDomain(domainId: string, admit?: AdmitSkills) {
    const root = this.getDomainSkillsRoot(domainId);
    await fs.promises.mkdir(root, { recursive: true });
    const registry = new SkillRegistryManager(root, this.publicScanner, domainId, registeredSkillProviders());
    await registry.initialize(admit);
    return registry;
  }
}
export const skillRegistryManager = new DomainSkillRegistryManager();
