import { z } from "zod";
import {agentExecutionActorRefSchema} from "./agent-channel";

export const governanceSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["knowledge", "ontology", "history", "artifact", "input"]),
  target: z.string(),
  title: z.string(),
  excerpt: z.string(),
});

export const governanceIssueSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(["ontology", "knowledge", "data"]),
  status: z.enum(["proposed", "pending", "confirmed"]),
  problem: z.string().min(1),
  before: z.string(),
  after: z.string().min(1),
  basis: z.string().min(1),
  sourceIds: z.array(z.string()),
});

export const governanceWorkSchema = z.object({
  summary: z.string(),
  notes: z.string(),
  reviewedKnowledgeIds: z.array(z.string()),
  knowledgeTotal: z.number().int().nonnegative().nullable(),
  issues: z.array(governanceIssueSchema),
  sources: z.array(governanceSourceSchema),
});

export type GovernanceSource = z.infer<typeof governanceSourceSchema>;
export type GovernanceIssue = z.infer<typeof governanceIssueSchema>;
export type GovernanceWork = z.infer<typeof governanceWorkSchema>;
export const governanceWorkResponseSchema = z.object({
  revision: z.number().int().nonnegative(), work: governanceWorkSchema,
});

export const governanceSourceReadSchema = z.object({
  source: governanceSourceSchema,
  page: z
    .object({
      items: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          text: z.string(),
          start: z.number(),
          end: z.number(),
          totalChars: z.number(),
        }),
      ),
      totalItems: z.number(),
      matchedItems: z.number(),
      next: z.object({ index: z.number(), offset: z.number() }).nullable(),
    })
    .nullable(),
});
export type GovernanceSourceRead = z.infer<typeof governanceSourceReadSchema>;

/** Trusted host registration; user-facing requests only select a record ID. */
export const governancePlatformWindowSchema = z.object({
  recordId: z.string().uuid(), domainId: z.string().min(1), ownerId: z.string().min(1),
  runtimeHostId: z.literal("workbench"), sessionId: z.string().uuid(), runId: z.string().uuid(),
  expiresAt: z.string().datetime(), executionActor:agentExecutionActorRefSchema.nullable(),
}).strict();
export const governanceWindowSchema = z.object({
  id: z.string().uuid(), sessionId: z.string().uuid(), runId: z.string().uuid(), expiresAt: z.string().datetime(),
  token: z.string().min(1),
}).strict();
export const governanceRuntimeStatusSchema = z.object({
  sessionId: z.string().uuid(), runId: z.string().uuid(),
  status: z.enum(["running", "stopped"]), stopReason: z.string().nullable(),
}).strict();
