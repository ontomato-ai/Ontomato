import type { SkillInfo } from "@ontomato/contracts/skills";

type Translate = (key: string, values?: Record<string, unknown>) => string;

/**
 * Where a skill comes from, as its card and page name it, and why it cannot be deleted here when the domain does not
 * own it. The server decides who may write a skill; this only words its answer.
 */
export function skillSource(skill: SkillInfo, t: Translate): { label: string; noDelete: string | null } {
  const restriction = skill.writeRestriction;
  if (restriction === null) return { label: t("capabilities.sourceDomain"), noDelete: null };
  switch (restriction.kind) {
    case "public":
      return { label: t("capabilities.sourcePublic"), noDelete: t("capabilities.builtInNoDelete") };
    case "provider":
      return {
        label: restriction.providerName,
        noDelete: t("capabilities.providerNoDelete", { provider: restriction.providerName }),
      };
  }
}
