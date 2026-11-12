import fs from "fs";
import path from "path";
import type { SkillMeta } from "../types";
import { normalizeSkillPackagePath } from "../manifest";
import { tApp } from "../../../i18n";

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
