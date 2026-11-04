import { z } from "zod";
import { modelApiKeyWriteSchema, modelReferenceSchema } from "./model-settings";
import { runtimeHttpUrlSchema } from "./agent-runtime-values";

/** Domain-scoped, service-authenticated upgrade interfaces; no browser proxy. */
export const modelMigrationMapSchema = z.object({
  references: z.record(modelReferenceSchema),
  unconfiguredProviderId: z.enum(["legacy", "legacy-unconfigured"]),
}).strict();
export type ModelMigrationMap = z.output<typeof modelMigrationMapSchema>;
/** Only legacy rows are passed here; each owner persists a migration marker, including on new writes. */
export function migrateModelReference(value: string | null, mapping: ModelMigrationMap): string | null {
  if (value === null) return null;
  return mapping.references[value] ?? `${mapping.unconfiguredProviderId}/${value}`;
}
export const legacyEmbeddingImportSchema = z.object({
  baseUrl: runtimeHttpUrlSchema, apiKey: modelApiKeyWriteSchema,
  modelName: z.string().trim().min(1), dimensions: z.number().int().positive(),
  timeoutMs: z.number().int().positive().optional(), headers: z.record(z.string()).optional(),
}).strict();
export const legacyEmbeddingImportResponseSchema = z.object({
  importedModelId: modelReferenceSchema, embeddingModelId: modelReferenceSchema.nullable(),
}).strict();
export type LegacyEmbeddingImport = z.output<typeof legacyEmbeddingImportSchema>;
