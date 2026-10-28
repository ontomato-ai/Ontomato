import type { AssistantAgentInput } from "@ontomato/contracts/assistant-chat";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

/**
 * The skill selector lists the domain's own skills by name; definitions read complete runtime skill
 * references. Provider skills (built into the workbench) are kept as they are.
 */
export function splitSkillRefs(refs: readonly RuntimeSkillRef[]) {
  return {
    domainNames: refs.filter((ref) => ref.namespace.kind === "domain").map((ref) => ref.name),
    providerRefs: refs.filter((ref) => ref.namespace.kind === "provider"),
  };
}

/** Domain skills are written without a domain ID; the server uses the caller's verified domain. */
export function joinSkillRefs(
  providerRefs: readonly RuntimeSkillRef[],
  domainNames: readonly string[],
): AssistantAgentInput["skills"] {
  return [...providerRefs, ...domainNames.map((name) => ({ namespace: { kind: "domain" as const }, name }))];
}
