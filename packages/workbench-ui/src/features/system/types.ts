import { z } from "zod";
import type { SystemModelConfig } from "@ontomato/contracts/system-model";
import type { BackendModelConfig } from "@ontomato/contracts/model-settings";

/*
 * Types of the workbench's own configuration pages: the query settings (Node system model file), and the model
 * configuration page's model entries, role references, Embedding model and vector rebuild status. The ontology service
 * part of the system configuration lives in the Ontology Manager (@ontomato/platform-admin).
 */

/**
 * A model entry edited on the model configuration page: based on the entry read by getModelSettings, with fields that
 * have no controls (organizationId etc.) round-tripped as-is in the snapshot. Unset optional fields may be null when
 * read; new or cleared maxTokens / contextWindow are submitted as null and runtime read normalization fills the defaults.
 */
export type ModelEntry = Omit<
  BackendModelConfig,
  "maxTokens" | "contextWindow" | "timeout" | "maxRetries" | "temperature" | "topP" | "maxCompletionTokens"
> & {
  maxTokens: number | null;
  contextWindow: number | null;
  timeout?: string | null;
  maxRetries?: number | null;
  temperature?: number | null;
  topP?: number | null;
  maxCompletionTokens?: number | null;
};

/** A save the page hands to a card's dialog: resolves to whether the value was saved; the dialog closes only on success. */
export type SaveAction<T> = (value: T) => Promise<boolean>;


/** The part of GET /businessConfig/getConfig the model configuration page reads. */
export interface BusinessConfig {
  embeddingModelProperties: EmbeddingModelConfig | null;
}

export type QuerySettings = Pick<SystemModelConfig, "queryTimeoutSeconds">;

export interface EmbeddingModelConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  timeout: string;
  /** Vector dimensions of this domain: sent with every embedding request, a positive integer. */
  dimensions: number;
  customHeaders?: Record<string, string> | null;
}

// Java omits null fields from the response; the boundary normalizes an absent value to null.
const nullable = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform((value) => value ?? null);
const vectorRebuildProgress = { total: z.number().int().nonnegative(), done: z.number().int().nonnegative() };

/** Where and why the latest round failed; CLEAR covers the whole domain, CLEAR and READ have no item id. */
const vectorRebuildFailureSchema = z.object({
  phase: z.enum(["CLEAR", "READ", "EMBED", "SAVE"]),
  itemType: nullable(z.enum(["KNOWLEDGE", "EXAMPLE", "SPLIT_EXAMPLE", "ACTION", "METRIC_VIEW", "RESOURCE"])),
  itemId: nullable(z.string()),
  reason: z.string(),
});

/**
 * GET /businessConfig/vectorRebuildStatus, validated where the page reads it: a failure is reported exactly when
 * the state is FAILED. Vector search is open only when READY; PAUSING means the run stops after its current item,
 * INTERRUPTED that the service stopped during a round.
 */
export const vectorRebuildStatusSchema = z.union([
  z.object({ ...vectorRebuildProgress, state: z.literal("FAILED"), error: vectorRebuildFailureSchema }),
  z.object({
    ...vectorRebuildProgress,
    state: z.enum(["READY", "PENDING", "RUNNING", "PAUSING", "PAUSED", "INTERRUPTED"]),
    error: z.null().optional().transform(() => null),
  }),
]);

export type VectorRebuildStatus = z.output<typeof vectorRebuildStatusSchema>;
export type VectorRebuildState = VectorRebuildStatus["state"];

// Model identity: name is the fixed config ID and displayName may be duplicated;
// append the ID when they differ, show it once when they match.
export function modelLabel(model: { name: string; displayName: string }): string {
  return model.displayName === model.name ? model.name : `${model.displayName} (${model.name})`;
}

export function formatTimeout(seconds: number): string {
  return `PT${seconds}S`;
}

