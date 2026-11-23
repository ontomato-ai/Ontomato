import { defaultAssistantSkills } from "../../config/assistant-defaults";
import { GOVERNANCE_KIND, GOVERNANCE_SKILLS } from "./governance-definition";

export const presetAgentDefinitions = {
  regular: {
    kind: "regular",
    name: "Assistant",
    description: "Ask questions about your data",
    skills: defaultAssistantSkills,
    sortOrder: 0,
  },
  analysis: {
    kind: "analysis",
    name: "Analyst",
    description: "Investigate questions and produce reports",
    skills: defaultAssistantSkills,
    sortOrder: 1,
  },
  [GOVERNANCE_KIND]: {
    kind: GOVERNANCE_KIND,
    name: "Knowledge governance",
    description: "Review business knowledge with traceable evidence",
    skills: GOVERNANCE_SKILLS,
    sortOrder: 2,
  },
} as const;

export type PresetAgentKind = keyof typeof presetAgentDefinitions;

export function isPresetAgentKind(kind: string): kind is PresetAgentKind {
  return Object.hasOwn(presetAgentDefinitions, kind);
}
