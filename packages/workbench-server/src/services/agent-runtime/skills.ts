import type { RuntimeSkillRef, RuntimeSkillVersion } from "@ontomato/contracts/agent-runtime-skills";
import { runtimeRegisteredSkillSchema, runtimeSkillVersionSchema } from "@ontomato/contracts/agent-runtime-skills";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { readSkillPackage } from "../../core/skills/package";
import type { SkillPackage } from "../../core/skills/providers";
import fs from "node:fs";
import { exportChartTheme } from "../chart-theme";
import path from "node:path";
import { publicSkillTranslationsRoot } from "../../content/layout";
import { translatedSkillRelativePath, workbenchBuiltinSkillRoot } from "../skills/builtin-paths";
import { environment } from "../../config/environment";
import { getApiConfig } from "../../config/data-query-api";
import { backendPost } from "../../utils/backend-client";

export { workbenchBuiltinSkillRoot };

/** Push one standard package to the runtime, using the caller's verified domain. */
export async function publishSkillPackage(pkg: SkillPackage, domainId?: string) {
  if (pkg.skill.namespace.kind === "domain" && pkg.skill.namespace.domainId !== domainId)
    throw new Error("Verified domain is required for domain skill publication");
  return runtimeRegisteredSkillSchema.parse(await new RuntimeClient(domainId).request(
    "/v1/skills", "POST", pkg,
  ));
}

/** Publish the portable package with optional host documentation, using the caller's verified domain. */
export async function publishSkill(root: string, skill: RuntimeSkillRef, domainId?: string) {
  const pkg = await readSkillPackage(root, skill);
  if (skill.namespace.kind === "provider" && skill.namespace.provider === "workbench" && skill.name === "assistant-report")
    pkg.files.push({ path: "resources/chart-theme.json", content: JSON.stringify(exportChartTheme()) });
  const translations = publicSkillTranslationsRoot();
  const relative = translatedSkillRelativePath(root);
  if (skill.namespace.kind === "provider" && translations && relative) {
    const translated = path.join(translations, "zh-CN", relative, "SKILL.md");
    if (fs.existsSync(translated)) {
      pkg.files.push({ path: "references/zh-CN.md", content: fs.readFileSync(translated, "utf8") });
      pkg.files.find((file) => file.path === "SKILL.md")!.content +=
        "\n\nWhen ONTOMATO_LANGUAGE is zh-CN, read references/zh-CN.md for the Chinese instructions and use Chinese for all user-facing output. Keep commands and data keys unchanged.\n";
    }
  }
  return publishSkillPackage(pkg, domainId);
}

/** Ontology publishes every skill in its provider namespace; the workbench only asks for a version by skill name. */
export async function publishOntologySkill(domainId: string, name: string): Promise<RuntimeSkillVersion> {
  const url = getApiConfig().baseUrl!.replace(/\/$/, "") + "/platform/ontology-skills/package";
  const response = await backendPost("ontology-skill-package", url, { name }, {
    headers: { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken, "X-Domain-Id": domainId },
    retries: 1,
  });
  return runtimeSkillVersionSchema.parse(JSON.parse(response.text));
}
