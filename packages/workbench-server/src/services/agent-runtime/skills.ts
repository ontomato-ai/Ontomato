import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { runtimeRegisteredSkillSchema } from "@ontomato/contracts/agent-runtime-skills";
import { RuntimeClient } from "../../infrastructure/agent-runtime/client";
import { readSkillPackage } from "../../core/skills/package";

/** Publish the exact portable directory using the caller's verified domain. */
export async function publishSkill(root: string, skill: RuntimeSkillRef, domainId?: string) {
  if (skill.namespace.kind === "domain" && skill.namespace.domainId !== domainId)
    throw new Error("Verified domain is required for domain skill publication");
  return runtimeRegisteredSkillSchema.parse(await new RuntimeClient(domainId).request(
    "/v1/skills", "POST", await readSkillPackage(root, skill),
  ));
}
