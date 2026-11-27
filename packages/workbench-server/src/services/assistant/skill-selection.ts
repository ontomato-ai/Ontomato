import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

/** Skills explicitly selected on the agent, deduplicated by complete runtime identity. */
export function configuredAssistantSkills(
  agent: { kind: string; skills: readonly RuntimeSkillRef[] },
): RuntimeSkillRef[] {
  return [...new Map(agent.skills.map(ref => [runtimeSkillKey(ref), ref])).values()];
}
