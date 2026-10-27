import { z } from "zod";
import { agentChatMessageSchema, agentResponseEventSchema } from "./agent-chat";
import { runtimeIdSchema, runtimeKeySchema } from "./agent-runtime-values";

export const governanceSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["knowledge", "ontology", "history", "artifact"]),
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

export const governanceSessionSchema = z.object({
  id: z.string().uuid(),
  domainId: z.string().min(1),
  initiatorId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().nonnegative(),
  status: z.enum(["idle", "running", "stopped", "failed"]),
  /** Harness turn of a running round; its response stream is addressed by this id. */
  activeTurnId: z.string().min(1).nullable(),
  /** Settled Harness messages; the running turn arrives only through the response stream. */
  messages: z.array(agentChatMessageSchema),
  error: z.string().nullable(),
  work: governanceWorkSchema,
});

export const governanceSummarySchema = governanceSessionSchema.pick({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
});

export type GovernanceSource = z.infer<typeof governanceSourceSchema>;
export type GovernanceIssue = z.infer<typeof governanceIssueSchema>;
export type GovernanceWork = z.infer<typeof governanceWorkSchema>;
export type GovernanceSession = z.infer<typeof governanceSessionSchema>;
export type GovernanceSummary = z.infer<typeof governanceSummarySchema>;

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
        })
      ),
      totalItems: z.number(),
      matchedItems: z.number(),
      next: z.object({ index: z.number(), offset: z.number() }).nullable(),
    })
    .nullable(),
});
export type GovernanceSourceRead = z.infer<typeof governanceSourceReadSchema>;

export const governanceMessageInputSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
});

/** Response stream of one governance turn: shared chat events plus saved business work. */
export const governanceStreamEventSchema = z.union([
  agentResponseEventSchema,
  z.object({ type: z.literal("work"), work: governanceWorkSchema }),
]);
export type GovernanceStreamEvent = z.infer<typeof governanceStreamEventSchema>;

/** All eight tools are workbench governance skills, including the two ontology-backed reads. */
export const governanceRuntimeToolNameSchema = z.enum([
  "search_history", "read_history", "read_evidence", "read_work_record",
  "update_work_record", "read_knowledge", "read_ontology", "collect_turn_artifacts",
]);

/** Taken from the skill environment, never from the model's tool arguments. */
export const governanceSkillCallIdentitySchema = z.object({
  governanceSessionId: runtimeIdSchema,
  runtimeSessionId: runtimeIdSchema,
  runId: runtimeIdSchema,
  invocationId: runtimeIdSchema,
  toolCallId: runtimeKeySchema.nullable(),
}).strict();

/**
 * Business ownership is decided in the workbench transaction, not by a runtime status GET.
 * Opening a new run closes the previous gate and creates a separate work record atomically.
 * Cancel closes the gate before the runtime request. Observed runtime termination closes it
 * before a business terminal event is sent to the page. Closed gates never reopen on retries.
 * A write checks this gate and the session's writeRunId in the same transaction as its commit.
 * In-flight writes before closure can still commit to this run's record after runtime termination.
 */
export const governanceRunWorkSchema = z.object({
  governanceSessionId: runtimeIdSchema,
  runtimeSessionId: runtimeIdSchema,
  runId: runtimeIdSchema,
  writeState: z.enum(["open", "closed"]),
  revision: z.number().int().nonnegative().safe(),
  work: governanceWorkSchema,
}).strict();
export const governanceWriteOwnerSchema = z.object({
  governanceSessionId: runtimeIdSchema,
  runtimeSessionId: runtimeIdSchema,
  writeRunId: runtimeIdSchema.nullable(),
}).strict();
export const governanceWorkPatchSchema = z.object({
  summary: z.string().max(1000).optional(),
  notes: z.string().max(30_000).optional(),
  reviewedKnowledgeIds: z.array(z.string()).optional(),
  issues: z.array(governanceIssueSchema).optional(),
}).strict();
export const governanceWriteRequestSchema = z.object({
  identity: governanceSkillCallIdentitySchema,
  patch: governanceWorkPatchSchema,
}).strict();
export const governanceWriteResponseSchema = z.object({
  runId: runtimeIdSchema,
  revision: z.number().int().nonnegative().safe(),
  work: governanceWorkSchema,
}).strict();
/** HTTP 409. Authorization failures remain 401/403/404, not a successful no-op. */
export const governanceWriteClosedResponseSchema = z.object({
  code: z.literal("GOVERNANCE_RUN_CLOSED"),
  runId: runtimeIdSchema,
  error: z.string().min(1),
}).strict();

export type GovernanceSkillCallIdentity = z.infer<typeof governanceSkillCallIdentitySchema>;
export type GovernanceRunWork = z.infer<typeof governanceRunWorkSchema>;
export type GovernanceWorkPatch = z.infer<typeof governanceWorkPatchSchema>;
export type GovernanceWriteRequest = z.infer<typeof governanceWriteRequestSchema>;
export type GovernanceWriteResponse = z.infer<typeof governanceWriteResponseSchema>;
