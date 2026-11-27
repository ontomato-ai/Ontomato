import { ARTIFACT_CHART_SKILLS } from "@ontomato/contracts/agent-artifact-markdown";
import { PAGE_OPERATOR_SKILL } from "@ontomato/contracts/agent-runtime-skills";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";

export const defaultAssistantSkills: RuntimeSkillRef[] = [
  { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" },
  { namespace: { kind: "provider", provider: "ontology" }, name: "ontology-query" },
  { namespace: { kind: "provider", provider: "workbench" }, name: "assistant-report" },
  ...ARTIFACT_CHART_SKILLS,
  PAGE_OPERATOR_SKILL,
];
