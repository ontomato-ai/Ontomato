import fs from "node:fs";
import path from "node:path";
import { InvalidSkillPackageError, readSkillMarkdown } from "../manifest";
import type { SkillMeta } from "../types";

/** Discover packages without inferring identity or behavior from parent folders. */
export class SkillScanner {
  constructor(private readonly root: string, private readonly isPublic = false) {}

  async scan(): Promise<SkillMeta[]> {
    const skills: SkillMeta[] = [];
    const walk = (directory: string) => {
      if (!fs.existsSync(directory)) return;
      const file = path.join(directory, "SKILL.md");
      if (fs.existsSync(file)) {
        const parsed = readSkillMarkdown(file);
        if (!parsed) return;
        if (path.basename(directory) !== parsed.manifest.name)
          throw new InvalidSkillPackageError(`Skill name must match its directory: ${directory}`);
        skills.push({ id: parsed.manifest.name, path: directory, isPublic: this.isPublic,
          manifest: parsed.manifest, skillMdPath: file });
        return;
      }
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isSymbolicLink()) throw new InvalidSkillPackageError("Skill directories must not contain links");
        if (entry.isDirectory()) walk(path.join(directory, entry.name));
      }
    };
    walk(this.root);
    if (new Set(skills.map((skill) => skill.id)).size !== skills.length)
      throw new InvalidSkillPackageError("Duplicate skill names in the catalogue");
    return skills;
  }
}
