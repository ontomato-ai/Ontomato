import { skillRegistryManager } from "../../core/skills/registry/manager";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";

/** The current skill catalogue: platform public packages plus the domain's own packages. */
export async function readSkillView(domainId: string, _initiatorCredentials: AssistantCredentials, _userId?: string) {
  const registry = await skillRegistryManager.forDomain(domainId);
  return {
    registry,
    requireSkillById(id: string) {
      const entry = registry.getSkillById(id);
      if (!entry) throw new HttpError(404, "Skill not found", "SKILL_NOT_FOUND");
      return entry;
    },
  };
}

export type SkillView = Awaited<ReturnType<typeof readSkillView>>;
