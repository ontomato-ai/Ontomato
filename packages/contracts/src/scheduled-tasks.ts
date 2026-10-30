import { z } from "zod";
import { runtimeIdSchema, runtimeTimestampSchema } from "./agent-runtime-values";

/**
 * Scheduled tasks of the workbench: a prompt that an agent runs for its owner on a schedule, each run in a new
 * conversation. Times of day are wall-clock times of the server's schedule time zone.
 */
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

export const scheduledTaskFrequencySchema = z.discriminatedUnion("kind", [
  /** Every `every` units, counted from the previous trigger. */
  z
    .object({
      kind: z.literal("interval"),
      every: z.number().int().min(1).max(1000),
      unit: z.enum(["minute", "hour", "day"]),
    })
    .strict(),
  z.object({ kind: z.literal("daily"), time: timeOfDaySchema }).strict(),
  /** weekday: 1 = Monday … 7 = Sunday. */
  z
    .object({ kind: z.literal("weekly"), weekday: z.number().int().min(1).max(7), time: timeOfDaySchema })
    .strict(),
  /** A day past the end of a month runs on that month's last day. */
  z
    .object({ kind: z.literal("monthly"), day: z.number().int().min(1).max(31), time: timeOfDaySchema })
    .strict(),
]);
export type ScheduledTaskFrequency = z.infer<typeof scheduledTaskFrequencySchema>;

export const SCHEDULED_TASK_PROMPT_MAX = 4000;

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

/**
 * Why the system stopped scheduling a task that its owner left on. credential_invalid: the owner's internal
 * credential no longer works; the owner's next visit to the scheduled tasks page with a valid login renews it and
 * resumes these tasks. agent_unavailable: the agent was disabled or deleted; editing or switching the task on again
 * resumes it.
 */
export const scheduledTaskPauseReasonSchema = z.enum(["credential_invalid", "agent_unavailable"]);
export type ScheduledTaskPauseReason = z.infer<typeof scheduledTaskPauseReasonSchema>;

/**
 * credential_invalid / agent_unavailable: as the pause reasons. start_failed: the conversation could not start.
 * run_failed: the agent's run ended with an error or was cancelled. interrupted: the run was lost, e.g. by a restart.
 */
export const scheduledTaskRunErrorCodeSchema = z.enum([
  "credential_invalid",
  "agent_unavailable",
  "dependency_unavailable",
  "start_failed",
  "run_failed",
  "interrupted",
]);
export type ScheduledTaskRunErrorCode = z.infer<typeof scheduledTaskRunErrorCodeSchema>;

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
