import path from "node:path";
import { workbenchServerResourceRoot } from "../../content/resources";
import { publishSkill } from "../agent-runtime/skills";
export const governanceSkillRef = {
  namespace: { kind: "provider" as const, provider: "workbench" },
  name: "knowledge-governance",
};
export function registerGovernanceSkill() {
  return publishSkill(
    path.join(
      workbenchServerResourceRoot,
      "resources/runtime-skills/knowledge-governance",
    ),
    governanceSkillRef,
  );
}
