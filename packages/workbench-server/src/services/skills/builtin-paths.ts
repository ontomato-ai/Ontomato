import path from "node:path";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { publicSkillsRoot } from "../../content/layout";
import { workbenchServerResourceRoot } from "../../content/resources";

/** Locate a file-backed platform skill without reading its package. */
export function workbenchBuiltinSkillRoot(skill: RuntimeSkillRef): string {
  if (skill.name === "ontomato-app-builder") {
    return path.resolve(workbenchServerResourceRoot, "../../agent-skills", skill.name);
  }
  if (skill.name === "dashboard-pages") {
    return path.join(publicSkillsRoot(), "pages", skill.name);
  }
  return path.join(workbenchServerResourceRoot, "resources/runtime-skills", skill.name);
}

/** Translation resources mirror either the public skill root or the platform runtime-skills root. */
export function translatedSkillRelativePath(root: string): string | null {
  const runtimeSkills = path.join(workbenchServerResourceRoot, "resources/runtime-skills");
  const runtimeRelative = path.relative(runtimeSkills, root);
  if (runtimeRelative && runtimeRelative !== ".." && !runtimeRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(runtimeRelative))
    return path.join("runtime-skills", runtimeRelative);
  const publicRelative = path.relative(publicSkillsRoot(), root);
  return publicRelative && publicRelative !== ".." && !publicRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(publicRelative)
    ? publicRelative
    : null;
}
