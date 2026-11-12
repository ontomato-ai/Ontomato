import type { RuntimeSkillRef } from "./agent-runtime-skills";
export interface SkillInfo {
  id: string;
  skill: RuntimeSkillRef;
  type: "executable" | "knowledge";
  category: "analysis" | "visualization";
  title?: string;
  description?: string;
  tags: string[];
  isPublic: boolean;
  path: string;
  version: string;
  outputType?: string;
  useCases?: string[];
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
