import { z } from "zod";
import {
  runtimeIdSchema,
  runtimeJsonObjectSchema,
  runtimeTimestampSchema,
} from "./agent-runtime-values";

/** Gateway-relative resource. Every task and execution belongs to its creator in the current domain. */
export const platformSchedulesPath = "/api/data-query/platform/scheduled-tasks";
export const PLATFORM_SCHEDULE_TITLE_MAX = 200;
export const PLATFORM_SCHEDULE_TEXT_MAX = 4000;
export const PLATFORM_SCHEDULE_FIELD_MAX = 100;
export const PLATFORM_SCHEDULE_FIELD_KEY_MAX = 256;
export const PLATFORM_SCHEDULE_CONTENT_MAX_BYTES = 64 * 1024;
export const PLATFORM_SCHEDULE_HANDLE_MAX_BYTES = 8 * 1024;

const nonempty = z.string().min(1);
const revision = z.number().int().positive().safe();
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const title = z.string().trim().min(1).max(PLATFORM_SCHEDULE_TITLE_MAX);
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** Open application IDs let new applications declare a form without changing the platform's target types. */
export const platformTaskAppSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const platformScheduleTimeZoneSchema = nonempty.refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Expected a time zone recognized by the deployment");

export const platformTaskFrequencySchema = z.discriminatedUnion("kind", [
  /** Fixed cadence from the previous planned slot. A missed interval is admitted at most once. */
  z.object({
    kind: z.literal("interval"),
    every: z.number().int().min(1).max(1000),
    unit: z.enum(["minute", "hour", "day"]),
  }).strict(),
  z.object({ kind: z.literal("daily"), time: timeOfDay }).strict(),
  /** 1 = Monday, 7 = Sunday. */
  z.object({ kind: z.literal("weekly"), weekday: z.number().int().min(1).max(7), time: timeOfDay }).strict(),
  /** A day past the end of the month uses that month's last day. */
  z.object({ kind: z.literal("monthly"), day: z.number().int().min(1).max(31), time: timeOfDay }).strict(),
  /** Spring's seconds-precision expression is validated by DataRAG, not a second browser parser. */
  z.object({ kind: z.literal("cron"), expression: z.string().trim().min(1) }).strict(),
]);

export const platformScheduleFieldKeySchema = z.string().min(1).max(PLATFORM_SCHEDULE_FIELD_KEY_MAX);
/** Values stay text on the wire. Each application owns parameter parsing and validation. */
export const platformScheduleContentSchema = z.record(
  platformScheduleFieldKeySchema,
  z.string().max(PLATFORM_SCHEDULE_TEXT_MAX),
).superRefine((value, ctx) => {
  if (Object.keys(value).length > PLATFORM_SCHEDULE_FIELD_MAX)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Too many form fields" });
  if (byteLength(value) > PLATFORM_SCHEDULE_CONTENT_MAX_BYTES)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Form content exceeds 64 KiB of UTF-8 JSON" });
});

export const platformScheduleOptionSchema = z.object({
  value: nonempty.max(PLATFORM_SCHEDULE_TEXT_MAX),
  label: nonempty,
  description: z.string().nullable(),
  disabled: z.boolean(),
  disabledReason: nonempty.nullable(),
}).strict().refine(
  (option) => option.disabled === (option.disabledReason !== null),
  "A disabled option must explain why it is unavailable",
);

const fieldBase = {
  key: platformScheduleFieldKeySchema,
  label: nonempty,
  required: z.boolean(),
  defaultValue: z.string().max(PLATFORM_SCHEDULE_TEXT_MAX).nullable(),
  help: z.string().nullable(),
};
export const platformScheduleFormFieldSchema = z.discriminatedUnion("type", [
  z.object({
    ...fieldBase,
    type: z.literal("select"),
    refreshOnChange: z.boolean(),
    options: z.array(platformScheduleOptionSchema),
  }).strict(),
  z.object({
    ...fieldBase,
    type: z.literal("text"),
    multiline: z.boolean(),
    placeholder: z.string().nullable(),
    maxLength: z.number().int().min(1).max(PLATFORM_SCHEDULE_TEXT_MAX),
  }).strict(),
]).superRefine((field, ctx) => {
  if (field.type === "select") {
    if (new Set(field.options.map((option) => option.value)).size !== field.options.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Option values must be unique" });
    if (field.defaultValue !== null && !field.options.some((option) => option.value === field.defaultValue && !option.disabled))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The default must name an available option" });
  } else if (field.defaultValue !== null && field.defaultValue.length > field.maxLength) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The default exceeds the field's limit" });
  }
});

