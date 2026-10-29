import fs from "fs";
import path from "path";
import type { SkillMeta } from "../types";
import { normalizeSkillPackagePath, parseSkillMarkdownFrontmatter } from "../manifest";
import { createLogger } from "../../../logging/logger";
import { tApp } from "../../../i18n";

const logger = createLogger("loader");

/** Management resource reads stay within the authorized package real path. */
export async function resolveSkillPackageFile(
  skill: SkillMeta,
  requestedPath: string
): Promise<string> {
  const relativePath = normalizeSkillPackagePath(requestedPath);
  if (!relativePath) throw new Error(tApp("skills.pkg.relativePath"));
  const packagePath = await fs.promises.realpath(skill.path);
  const targetPath = await fs.promises.realpath(path.join(packagePath, relativePath));
  const containment = path.relative(packagePath, targetPath);
  if (
    containment === ".." ||
    containment.startsWith(`..${path.sep}`) ||
    path.isAbsolute(containment)
  ) {
    throw new Error(tApp("skills.pkg.outsidePackage"));
  }
  if (!(await fs.promises.stat(targetPath)).isFile()) throw new Error(tApp("skills.pkg.notFile"));
  return targetPath;
}

export function loadSkillContent(skill: SkillMeta): string | null {
  if (!skill.skillMdPath) return null;

  try {
    if (!fs.existsSync(skill.skillMdPath)) return null;
    return parseSkillMarkdownFrontmatter(fs.readFileSync(skill.skillMdPath, "utf8"))?.content ?? null;
  } catch (error) {
    logger.warn(`[Loader] Failed to load SKILL.md for ${skill.id}:`, error);
    return null;
  }
}
