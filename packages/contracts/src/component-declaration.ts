import { z } from "zod";
import { directPanelPortTypeSchema } from "./panel-manifest";
import { panelReadResultIdSchema } from "./panel-operations";
import { directProjectionInputTypeSchema, panelLocalOperationNameSchema } from "./panel-projection";
import { componentIdSchema } from "./product-record-id";

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
export const appsSdkComponentDataSchema = z.record(name, z.object({
  results: z.array(z.lazy(() => panelReadResultIdSchema)).min(1),
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
export type AppsSdkComponentData = z.infer<typeof appsSdkComponentDataSchema>;

/** Resolve the catalogue declaration for a projection's datum. */
export function appsSdkComponentDatum(
  data: AppsSdkComponentData | undefined,
  datum: string,
): AppsSdkComponentData[string] | undefined {
  return data && Object.hasOwn(data, datum) ? data[datum] : data?.["*"];
}

export const componentDeclarationBaseSchema = z.object({
  componentId: name,
  role: z.enum(["presentation", "control"]),
  meaning: name,
  effects: z.string().optional(),
  bindsElement: z.array(name).optional(),
  /** Omit this declaration for components that do not consume platform-supplied data. */
  data: appsSdkComponentDataSchema.optional(),
  config: componentConfigSchema.optional(),
  inputs: z.record(name, z.lazy(() => directProjectionInputTypeSchema)).optional(),
  /** State bindings use typed outputs. Event-only signals are listed in ports.events. */
  outputs: z.record(name, z.lazy(() => directPanelPortTypeSchema)).optional(),
  ports: z.object({
    props: componentConfigSchema,
    events: z.array(componentPortSchema),
    slots: z.array(componentPortSchema),
  }).strict(),
}).strict();

export const componentDeclarationSchema = componentDeclarationBaseSchema.extend({
  componentId: componentIdSchema,
  operations: z.array(z.object({
    name: z.lazy(() => panelLocalOperationNameSchema),
    handlerRef: z.string().trim().min(1),
  }).strict()).optional(),
});

export type ComponentDeclaration = z.infer<typeof componentDeclarationSchema>;
