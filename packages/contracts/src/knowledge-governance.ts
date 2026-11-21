import { z } from "zod";
import {agentExecutionActorRefSchema} from "./agent-channel";

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