export const platformScheduleFieldErrorCodeSchema = z.enum([
  "required", "invalid_option", "invalid_number", "invalid_time", "invalid_array", "value_too_long", "target_unavailable",
]);
export const platformScheduleFieldErrorSchema = z.object({
  /** JSON Pointer: /values/<escaped-key> in a form, /content/<escaped-key> on save. */
  field: z.string().regex(/^(?:\/(?:[^~/]|~[01])*)+$/),
  code: platformScheduleFieldErrorCodeSchema,
  message: nonempty,
}).strict();
export const platformScheduleSummaryItemSchema = z.object({
  key: platformScheduleFieldKeySchema,
  label: nonempty,
  value: z.string(),
}).strict();
const summary = z.array(platformScheduleSummaryItemSchema).max(PLATFORM_SCHEDULE_FIELD_MAX);

export const platformScheduleFormRequestSchema = z.object({
  values: platformScheduleContentSchema,
  changedField: platformScheduleFieldKeySchema.nullable(),
  taskId: runtimeIdSchema.nullable(),
  timeZone: platformScheduleTimeZoneSchema,
}).strict();
/** A complete replacement form. Removed fields and their values must never be merged back by a client. */
export const platformScheduleFormSchema = z.object({
  appId: platformTaskAppSchema,
  formRevision: nonempty,
  fields: z.array(platformScheduleFormFieldSchema).max(PLATFORM_SCHEDULE_FIELD_MAX),
  values: platformScheduleContentSchema,
  summary,
  errors: z.array(platformScheduleFieldErrorSchema),
  submittable: z.boolean(),
}).strict().superRefine((form, ctx) => {
  const keys = form.fields.map((field) => field.key);
  if (new Set(keys).size !== keys.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Field keys must be unique" });
  if (keys.length !== Object.keys(form.values).length || keys.some((key) => !Object.hasOwn(form.values, key)))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Values must match the complete form exactly" });
  if (!form.submittable) return;
  if (form.errors.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "An invalid form cannot be submitted" });
  for (const field of form.fields) {
    const value = form.values[field.key];
    if (value === undefined) continue;
    if (field.required && !value.trim())
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["values", field.key], message: "A required value is missing" });
    if (field.type === "select" && value !== "" && !field.options.some((option) => option.value === value && !option.disabled))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["values", field.key], message: "The selected option is unavailable" });
    if (field.type === "text" && value.length > field.maxLength)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["values", field.key], message: "The value exceeds the field's limit" });
  }
});

export const platformScheduleApplicationSchema = z.object({
  id: platformTaskAppSchema,
  /** The application's scheduling declaration supplies this sentence in the requested Accept-Language. */
  description: z.string().nullable(),
  available: z.boolean(),
  unavailableReason: nonempty.nullable(),
  taskCount: z.number().int().nonnegative().safe(),
}).strict().refine(
  (application) => application.available === (application.unavailableReason === null),
  "An unavailable application must explain why it is unavailable",
);
export const platformScheduleApplicationsSchema = z.object({
  applications: z.array(platformScheduleApplicationSchema),
  /** Counts include private tasks of applications that are no longer installed. */
  totalCount: z.number().int().nonnegative().safe(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.applications.map((application) => application.id)).size !== value.applications.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Application IDs must be unique" });
  if (value.applications.reduce((count, application) => count + application.taskCount, 0) > value.totalCount)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Application counts exceed the total" });
});

export const platformSchedulePauseReasonSchema = z.enum([
  "credential_invalid", "creator_unavailable", "permission_denied", "target_unavailable", "definition_changed", "application_unavailable",
]);
export const platformSchedulePauseSchema = z.object({
  code: platformSchedulePauseReasonSchema,
  message: nonempty,
}).strict();
export const platformScheduleRunErrorCodeSchema = z.enum([
  ...platformSchedulePauseReasonSchema.options,
  "dependency_unavailable", "start_failed", "run_failed", "cancelled", "interrupted", "autotest_busy", "prior_run_active", "legacy_failure",
]);
export const platformScheduleRunErrorSchema = z.object({
  code: platformScheduleRunErrorCodeSchema,
  message: z.string().nullable(),
}).strict();

