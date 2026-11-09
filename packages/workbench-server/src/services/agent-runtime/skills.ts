import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { runtimeRegisteredSkillSchema } from "@ontomato/contracts/agent-runtime-skills";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { readSkillPackage } from "../../core/skills/package";
import fs from "node:fs";
import path from "node:path";
import { publicSkillsRoot, publicSkillTranslationsRoot } from "../../content/layout";

/** Publish the portable package with optional host documentation, using the caller's verified domain. */
export async function publishSkill(root: string, skill: RuntimeSkillRef, domainId?: string) {
  if (skill.namespace.kind === "domain" && skill.namespace.domainId !== domainId)
    throw new Error("Verified domain is required for domain skill publication");
  const pkg = await readSkillPackage(root, skill);
  const translations = publicSkillTranslationsRoot();
  const relative = path.relative(publicSkillsRoot(), root);
  if (skill.namespace.kind === "provider" && translations && relative &&
      relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    const translated = path.join(translations, "zh-CN", relative, "SKILL.md");
    if (fs.existsSync(translated)) {
      pkg.files.push({ path: "references/zh-CN.md", content: fs.readFileSync(translated, "utf8") });
      pkg.files.find((file) => file.path === "SKILL.md")!.content +=
        "\n\nWhen ONTOMATO_LANGUAGE is zh-CN, read references/zh-CN.md for the Chinese instructions and use Chinese for all user-facing output. Keep commands and data keys unchanged.\n";
    }
  }
  return runtimeRegisteredSkillSchema.parse(await new RuntimeClient(domainId).request(
    "/v1/skills", "POST", pkg,
  ));
}
