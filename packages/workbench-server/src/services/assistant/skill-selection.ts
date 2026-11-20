import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

/** Regular assistants also select the supplied page skills. Callers own the visibility of their inputs. */
export function configuredAssistantSkills(
  agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  pageSkills: readonly RuntimeSkillRef[],
): RuntimeSkillRef[] {
  const selected = agent.kind === "regular" ? [...agent.skills, ...pageSkills] : agent.skills;
  return [...new Map(selected.map(ref => [runtimeSkillKey(ref), ref])).values()];
}
