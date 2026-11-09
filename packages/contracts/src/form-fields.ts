import { z } from "zod";

/*
 * A form as its owner declares it: text fields and choices, whose values travel as text and are interpreted only by
 * the owner (a scheduled task's application, an Action). Limits belong to each protocol that carries these shapes.
 */

const nonempty = z.string().min(1);

/** One choice of a select field; an unavailable one stays listed, with why. */
export const formOptionSchema = z.object({
  value: nonempty,
  label: nonempty,
  description: z.string().nullable(),
  disabled: z.boolean(),
  disabledReason: nonempty.nullable(),
}).strict().refine(
  (option) => option.disabled === (option.disabledReason !== null),
  "A disabled option must explain why it is unavailable",
);

const fieldBase = {
  key: nonempty,
  label: nonempty,
  required: z.boolean(),
  defaultValue: z.string().nullable(),
  help: z.string().nullable(),
};
export const formFieldSchema = z.discriminatedUnion("type", [
  z.object({
    ...fieldBase,
    type: z.literal("select"),
    refreshOnChange: z.boolean(),
    options: z.array(formOptionSchema),
  }).strict(),
  z.object({
    ...fieldBase,
    type: z.literal("text"),
    multiline: z.boolean(),
    placeholder: z.string().nullable(),
    maxLength: z.number().int().min(1),
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

/** Every field's value as text, by field key. */
export const formValuesSchema = z.record(nonempty, z.string());

export const formFieldErrorCodeSchema = z.enum([
  "required", "invalid_option", "invalid_number", "invalid_time", "invalid_array", "invalid_object", "value_too_long",
  "target_unavailable",
]);
export const formFieldErrorSchema = z.object({
  /** JSON Pointer to the value: /values/<escaped-key> in a form, /content/<escaped-key> in a saved scheduled task. */
  field: z.string().regex(/^(?:\/(?:[^~/]|~[01])*)+$/),
  code: formFieldErrorCodeSchema,
  message: nonempty,
}).strict();

/** The JSON Pointer to a field's value under `prefix` (`/values/` or `/content/`). */
export function formFieldPointer(prefix: string, key: string): string {
  return prefix + key.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** The field key a JSON Pointer names under `prefix`, unescaped; null when it points elsewhere. */
export function formFieldKey(pointer: string, prefix: string): string | null {
  if (!pointer.startsWith(prefix)) return null;
  return pointer.slice(prefix.length).split("/")[0]!.replaceAll("~1", "/").replaceAll("~0", "~");
}

export type FormOption = z.infer<typeof formOptionSchema>;
export type FormField = z.infer<typeof formFieldSchema>;
export type FormValues = z.infer<typeof formValuesSchema>;
export type FormFieldErrorCode = z.infer<typeof formFieldErrorCodeSchema>;
export type FormFieldError = z.infer<typeof formFieldErrorSchema>;
