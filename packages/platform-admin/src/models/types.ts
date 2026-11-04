import { z } from "zod";

/*
 * The vector rebuild status the model configuration page shows under the embedding model. The rebuild belongs to the
 * data engine: changing the embedding model or its dimensions starts a new round there.
 */

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
