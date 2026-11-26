import { defaultAssistantSkills } from "../../config/assistant-defaults";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { APP_BUILDER, APP_BUILDER_KIND } from "../app-builder/definition";
import { OPS_DIAGNOSIS, OPS_DIAGNOSIS_KIND } from "../ops-diagnosis/definition";
import { GOVERNANCE_KIND, GOVERNANCE_SKILLS } from "./governance-definition";

/** Reports and charts only: asking the data is the assistant's job, and a preset here may be given the query skill by its owner. */
const reportSkills = (): RuntimeSkillRef[] => defaultAssistantSkills.filter(skill => skill.name !== "ontomato-analyst-assistant");

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
    skills: defaultAssistantSkills,
  },
  [GOVERNANCE_KIND]: {
    kind: GOVERNANCE_KIND,
    name: "Knowledge governance",
    description: "Review business knowledge with traceable evidence",
    skills: GOVERNANCE_SKILLS,
  },
  modeling: {
    kind: "modeling",
    name: "Modelling assistant",
    description: "Build and maintain what this domain is made of",
    skills: reportSkills(),
  },
  "product-layer": {
    kind: "product-layer",
    name: "Product layer assistant",
    description: "Components, projections, panels, applications and agent definitions",
    skills: reportSkills(),
  },
  admin: {
    kind: "admin",
    name: "Admin assistant",
    description: "Members, roles, permission policies, settings and task triggers",
    skills: reportSkills(),
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
  presetAgentDefinitions.modeling,
  presetAgentDefinitions["product-layer"],
  presetAgentDefinitions.admin,
  { ...APP_BUILDER, kind: APP_BUILDER_KIND },
  { ...OPS_DIAGNOSIS, kind: OPS_DIAGNOSIS_KIND },
];

/** A preset's place in the list above, or undefined for a user-built agent. */
export function presetSortOrder(kind: string): number | undefined {
  const index = presetAgents.findIndex(preset => preset.kind === kind);
  return index < 0 ? undefined : index;
}
