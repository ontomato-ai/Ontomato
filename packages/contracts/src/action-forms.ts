import { z } from "zod";
import { formFieldErrorSchema, formFieldSchema, formValuesSchema } from "./form-fields";

/*
 * An Action's form, `POST /api/data-query/action/form` in the data engine's `{success, data, message}` envelope. The
 * data engine owns how each parameter becomes a field and how the text in a field becomes a value; a page only draws
 * the fields. Opening the form (no `values`) answers its fields and their initial text; submitting what the fields
 * hold answers the field errors, or the typed parameters that the existing `/action/execute` takes.
 */

export const actionFormRequestSchema = z.object({
  id: z.string().min(1),
  /** Values the page binds, by parameter name; they are the fields' initial text. */
  parameters: z.record(z.string(), z.unknown()).optional(),
  /** What the fields hold, by parameter name; absent when the form opens. */
  values: formValuesSchema.optional(),
  /** Bound parameters shown but not typed into; their bound values are submitted as bound. Not a permission. */
  readOnlyParameters: z.array(z.string()).optional(),
}).strict();

export const actionFormSchema = z.object({
  fields: z.array(formFieldSchema),
  values: formValuesSchema,
  errors: z.array(formFieldErrorSchema),
  /** The typed parameters for `/action/execute` once every value is valid; null on opening or while one is invalid. */
  parameters: z.record(z.string(), z.unknown()).nullable(),
}).strict().superRefine((form, ctx) => {
  const keys = form.fields.map((field) => field.key);
  if (keys.length !== Object.keys(form.values).length || keys.some((key) => !Object.hasOwn(form.values, key)))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Values must match the fields exactly" });
  if (form.parameters !== null && form.errors.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A form with field errors has no parameters" });
});

export type ActionFormRequest = z.infer<typeof actionFormRequestSchema>;
export type ActionForm = z.infer<typeof actionFormSchema>;
