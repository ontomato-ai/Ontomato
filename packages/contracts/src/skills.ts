import { z } from "zod";
import { runtimeSkillRefSchema, type RuntimeSkillRef } from "./agent-runtime-skills";
import { runtimeKeySchema } from "./agent-runtime-values";

export const skillCatalogReasonSchema = z.enum([
  "record_missing", "invalid_definition", "component_missing", "operation_unregistered",
]);
export type SkillCatalogReason = z.infer<typeof skillCatalogReasonSchema>;

/** A catalogue reports broken entries only when the reader is known to have access to their full dependencies. */
export const skillCatalogDiagnosticsSchema = z.object({
  items: z.array(z.object({
    skill: runtimeSkillRefSchema,
    resourceId: runtimeKeySchema,
    field: runtimeKeySchema.optional(),
    reason: skillCatalogReasonSchema,
  }).strict()),
  /** An unidentified source could not be resolved or ruled out, so the catalogue may be incomplete. */
  sourceUnavailable: z.boolean(),
}).strict();
export type SkillCatalogDiagnostics = z.infer<typeof skillCatalogDiagnosticsSchema>;

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

/** The management catalogue and its search return the same successful result. */
export interface SkillCatalog {
  skills: SkillInfo[];
  diagnostics?: SkillCatalogDiagnostics;
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