export const platformScheduleResultLinkSchema = z.object({
  appId: platformTaskAppSchema,
  /** Unprefixed same-origin path, resolved by the host's router. Never a service URL. */
  path: nonempty.refine((path) => {
    try {
      const decoded = decodeURIComponent(path);
      return path.startsWith("/") && decoded.startsWith("/") && !decoded.includes("//") && !decoded.includes("\\")
        && !Array.from(decoded).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127);
    } catch {
      return false;
    }
  }, "Expected an unprefixed same-origin result path"),
}).strict();

const definition = z.object({
  title,
  appId: platformTaskAppSchema,
  content: platformScheduleContentSchema,
  formRevision: nonempty,
  frequency: platformTaskFrequencySchema,
  timeZone: platformScheduleTimeZoneSchema,
  notifyEmail: z.string().max(320).email().nullable(),
}).strict();
export const platformTaskInputSchema = definition.extend({ timeZone: platformScheduleTimeZoneSchema.optional() }).strict();
export const platformTaskUpdateSchema = platformTaskInputSchema.extend({ revision }).strict();
export const platformTaskEnabledSchema = z.object({ enabled: z.boolean(), revision }).strict();
export const platformTaskListQuerySchema = z.object({ appId: platformTaskAppSchema.optional() }).strict();
export const platformTaskCreateQuerySchema = z.object({ enabled: z.boolean().default(true) }).strict();
export const platformTaskRunPageQuerySchema = z.object({
  cursor: nonempty.optional(),
  limit: z.number().int().min(1).max(100).default(20),
}).strict();
export const platformScheduleIdempotencyKeySchema = runtimeIdSchema;
/** DELETE uses this quoted revision in If-Match; PUT carries the same revision as a number. */
export const platformTaskIfMatchSchema = z.string().regex(/^"[1-9]\d*"$/).refine(
  (value) => Number.isSafeInteger(Number(value.slice(1, -1))),
  "Expected a quoted positive revision",
);

