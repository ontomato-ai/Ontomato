import fs from "node:fs";
import path from "node:path";
import { domainSkillsRoot, publicSkillsRoot } from "../../../content/layout";
import { SkillScanner } from "../discovery/scanner";
import { InvalidSkillPackageError } from "../manifest";
import type { SkillMeta } from "../types";

export class SkillRegistryManager {
  private skills: SkillMeta[] = [];
  constructor(private readonly root: string, private readonly publicScanner: SkillScanner) {}

  async initialize() {
    this.skills = [...await this.publicScanner.scan(), ...await new SkillScanner(this.root).scan()];
    if (new Set(this.skills.map((skill) => skill.id)).size !== this.skills.length)
      throw new InvalidSkillPackageError("A domain skill conflicts with a public skill name");
  }

  getSkills() {
    return this.skills;
  }
  getSkillById(id: string) { return this.skills.find((skill) => skill.id === id) ?? null; }
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
    const registry = new SkillRegistryManager(root, this.publicScanner);
    await registry.initialize();
    return registry;
  }
}
export const skillRegistryManager = new DomainSkillRegistryManager();
