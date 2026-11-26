import { defaultAssistantSkills } from "../../config/assistant-defaults";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { APP_BUILDER, APP_BUILDER_KIND } from "../app-builder/definition";
import { OPS_DIAGNOSIS, OPS_DIAGNOSIS_KIND } from "../ops-diagnosis/definition";
import { GOVERNANCE_KIND, GOVERNANCE_SKILLS } from "./governance-definition";
import { PAGE_OPERATOR_SKILL } from "./page-operator";

const withPageOperator = (skills: readonly RuntimeSkillRef[]): RuntimeSkillRef[] => [
  ...skills.filter(skill => skill.name !== PAGE_OPERATOR_SKILL.name),
  PAGE_OPERATOR_SKILL,
];

export const presetAgentDefinitions = {
  regular: {
    kind: "regular",
    name: "Assistant",
    description: "Ask questions about your data",
    skills: defaultAssistantSkills,
  },
  analysis: {
    kind: "analysis",
    name: "Analyst",
    description: "Investigate questions and produce reports",
    skills: defaultAssistantSkills.filter(skill => skill.name !== PAGE_OPERATOR_SKILL.name),
  },
  [GOVERNANCE_KIND]: {
    kind: GOVERNANCE_KIND,
    name: "Knowledge governance",
    description: "Review business knowledge with traceable evidence",
    skills: withPageOperator(GOVERNANCE_SKILLS),
  },
} as const;

export type PresetAgentKind = keyof typeof presetAgentDefinitions;

export function isPresetAgentKind(kind: string): kind is PresetAgentKind {
  return Object.hasOwn(presetAgentDefinitions, kind);
}

export type PresetAgent = {
  kind: string; name: string; description: string; skills: readonly RuntimeSkillRef[]; icon?: string;
};

/**
 * Every preset the platform installs in a domain, in the order they appear in agent lists. This list is the only place
 * that order is decided: the stored `sort_order` column orders user-built agents, and a preset's row is brought back to
 * its place here whenever a domain is initialized again.
 */
export const presetAgents: readonly PresetAgent[] = [
  presetAgentDefinitions.regular,
  presetAgentDefinitions.analysis,
  presetAgentDefinitions[GOVERNANCE_KIND],
  { ...APP_BUILDER, kind: APP_BUILDER_KIND, skills: withPageOperator(APP_BUILDER.skills) },
  { ...OPS_DIAGNOSIS, kind: OPS_DIAGNOSIS_KIND, skills: withPageOperator(OPS_DIAGNOSIS.skills) },
];

/** A preset's place in the list above, or undefined for a user-built agent. */
export function presetSortOrder(kind: string): number | undefined {
  const index = presetAgents.findIndex(preset => preset.kind === kind);
  return index < 0 ? undefined : index;
}