export const platformTaskRunStatusSchema = z.enum(["running", "completed", "failed", "skipped"]);
const runSummary = z.object({
  id: runtimeIdSchema,
  taskId: runtimeIdSchema,
  trigger: z.enum(["manual", "schedule", "unknown"]),
  status: platformTaskRunStatusSchema,
  scheduledAt: runtimeTimestampSchema.nullable(),
  startedAt: runtimeTimestampSchema,
  finishedAt: runtimeTimestampSchema.nullable(),
  error: platformScheduleRunErrorSchema.nullable(),
  resultSummary: z.string().nullable(),
  resultLink: platformScheduleResultLinkSchema.nullable(),
  spendTime: z.number().int().nonnegative().safe().nullable(),
}).strict();
function checkOutcome(value: {
  status: z.infer<typeof platformTaskRunStatusSchema>;
  error: z.infer<typeof platformScheduleRunErrorSchema> | null;
}, ctx: z.RefinementCtx) {
  if ((value.status === "failed" || value.status === "skipped") !== (value.error !== null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Failed and skipped executions require a reason" });
  const skipped = value.error?.code === "autotest_busy" || value.error?.code === "prior_run_active";
  if ((value.status === "skipped") !== skipped)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A skip reason belongs to a skipped execution" });
}
function checkRun(value: z.infer<typeof runSummary>, ctx: z.RefinementCtx) {
  checkOutcome(value, ctx);
  if ((value.status === "running") !== (value.finishedAt === null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only a running execution has no finish time" });
}
export const platformTaskRunSummarySchema = runSummary.superRefine(checkRun);
export const platformTaskRunSnapshotSchema = definition.pick({
  title: true, appId: true, content: true, formRevision: true, timeZone: true,
}).extend({
  creatorId: nonempty,
  summary,
  locale: nonempty,
  taskRevision: revision,
}).strict();
export const platformTaskRunSchema = runSummary.extend({
  snapshot: platformTaskRunSnapshotSchema,
  result: z.string().nullable(),
  /** Application-owned read-only JSON, such as the parameters resolved at the actual start time. */
  executionDetails: runtimeJsonObjectSchema.nullable(),
}).strict().superRefine(checkRun);
export const platformTaskSchema = definition.extend({
  id: runtimeIdSchema,
  creatorId: nonempty,
  summary,
  enabled: z.boolean(),
  pause: platformSchedulePauseSchema.nullable(),
  nextRunAt: runtimeTimestampSchema.nullable(),
  revision,
  createdAt: runtimeTimestampSchema,
  updatedAt: runtimeTimestampSchema,
  activeRunId: runtimeIdSchema.nullable(),
  lastRun: platformTaskRunSummarySchema.nullable(),
  latestResult: z.object({ runId: runtimeIdSchema, link: platformScheduleResultLinkSchema }).strict().nullable(),
}).strict().superRefine((task, ctx) => {
  if ((!task.enabled || task.pause !== null) && task.nextRunAt !== null)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Disabled or paused tasks have no next slot" });
  if (!task.enabled && task.pause !== null)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A user-disabled task has no system pause" });
  if (task.lastRun && task.lastRun.taskId !== task.id)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The latest execution belongs to another task" });
  if (task.lastRun?.status === "running" && task.activeRunId !== task.lastRun.id)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A running latest execution must be the active one" });
});
export const platformTaskListSchema = z.object({ tasks: z.array(platformTaskSchema), timeZone: platformScheduleTimeZoneSchema }).strict();
export const platformTaskRunPageSchema = z.object({ runs: z.array(platformTaskRunSchema), nextCursor: nonempty.nullable() }).strict();

export const platformScheduleHttpErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "UNAUTHENTICATED", "PERMISSION_DENIED", "INTERACTIVE_LOGIN_REQUIRED", "TASK_NOT_FOUND", "APPLICATION_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT", "REVISION_CONFLICT", "TASK_RUNNING", "TASK_LIMIT_REACHED", "FORM_CHANGED",
  "FIELD_VALIDATION_FAILED", "TARGET_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE",
]);
export const platformScheduleErrorSchema = z.object({
  error: z.object({
    code: platformScheduleHttpErrorCodeSchema,
    message: nonempty,
    fields: z.array(platformScheduleFieldErrorSchema).optional(),
    form: platformScheduleFormSchema.optional(),
    activeRunId: runtimeIdSchema.optional(),
  }).strict(),
  correlationId: nonempty,
}).strict().superRefine((value, ctx) => {
  if ((value.error.code === "FORM_CHANGED") !== (value.error.form !== undefined))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only FORM_CHANGED carries a required replacement form" });
});

/** Workbench-only declaration discovery. No form options or business definitions are copied into the registry. */
export const platformScheduleDeclarationsSchema = z.object({ appIds: z.array(platformTaskAppSchema) }).strict().refine(
  (value) => new Set(value.appIds).size === value.appIds.length,
  "Application IDs must be unique",
);
export const platformScheduleValidationRequestSchema = z.object({
  content: platformScheduleContentSchema,
  formRevision: nonempty,
  timeZone: platformScheduleTimeZoneSchema,
}).strict();
/** References are opaque application-owned JSON. The platform does not interpret function or action IDs. */
export const platformScheduleValidationSchema = platformScheduleValidationRequestSchema.extend({
  summary,
  references: runtimeJsonObjectSchema.nullable(),
}).strict();
export const platformScheduleExecutionRequestSchema = definition.pick({
  title: true, appId: true, content: true, formRevision: true, timeZone: true,
}).extend({
  taskId: runtimeIdSchema,
  runId: runtimeIdSchema,
  locale: nonempty,
  trigger: z.enum(["manual", "schedule"]),
  scheduledAt: runtimeTimestampSchema.nullable(),
  admittedAt: runtimeTimestampSchema,
}).strict();
export const platformScheduleHandleSchema = runtimeJsonObjectSchema.refine(
  (value) => byteLength(value) <= PLATFORM_SCHEDULE_HANDLE_MAX_BYTES,
  "Execution handles must fit in 8 KiB of UTF-8 JSON",
);
export const platformScheduleExecutionStateSchema = z.object({
  status: platformTaskRunStatusSchema,
  handle: platformScheduleHandleSchema.nullable(),
  resultLink: platformScheduleResultLinkSchema.nullable(),
  resultSummary: z.string().nullable(),
  result: z.string().nullable(),
  spendTime: z.number().int().nonnegative().safe().nullable(),
  error: platformScheduleRunErrorSchema.nullable(),
  pause: platformSchedulePauseSchema.nullable(),
  executionDetails: runtimeJsonObjectSchema.nullable(),
}).strict().superRefine((state, ctx) => {
  checkOutcome(state, ctx);
  if (state.pause !== null && state.status !== "failed")
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only a failed execution can pause a task" });
});
/** Service-authenticated status reads verify the persisted owner and never admit or repair an execution. */
export const platformScheduleExecutionStatusRequestSchema = z.object({
  taskId: runtimeIdSchema,
  runId: runtimeIdSchema,
  owner: z.object({ userId: nonempty, domainId: nonempty }).strict(),
  handle: platformScheduleHandleSchema.nullable(),
}).strict();

export type PlatformTaskApp = z.infer<typeof platformTaskAppSchema>;
export type PlatformTaskFrequency = z.infer<typeof platformTaskFrequencySchema>;
export type PlatformScheduleContent = z.infer<typeof platformScheduleContentSchema>;
export type PlatformScheduleOption = z.infer<typeof platformScheduleOptionSchema>;
export type PlatformScheduleFormField = z.infer<typeof platformScheduleFormFieldSchema>;
export type PlatformScheduleFieldErrorCode = z.infer<typeof platformScheduleFieldErrorCodeSchema>;
export type PlatformScheduleFieldError = z.infer<typeof platformScheduleFieldErrorSchema>;
export type PlatformScheduleSummaryItem = z.infer<typeof platformScheduleSummaryItemSchema>;
export type PlatformScheduleFormRequest = z.infer<typeof platformScheduleFormRequestSchema>;
export type PlatformScheduleForm = z.infer<typeof platformScheduleFormSchema>;
export type PlatformScheduleApplication = z.infer<typeof platformScheduleApplicationSchema>;
export type PlatformScheduleApplications = z.infer<typeof platformScheduleApplicationsSchema>;
export type PlatformSchedulePauseReason = z.infer<typeof platformSchedulePauseReasonSchema>;
export type PlatformSchedulePause = z.infer<typeof platformSchedulePauseSchema>;
export type PlatformScheduleRunErrorCode = z.infer<typeof platformScheduleRunErrorCodeSchema>;
export type PlatformScheduleRunError = z.infer<typeof platformScheduleRunErrorSchema>;
export type PlatformScheduleResultLink = z.infer<typeof platformScheduleResultLinkSchema>;
export type PlatformTaskInput = z.infer<typeof platformTaskInputSchema>;
export type PlatformTaskUpdate = z.infer<typeof platformTaskUpdateSchema>;
export type PlatformTaskEnabled = z.infer<typeof platformTaskEnabledSchema>;
export type PlatformTaskListQuery = z.infer<typeof platformTaskListQuerySchema>;
export type PlatformTaskCreateQuery = z.input<typeof platformTaskCreateQuerySchema>;
export type PlatformTaskRunPageQuery = z.input<typeof platformTaskRunPageQuerySchema>;
export type PlatformTaskRunStatus = z.infer<typeof platformTaskRunStatusSchema>;
export type PlatformTaskRunSummary = z.infer<typeof platformTaskRunSummarySchema>;
export type PlatformTaskRunSnapshot = z.infer<typeof platformTaskRunSnapshotSchema>;
export type PlatformTaskRun = z.infer<typeof platformTaskRunSchema>;
export type PlatformTask = z.infer<typeof platformTaskSchema>;
export type PlatformTaskList = z.infer<typeof platformTaskListSchema>;
export type PlatformTaskRunPage = z.infer<typeof platformTaskRunPageSchema>;
export type PlatformScheduleHttpErrorCode = z.infer<typeof platformScheduleHttpErrorCodeSchema>;
export type PlatformScheduleError = z.infer<typeof platformScheduleErrorSchema>;
export type PlatformScheduleDeclarations = z.infer<typeof platformScheduleDeclarationsSchema>;
export type PlatformScheduleValidationRequest = z.infer<typeof platformScheduleValidationRequestSchema>;
export type PlatformScheduleValidation = z.infer<typeof platformScheduleValidationSchema>;
export type PlatformScheduleExecutionRequest = z.infer<typeof platformScheduleExecutionRequestSchema>;
export type PlatformScheduleHandle = z.infer<typeof platformScheduleHandleSchema>;
export type PlatformScheduleExecutionState = z.infer<typeof platformScheduleExecutionStateSchema>;
export type PlatformScheduleExecutionStatusRequest = z.infer<typeof platformScheduleExecutionStatusRequestSchema>;
