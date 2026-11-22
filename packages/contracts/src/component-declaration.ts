import { z } from "zod";

const name = z.string().min(1);
const componentPortSchema = z.object({
  name,
  type: z.string(),
  description: z.string(),
}).strict();
const componentPropSchema = componentPortSchema.extend({
  required: z.boolean(),
  default: z.string().optional(),
});
const componentConfigSchema = z.array(componentPropSchema);
/** Use named entries, or a single optional "*" entry for all datum names declared by a projection. */
export const componentDataSchema = <Result extends z.ZodTypeAny>(result: Result) => z.record(name, z.object({
  results: z.array(result).min(1),
  required: z.boolean(),
  /** Read parameters this component can supply for this datum at runtime. */
  runtimeParams: z.array(name).optional(),
}).strict()).superRefine((data, ctx) => {
  if (!Object.hasOwn(data, "*")) return;
  if (Object.keys(data).length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["*"], message: "Wildcard data cannot be combined with named entries" });
  }
  if (data["*"].required) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["*", "required"], message: "Wildcard data cannot be required" });
  }
});

export const componentDeclarationBase = <Data extends z.ZodTypeAny, Input extends z.ZodTypeAny, Output extends z.ZodTypeAny>(
  data: Data, input: Input, output: Output,
) => z.object({
  componentId: name,
  role: z.enum(["presentation", "control"]),
  meaning: name,
  effects: z.string().optional(),
  bindsElement: z.array(name).optional(),
  /** Omit this declaration for components that do not consume platform-supplied data. */
  data: data.optional(),
  config: componentConfigSchema.optional(),
  inputs: z.record(name, input).optional(),
  /** State bindings use typed outputs. Event-only signals are listed in ports.events. */
  outputs: z.record(name, output).optional(),
  ports: z.object({
    props: componentConfigSchema,
    events: z.array(componentPortSchema),
    slots: z.array(componentPortSchema),
  }).strict(),
}).strict();

export type { ComponentDeclaration } from "./apps-sdk";
