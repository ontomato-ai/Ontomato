import type { RuntimeSkillRef } from "./agent-runtime-skills";
/**
 * A skill as the platform lists it. The package itself is standard frontmatter only; the title is the edition's label
 * for a built-in skill, otherwise the skill's name, and the description is the label's or the package's own.
 */
export interface SkillInfo {
  id: string;
  skill: RuntimeSkillRef;
  title: string;
  description: string;
  isPublic: boolean;
  path: string;
}

export interface SkillDeleteResult {
  affectedAgents: AnalysisAgentSkillReference[];
  cleanedAgentCount: number;
}

export interface AnalysisAgentSkillReference {
  id: string;
  name: string;
  usesAnalysis: boolean;
  usesVisualization: boolean;
}

/** One file of a skill package, by its path inside the package. */
export interface SkillFile {
  path: string;
  size: number;
}
