import { z } from "zod";

const key = z.string().min(1).max(200);

/** The application declares a target; the host resolves it among the page's current candidates. */
export const defaultAgentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("id"), id: key }).strict(),
  z.object({ kind: z.literal("preset"), agentKind: key }).strict(),
]);
export type DefaultAgent = z.infer<typeof defaultAgentSchema>;
