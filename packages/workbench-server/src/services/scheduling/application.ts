import { createHash } from "node:crypto";
import { formFieldPointer, type FormField, type FormOption } from "@ontomato/contracts/form-fields";
import {
  PLATFORM_SCHEDULE_TEXT_MAX,
  platformScheduleFormSchema,
  type PlatformScheduleContent,
  type PlatformScheduleExecutionRequest,
  type PlatformScheduleExecutionState,
  type PlatformScheduleExecutionStatusRequest,
  type PlatformScheduleForm,
  type PlatformScheduleFormRequest,
  type PlatformScheduleSummaryItem,
  type PlatformScheduleValidation,
  type PlatformScheduleValidationRequest,
} from "@ontomato/contracts/platform-schedules";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { AgentHostOwner } from "../agent-host/types";
import { HttpError } from "../../utils/errors";

export interface ScheduleContext { owner: AgentHostOwner; credentials: AssistantCredentials }
export interface ScheduleApplication {
  id: string;
  description(locale?: string): string | null;
  authorize(context: ScheduleContext): Promise<void>;
  form(input: PlatformScheduleFormRequest, context: ScheduleContext): Promise<PlatformScheduleForm>;
  validate(input: PlatformScheduleValidationRequest, context: ScheduleContext): Promise<PlatformScheduleValidation>;
  start(input: PlatformScheduleExecutionRequest, context: ScheduleContext): Promise<PlatformScheduleExecutionState>;
  status(input: PlatformScheduleExecutionStatusRequest): Promise<PlatformScheduleExecutionState>;
}

export const option = (value: string, label: string, reason: string | null = null, description: string | null = null): FormOption => ({
  value, label, description, disabled: reason !== null, disabledReason: reason,
});
export const select = (key: string, label: string, options: FormOption[], refreshOnChange = false, defaultValue: string | null = null): FormField => ({
  key, label, options, refreshOnChange, defaultValue, type: "select", required: true, help: null,
});
export const instruction = (label: string): FormField => ({
  key: "instruction", label, type: "text", required: true, defaultValue: null, help: null,
  multiline: true, placeholder: null, maxLength: PLATFORM_SCHEDULE_TEXT_MAX,
});

export function completeForm(appId: string, formRevision: string, fields: FormField[], source: PlatformScheduleContent, labels: Record<string, string> = {}): PlatformScheduleForm {
  const values = Object.fromEntries(fields.map((field) => [field.key, source[field.key] ?? field.defaultValue ?? ""]));
  const errors: PlatformScheduleForm["errors"] = [];
  for (const field of fields) {
    const value = values[field.key];
    if (field.type === "select" && value && !field.options.some((item) => item.value === value && !item.disabled))
      errors.push({ field: formFieldPointer("/values/", field.key), code: "target_unavailable", message: field.options.find((item) => item.value === value)?.disabledReason ?? "The selected target is unavailable" });
  }
  const summary: PlatformScheduleSummaryItem[] = fields.filter((field) => values[field.key]).map((field) => ({
    key: field.key, label: field.label,
    value: field.type === "select" ? field.options.find((item) => item.value === values[field.key])?.label ?? values[field.key] : values[field.key].slice(0, 160),
  }));
  for (const item of summary) if (labels[item.key]) item.value = labels[item.key];
  return platformScheduleFormSchema.parse({
    appId, formRevision, fields, values, summary, errors,
    submittable: !errors.length && fields.every((field) => !field.required || Boolean(values[field.key].trim())),
  });
}

export function checkedForm(input: PlatformScheduleValidationRequest, form: PlatformScheduleForm): PlatformScheduleValidation {
  if (input.formRevision !== form.formRevision)
    throw new HttpError(409, "The form changed; review its current fields", "FORM_CHANGED", { form });
  const expected = Object.keys(form.values);
  if (expected.length !== Object.keys(input.content).length || expected.some((key) => !Object.hasOwn(input.content, key)))
    throw new HttpError(422, "Content must match the current form fields", "FIELD_VALIDATION_FAILED");
  const errors = form.errors.map((error) => ({ ...error, field: error.field.replace(/^\/values\//, "/content/") }));
  for (const field of form.fields)
    if (field.required && !form.values[field.key].trim())
      errors.push({ field: formFieldPointer("/content/", field.key), code: "required", message: `${field.label} is required` });
  if (errors.length) throw new HttpError(422, "Check the form values", "FIELD_VALIDATION_FAILED", { fields: errors });
  return { content: form.values, formRevision: form.formRevision, timeZone: input.timeZone, summary: form.summary, references: null };
}

/** Match Java UUID.nameUUIDFromBytes so status recovery works even when the admission response was lost. */
export function scheduledSessionId(runId: string): string {
  const bytes = createHash("md5").update(`platform-task-session:${runId}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function emptyExecution(status: PlatformScheduleExecutionState["status"] = "running"): PlatformScheduleExecutionState {
  return { status, handle: null, resultLink: null, resultSummary: null, result: null, spendTime: null, error: null, pause: null, executionDetails: null };
}
