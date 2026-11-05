import { z } from "zod";
import { runtimeIdSchema, runtimeTimestampSchema } from "./agent-runtime-values";

/** Kept for the outgoing workbench UI until its replacement is integrated. */
import { scheduledTaskFrequencySchema, SCHEDULED_TASK_PROMPT_MAX,
  scheduledTaskPauseReasonSchema, scheduledTaskRunErrorCodeSchema } from "./platform-schedules";
export { scheduledTaskFrequencySchema, SCHEDULED_TASK_PROMPT_MAX,
  scheduledTaskPauseReasonSchema, scheduledTaskRunErrorCodeSchema } from "./platform-schedules";
export type { ScheduledTaskFrequency, ScheduledTaskPauseReason, ScheduledTaskRunErrorCode } from "./platform-schedules";

export const scheduledTaskInputSchema = z
  .object({
    agentId: runtimeIdSchema,
    prompt: z.string().trim().min(1).max(SCHEDULED_TASK_PROMPT_MAX),
    frequency: scheduledTaskFrequencySchema,
    /** Where completion and failure mails go; null sends none. */
    notifyEmail: z.string().trim().email().max(320).nullable(),
  })
  .strict();
export type ScheduledTaskInput = z.infer<typeof scheduledTaskInputSchema>;

export const scheduledTaskEnabledInputSchema = z.object({ enabled: z.boolean() }).strict();

export const scheduledTaskRunSchema = z
  .object({
    id: runtimeIdSchema,
    taskId: runtimeIdSchema,
    /** The run's conversation; null when it failed before one was started. */
    sessionId: runtimeIdSchema.nullable(),
    trigger: z.enum(["schedule", "manual"]),
    status: z.enum(["running", "completed", "failed"]),
    error: z.object({ code: scheduledTaskRunErrorCodeSchema, message: z.string() }).strict().nullable(),
    startedAt: runtimeTimestampSchema,
    finishedAt: runtimeTimestampSchema.nullable(),
  })
  .strict();
export type ScheduledTaskRun = z.infer<typeof scheduledTaskRunSchema>;

export const scheduledTaskSchema = z
  .object({
    id: runtimeIdSchema,
    agentId: runtimeIdSchema,
    prompt: z.string(),
    frequency: scheduledTaskFrequencySchema,
    notifyEmail: z.string().nullable(),
    /** The owner's switch. */
    enabled: z.boolean(),
    pausedReason: scheduledTaskPauseReasonSchema.nullable(),
    /** Null while switched off or paused. */
    nextRunAt: runtimeTimestampSchema.nullable(),
    lastRun: scheduledTaskRunSchema.nullable(),
    createdAt: runtimeTimestampSchema,
    updatedAt: runtimeTimestampSchema,
  })
  .strict();
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;

export const scheduledTaskListSchema = z
  .object({
    tasks: z.array(scheduledTaskSchema),
    /** The IANA zone the times of day are read in. */
    timeZone: z.string(),
  })
  .strict();
export type ScheduledTaskList = z.infer<typeof scheduledTaskListSchema>;

export const scheduledTaskRunPageSchema = z
  .object({ runs: z.array(scheduledTaskRunSchema), nextCursor: z.string().nullable() })
  .strict();
export type ScheduledTaskRunPage = z.infer<typeof scheduledTaskRunPageSchema>;

/** One owner keeps at most this many scheduled tasks per domain. */
export const SCHEDULED_TASKS_PER_OWNER_MAX = 50;
