import type { RuntimeSkillRef } from "./agent-runtime-skills";
/**
 * Who owns a skill's content, as far as changing it here is concerned: a public package and a provider package are
 * read-only, and a provider is named so management can say where to change it.
 */
export type SkillWriteRestriction =
  | null
  | { kind: "public" }
  | { kind: "provider"; providerId: string; providerName: string };

/**
 * A skill as the platform lists it. The package itself is standard frontmatter only; the title is the edition's label
 * for a built-in skill, otherwise the skill's name, and the description is the label's or the package's own.
 */
export interface SkillInfo {
  id: string;
  skill: RuntimeSkillRef;
  title: string;
  description: string;
  /** Whether the content comes from the public packages; providers have their own restriction. */
  isPublic: boolean;
  /** The package's source directory for file sources; providers have no path. */
  path?: string;
  /** The server's single answer for whether this skill can be changed in this domain. */
  writeRestriction: SkillWriteRestriction;
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
