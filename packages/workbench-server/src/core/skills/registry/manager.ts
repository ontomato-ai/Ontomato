import path from "node:path";
import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { domainSkillsRoot, publicSkillsRoot } from "../../../content/layout";
import { SkillScanner } from "../discovery/scanner";
import { readSkillPackage } from "../package";
import type { SkillEntry, SkillMeta } from "../types";


export function skillSourceLabel(source: SkillEntry["source"]): string {
  if (source.kind === "public") return `public skill ${source.path}`;
  if (source.kind === "domain") return `domain skill ${source.path}`;
  return "generated platform skill";
}

export class SkillRegistryManager {
  private skills: SkillEntry[] = [];
  private names = new Set<string>();
  readonly failedManifests = new Map<string, never>();
  constructor(private readonly root: string, private readonly publicScanner: SkillScanner, private readonly domainId: string) {}

  private fileEntry(meta: SkillMeta, source: { kind: "public" | "domain"; path: string }): SkillEntry {
    const skill: RuntimeSkillRef = source.kind === "public"
      ? { namespace: { kind: "provider", provider: "workbench" }, name: meta.id }
      : { namespace: { kind: "domain", domainId: this.domainId }, name: meta.id };
    return { skill, manifest: meta.manifest, source, provide: () => readSkillPackage(source.path, skill) };
  }

  async initialize(additionalEntries: readonly SkillEntry[] = []) {
    const entries = [
      ...additionalEntries,
      ...(await this.publicScanner.scan()).map((meta) => this.fileEntry(meta, { kind: "public", path: meta.path })),
      ...(await new SkillScanner(this.root).scan()).map((meta) => this.fileEntry(meta, { kind: "domain", path: meta.path })),
    ];
    this.names = new Set(entries.map(entry => entry.skill.name));
    const keys = new Set<string>();
    this.skills = entries.filter(entry => {
      const key = runtimeSkillKey(entry.skill);
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
  }

  getSkills() { return this.skills; }
  hasRegisteredName(id: string) { return this.names.has(id); }
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
  async registeredDomainSkillIds(domainId: string, ids: readonly string[]): Promise<string[]> {
    const requested = new Set(ids);
    return (await new SkillScanner(this.getDomainSkillsRoot(domainId)).scan())
      .map(skill => skill.id).filter(id => requested.has(id));
  }
  async publicSkills() { return this.publicScanner.scan(); }
  async forDomain(domainId: string, additionalEntries: readonly SkillEntry[] = []) {
    const registry = new SkillRegistryManager(this.getDomainSkillsRoot(domainId), this.publicScanner, domainId);
    await registry.initialize(additionalEntries);
    return registry;
  }
}
export const skillRegistryManager = new DomainSkillRegistryManager();
