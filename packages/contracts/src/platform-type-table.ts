import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeKeySchema } from "./agent-runtime-values";
import { panelOperationDeclarationSchema, panelReadResultIdSchema, type PanelOperationDeclaration } from "./panel-operations";
import { panelReadParameterSchemas } from "./panel-projection";
import { platformOntologyLayers, type PanelReadParameterId } from "./platform-object-types";

const readParameterIdSchema = z.custom<PanelReadParameterId>(
  value => typeof value === "string" && Object.hasOwn(panelReadParameterSchemas, value),
  "Expected a registered panel read parameter ID",
);
export const panelReadOutputTypeSchema = z.object({
  kind: z.literal("scalar"),
  type: z.enum(["boolean", "string", "number"]),
}).strict();

function typeReadDeclarationSchema<ResultId extends string>(result: z.ZodType<ResultId>) {
  const readDeclaration = {
    source: z.enum(["type", "object"]),
    result,
    rowType: runtimeKeySchema.optional(),
    outputs: z.record(runtimeKeySchema, panelReadOutputTypeSchema).optional(),
  };
  return z.discriminatedUnion("parameterMode", [
    z.object({
      ...readDeclaration,
      parameterMode: z.literal("fixed"),
      params: z.record(runtimeKeySchema, readParameterIdSchema),
      requiredParams: z.array(runtimeKeySchema).optional(),
    }).strict(),
    z.object({
      ...readDeclaration,
      parameterMode: z.literal("owner"),
      parameter: readParameterIdSchema,
    }).strict(),
  ]);
}

export const platformTypeReadDeclarationSchema = typeReadDeclarationSchema(z.lazy(() => panelReadResultIdSchema));
// The graph response is itself a registered read result. Keep its read IDs as strings in the wire type.
export type PlatformTypeReadDeclaration = z.infer<ReturnType<typeof typeReadDeclarationSchema<string>>>;

export const platformTypeTableEntrySchema = z.object({
  labelKey: runtimeKeySchema.optional(),
  layer: z.enum(platformOntologyLayers).optional(),
  reads: z.record(runtimeKeySchema, platformTypeReadDeclarationSchema).optional(),
  operations: z.array(z.lazy(() => panelOperationDeclarationSchema)).optional(),
  childCollections: z.array(runtimeKeySchema).optional(),
}).strict();
export type PlatformTypeTableEntry = z.infer<typeof platformTypeTableEntrySchema>;

export type PlatformTypeTableOperation = PanelOperationDeclaration & {
  /** Customer object types declared as affected by this targetless operation. */
  affects?: string[];
};
export const platformTypeTableOperationSchema: z.ZodType<PlatformTypeTableOperation> = z.lazy(() =>
  panelOperationDeclarationSchema.extend({
    /** Customer object types declared as affected by this targetless operation. */
    affects: z.array(runtimeKeySchema).optional(),
  }).strict(),
);

const unavailableObjectActionSchema = z.object({
  id: runtimeKeySchema,
  objectType: runtimeKeySchema.optional(),
  reason: z.string().min(1),
}).strict();
export type UnavailableObjectAction = z.infer<typeof unavailableObjectActionSchema>;

/** The authenticated author catalogue, keyed by the owner type's ID. */
export const platformTypeTableResponseSchema = z.object({
  objectTypes: z.record(runtimeKeySchema, platformTypeTableEntrySchema),
  /** Targetless domain operations (such as creation or global Actions), listed once by unique ID. */
  operations: z.array(z.lazy(() => platformTypeTableOperationSchema)).optional(),
  /** Standalone JSON Schemas for the distinct result IDs referenced by the returned reads. */
  resultSchemas: z.record(z.lazy(() => panelReadResultIdSchema), runtimeJsonObjectSchema),
  /** Broken published actions have no executable declaration. A missing target has no object type. */
  unavailableActions: z.array(unavailableObjectActionSchema).optional(),
  /** The owner refused the class catalogue without returning class identities. */
  customerTypesUnavailable: z.object({ reason: z.string().min(1) }).strict().optional(),
}).strict().superRefine(({ objectTypes, operations, resultSchemas }, ctx) => {
  for (const [typeId, entry] of Object.entries(objectTypes)) {
    for (const [name, { result }] of Object.entries(entry.reads ?? {})) {
      if (!Object.hasOwn(resultSchemas, result)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["objectTypes", typeId, "reads", name, "result"],
          message: `Read result '${result}' has no declared schema` });
      }
    }
  }
  const seenOperations = new Set<string>();
  for (const [index, operation] of (operations ?? []).entries()) {
    if (seenOperations.has(operation.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operations", index, "id"],
        message: `Duplicate top-level operation '${operation.id}'` });
    }
    seenOperations.add(operation.id);
  }
});
export type PlatformTypeTableResponse = z.infer<typeof platformTypeTableResponseSchema>;
