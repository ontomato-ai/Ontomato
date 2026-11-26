import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

/** The one platform skill that teaches page discovery and operation. It never contains page-specific facts. */
export const PAGE_OPERATOR_SKILL: RuntimeSkillRef = {
  namespace: { kind: "provider", provider: "workbench" },
  name: "ontomato-page-operator",
};

export function isPageOperatorSkill(ref: RuntimeSkillRef): boolean {
  return runtimeSkillKey(ref) === runtimeSkillKey(PAGE_OPERATOR_SKILL);
}
