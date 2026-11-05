import { z } from "zod";
import {
  runtimeIdSchema,
  runtimeTimestampSchema,
} from "./agent-runtime-values";

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

export const scheduledTaskFrequencySchema = z.discriminatedUnion("kind", [
  /**
   * Every `every` units on a fixed cadence from the previous scheduled slot; the first slot is one interval after the
   * task is created, edited, switched on or resumed. Missed slots are not made up: one run, then the cadence goes on.
   */
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
    .object({
      kind: z.literal("weekly"),
      weekday: z.number().int().min(1).max(7),
      time: timeOfDaySchema,
    })
    .strict(),
  /** A day past the end of a month runs on that month's last day. */
  z
    .object({
      kind: z.literal("monthly"),
      day: z.number().int().min(1).max(31),
      time: timeOfDaySchema,
    })
    .strict(),
]);
export type ScheduledTaskFrequency = z.infer<
  typeof scheduledTaskFrequencySchema
>;

export const SCHEDULED_TASK_PROMPT_MAX = 4000;

/**
 * Why the system stopped scheduling a task that its owner left on. credential_invalid: the owner's internal
 * credential no longer works; the owner's next visit to the scheduled tasks page with a valid login renews it and
 * resumes these tasks. agent_unavailable: the agent was disabled or deleted; editing or switching the task on again
 * resumes it.
 */
export const scheduledTaskPauseReasonSchema = z.enum([
  "credential_invalid",
  "agent_unavailable",
]);
export type ScheduledTaskPauseReason = z.infer<
  typeof scheduledTaskPauseReasonSchema
>;

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
export type ScheduledTaskRunErrorCode = z.infer<
  typeof scheduledTaskRunErrorCodeSchema
>;

/** Gateway-relative DataRAG resource. Lists combine private agent tasks and permitted domain function tasks. */
export const platformSchedulesPath = "/api/data-query/platform/scheduled-tasks";
export const platformTaskAppSchema = z.enum(["agents", "ontology"]);
export const platformTaskTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("agent"),
      agentId: runtimeIdSchema,
      prompt: z.string().trim().min(1).max(SCHEDULED_TASK_PROMPT_MAX),
    })
    .strict(),
  z
    .object({ kind: z.literal("function"), functionId: z.string().min(1) })
    .strict(),
]);
export const platformTaskFrequencySchema = z.union([
  scheduledTaskFrequencySchema,
  z.object({ kind: z.literal("cron"), expression: z.string().min(1) }).strict(),
]);
const definition = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  target: platformTaskTargetSchema,
  frequency: platformTaskFrequencySchema,
  timeZone: z.string().min(1),
  notifyEmail: z.string().email().nullable(),
});
export const platformTaskInputSchema = definition
  .extend({
    description: definition.shape.description.optional(),
    timeZone: definition.shape.timeZone.optional(),
  })
  .strict();
export const platformTaskRunSchema = z
  .object({
    id: runtimeIdSchema,
    taskId: runtimeIdSchema,
    target: platformTaskTargetSchema,
    sessionId: runtimeIdSchema.nullable(),
    trigger: z.enum(["manual", "schedule", "unknown"]),
    status: z.enum(["running", "completed", "failed"]),
    error: z
      .object({
        code: scheduledTaskRunErrorCodeSchema,
        message: z.string().nullable(),
      })
      .nullable(),
    result: z.string().nullable(),
    spendTime: z.number().nullable(),
    startedAt: runtimeTimestampSchema,
    finishedAt: runtimeTimestampSchema.nullable(),
  })
  .strict();
export const platformTaskSchema = definition
  .extend({
    id: runtimeIdSchema,
    appId: platformTaskAppSchema,
    ownerId: z.string().nullable(),
    enabled: z.boolean(),
    pausedReason: scheduledTaskPauseReasonSchema.nullable(),
    nextRunAt: runtimeTimestampSchema.nullable(),
    createdAt: runtimeTimestampSchema,
    updatedAt: runtimeTimestampSchema,
    lastRun: platformTaskRunSchema.nullable(),
  })
  .strict();
export const platformTaskListSchema = z
  .object({ tasks: z.array(platformTaskSchema), timeZone: z.string() })
  .strict();
export const platformTaskRunPageSchema = z
  .object({
    runs: z.array(platformTaskRunSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type PlatformTask = z.infer<typeof platformTaskSchema>;
export type PlatformTaskInput = z.infer<typeof platformTaskInputSchema>;
export type PlatformTaskRun = z.infer<typeof platformTaskRunSchema>;
