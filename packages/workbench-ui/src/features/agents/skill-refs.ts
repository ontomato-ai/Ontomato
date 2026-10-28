import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

/**
 * The skill selector lists the domain's own skills by name; definitions store runtime skill
 * references. Provider skills (built into the workbench) are kept as they are.
 */
export function splitSkillRefs(refs: readonly RuntimeSkillRef[]) {
  return {
    domainNames: refs.filter((ref) => ref.namespace.kind === "domain").map((ref) => ref.name),
    providerRefs: refs.filter((ref) => ref.namespace.kind === "provider"),
    domainId:
      refs.flatMap((ref) => (ref.namespace.kind === "domain" ? [ref.namespace.domainId] : []))[0] ?? null,
  };
}

export function joinSkillRefs(
  providerRefs: readonly RuntimeSkillRef[],
  domainNames: readonly string[],
  domainId: string | null,
): RuntimeSkillRef[] | null {
  if (domainNames.length && !domainId) return null;
  return [
    ...providerRefs,
    ...domainNames.map((name) => ({ namespace: { kind: "domain" as const, domainId: domainId! }, name })),
  ];
}
