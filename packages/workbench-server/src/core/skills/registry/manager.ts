import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runtimeDataDir, publicSkillsRoot } from "../../../content/layout";
import { SkillScanner } from "../discovery/scanner";
import { SkillStatesFile } from "../constants";
import { InvalidSkillPackageError } from "../manifest";
import type { SkillMeta, SkillQuery } from "../types";

const statesSchema = z.object({
  disabledSkills: z.array(z.string()).default([]),
  enabledSkills: z.array(z.string()).default([]),
});

export class SkillRegistryManager {
  private skills: SkillMeta[] = [];
  private disabled = new Set<string>();
  private enabled = new Set<string>();
  private readonly statePath: string;
  constructor(private readonly root: string, private readonly publicScanner: SkillScanner) {
    this.statePath = path.join(root, SkillStatesFile);
  }

  async initialize() {
    const state = fs.existsSync(this.statePath)
      ? statesSchema.parse(JSON.parse(fs.readFileSync(this.statePath, "utf8")))
      : statesSchema.parse({});
    this.disabled = new Set(state.disabledSkills);
    this.enabled = new Set(state.enabledSkills);
    this.skills = [...await this.publicScanner.scan(), ...await new SkillScanner(this.root).scan()];
    if (new Set(this.skills.map((skill) => skill.id)).size !== this.skills.length)
      throw new InvalidSkillPackageError("A domain skill conflicts with a public skill name");
  }

  getSkills(query: SkillQuery = {}) {
    return this.skills.filter((skill) =>
      (!query.type || skill.manifest.type === query.type) &&
      (!query.category || skill.manifest.category === query.category) &&
      (query.includeDisabled || this.isSkillEnabled(skill.id)));
  }
  getSkillById(id: string) { return this.skills.find((skill) => skill.id === id) ?? null; }
  isSkillEnabled(id: string) {
    if (this.disabled.has(id)) return false;
    if (this.enabled.has(id)) return true;
    return this.getSkillById(id)?.manifest.defaultEnabled !== false;
  }
  setSkillEnabled(id: string, enabled: boolean) {
    (enabled ? this.disabled : this.enabled).delete(id);
    (enabled ? this.enabled : this.disabled).add(id);
    this.saveState();
  }
  removeSkillState(id: string) {
    this.enabled.delete(id);
    this.disabled.delete(id);
    this.saveState();
  }
  private saveState() {
    fs.mkdirSync(this.root, { recursive: true });
    const temporary = this.statePath + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify({ disabledSkills: [...this.disabled].sort(),
      enabledSkills: [...this.enabled].sort(), lastUpdated: new Date().toISOString() }, null, 2));
    fs.renameSync(temporary, this.statePath);
  }
}

export class DomainSkillRegistryManager {
  private readonly publicScanner: SkillScanner;
  constructor(skillsRoot = publicSkillsRoot(), private readonly domainsRoot = runtimeDataDir("domain-skills")) {
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
