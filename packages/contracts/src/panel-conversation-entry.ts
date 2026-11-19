import { z } from "zod";
import { defaultAgentSchema } from "./default-agent";

export const pageComposerAgentTargetSchema = z.discriminatedUnion("kind", [
  ...defaultAgentSchema.options,
  z.object({ kind: z.literal("page-default") }).strict(),
]);

/** The trusted projection declaration owns the exact target and optional prefill for this entry. */
export const panelConversationEntrySchema = z.object({
  target: pageComposerAgentTargetSchema,
  prefill: z.string().optional(),
}).strict();
export type PanelConversationEntry = z.infer<typeof panelConversationEntrySchema>;
