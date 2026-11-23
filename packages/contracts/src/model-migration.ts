import { z } from "zod";
import { modelApiKeyWriteSchema, modelNameSchema } from "./model-settings";
import { runtimeHttpUrlSchema } from "./agent-runtime-values";

/**
 * Domain-scoped, service-authenticated upgrade interfaces; no browser proxy. `references` maps every reference of the
 * previous shape (a provider ID and a model ID joined by a slash) to the public model name that replaced it; a reference
 * the runtime could not map stays under `unavailablePrefix`, so its owner keeps failing explicitly instead of naming a
 * different model.
 */
export const modelMigrationMapSchema = z.object({
  references: z.record(modelNameSchema),
  unavailablePrefix: z.string().min(1),
}).strict();
export type ModelMigrationMap = z.output<typeof modelMigrationMapSchema>;
/** Only legacy rows are passed here; each owner persists a migration marker, including on new writes. */
export function migrateModelReference(value: string | null, mapping: ModelMigrationMap): string | null {
  if (value === null) return null;
  return mapping.references[value] ?? `${mapping.unavailablePrefix}/${value}`;
}
/** The embedding settings an earlier release kept in the domain's business configuration, imported once. */
export const legacyEmbeddingImportSchema = z.object({
  baseUrl: runtimeHttpUrlSchema, apiKey: modelApiKeyWriteSchema,
  modelName: z.string().trim().min(1), dimensions: z.number().int().positive(),
  timeoutMs: z.number().int().positive().optional(), headers: z.record(z.string()).optional(),
}).strict();
export const legacyEmbeddingImportResponseSchema = z.object({
  importedModelId: modelNameSchema, embeddingModelId: modelNameSchema.nullable(),
}).strict();
export type LegacyEmbeddingImport = z.output<typeof legacyEmbeddingImportSchema>;
