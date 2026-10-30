import { z } from "zod";
import { runtimeIdSchema, runtimeSequenceSchema } from "./agent-runtime-values";
import { runtimeMessageRecordSchema, runtimeRunSnapshotSchema, runtimeRunViewSchema, runtimeSessionSchema } from "./agent-runtime";

export const sessionHistoryQuerySchema = z.object({
  before: z.string().max(100).optional(),
  after: z.string().max(100).optional(),
  through: z.string().max(100).optional(),
  runId: runtimeIdSchema.optional(),
}).strict().refine(q => !(q.before && q.after) && (!q.through || !!q.after), "Invalid history direction");
export type SessionHistoryQuery = z.infer<typeof sessionHistoryQuerySchema>;

/** A position, not a credential. The runtime also checks session ownership and the read boundary. */
export function historyCursor(sessionId: string, seq: number): string {
  return `${sessionId}:${seq}`;
}
export function historyPosition(cursor: string, sessionId: string): number {
  const [id, seq] = z.tuple([runtimeIdSchema, z.coerce.number().int().nonnegative().safe()]).parse(cursor.split(":"));
  if (id !== sessionId) throw new Error("History cursor belongs to another session");
  return seq;
}

export const sessionHistoryBoundsSchema = z.object({
  olderCursor: z.string().nullable(),
  nextCursor: z.string().nullable(),
  throughCursor: z.string(),
  messageSeq: runtimeSequenceSchema,
}).strict();
export const runtimeSessionHistorySchema = z.object({
  session: runtimeSessionSchema.extend({ latestRun: runtimeRunViewSchema.nullable() }),
  messages: z.array(runtimeMessageRecordSchema),
  runs: z.array(runtimeRunViewSchema),
  // Only the first tail/repair page has a live cut. Its settled messages are in the page, once.
  latestRun: runtimeRunSnapshotSchema.extend({ run: runtimeRunViewSchema }).nullable(),
  page: sessionHistoryBoundsSchema,
}).strict();
export type RuntimeSessionHistory = z.infer<typeof runtimeSessionHistorySchema>;
