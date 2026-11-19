import { z } from "zod";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/panel-client-requests";
import { HttpError } from "../../utils/errors";
import type { PanelOperationHost, PanelOperationTarget, PanelServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";

/*
 * The ontology model's owner-side server clients: what a panel's form save means when an agent initiates it. Each
 * operation posts the Java owner's own create or update request through the data-query gateway; the owner decides
 * every field, option and refusal. The three clients differ only in their paths, their bodies and the view each one
 * answers with — the shared shape (target identity split out of the primary key, the owner's refusal carried whole)
 * is written once below.
 */

/** The gateway prefix the coordinator's data-query request path starts with. */
const gateway = "/api/data-query/ontology/model";

const inputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
/** A page draft's form is the values themselves, without the intent call's `values` wrapper. */
const formValues = panelFormSaveInputSchema.shape.values;

const objectTypeViewSchema = z.object({
  className: z.string(), showName: z.string(), classDesc: z.string(),
  attributeCount: z.number(), businessKeyCount: z.number(), relationshipCount: z.number(),
  primaryKey: runtimeJsonObjectSchema,
}).strict();
const attributeViewSchema = z.object({
  className: z.string(), name: z.string(), showName: z.string(), type: z.string(), attrDesc: z.string(),
  enable: z.boolean(), businessKey: z.boolean(), primaryKey: z.boolean(),
}).strict();
const relationshipViewSchema = z.object({
  relationship: z.string(), fromclass: z.string(), toclass: z.string(), desc: z.string(),
  fromField: z.string(), toField: z.string(),
}).strict();

/** One type's form target: an existing object of that type, or the create draft. */
const targets = (type: string) => z.discriminatedUnion("kind", [
  panelFormTargetSchema.options[0].extend({ objectType: z.literal(type), primaryKey: z.string().min(1) }).strict(),
  panelFormTargetSchema.options[1],
]);

/** The attribute a target names, by the two-part key the owner's reads and forms use. */
const attributeIdentity = (view: z.infer<typeof attributeViewSchema>): PanelObjectIdentity =>
  ({ objectType: ATTRIBUTE, primaryKey: JSON.stringify([view.className, view.name]) });

/** The owner's refusal, carried whole: its code and message, and the per-field list it answered with. */
async function refusal(response: Response): Promise<SinglePanelOperationOutcome> {
  const error = ((await response.json()) as { error?: { code?: string; message?: string; fields?: unknown } }).error;
  if (!error?.code || !error.message) {
    throw new HttpError(response.status, "The ontology model service refused without a reason", "MODEL_ERROR");
  }
  return { kind: "failure", code: error.code, message: error.message, details: runtimeJsonObjectSchema.parse(error) };
}

/**
 * The three saves, each one operation the panel's form publishes (`<objectType>.save`, the handler the SDK's
 * resource module registers). `affected.objects` names what the save wrote; `objectTypes` also names the types
 * whose derived views the write reached — a new class carries its primary-key attribute with it, an attribute
 * changes its owner type's counts, a new relationship reaches both of its ends.
 */
export const ontologyModelServerOperations = [
  {
    handlerRef: `${OBJECT_TYPE}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: OBJECT_TYPE },
    effect: "write",
    batch: false,
    targetType: OBJECT_TYPE,
    targetSchema: targets(OBJECT_TYPE),
    inputSchema,
    resultSchema: objectTypeViewSchema,
    draftOperation: (target: PanelOperationTarget) => (target.kind === "draft" ? "objectType.create" : "objectType.update"),
    draftInput: (input: Record<string, unknown>) => inputSchema.parse(input).values,
    formInstructions: "Read the object type's form for the intended target. Use its fields and option sources, save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.",
    create: {
      draftValues: (values: unknown, _domainId: string) => formValues.parse(values),
      createdObject: (data: unknown) => ({ objectType: OBJECT_TYPE, primaryKey: objectTypeViewSchema.parse(data).className }),
    },
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, _intentId: string): Promise<SinglePanelOperationOutcome> {
      const values = inputSchema.parse(input).values;
      const body = target.kind === "draft"
        ? { className: values.className, primaryKeyName: values.primaryKeyName, showName: values.showName, classDesc: values.classDesc }
        : { className: target.primaryKey, showName: values.showName, classDesc: values.classDesc };
      const response = await host.request(`${gateway}/object-type/${target.kind === "draft" ? "create" : "update"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) return refusal(response);
      const data = objectTypeViewSchema.parse(await response.json());
      return { kind: "success", data, affected: {
        objects: [{ objectType: OBJECT_TYPE, primaryKey: data.className }],
        objectTypes: target.kind === "draft" ? [OBJECT_TYPE, ATTRIBUTE] : [OBJECT_TYPE],
      } };
    },
  },
  {
    handlerRef: `${ATTRIBUTE}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: ATTRIBUTE },
    effect: "write",
    batch: false,
    targetType: ATTRIBUTE,
    targetSchema: targets(ATTRIBUTE),
    inputSchema,
    resultSchema: attributeViewSchema,
    draftOperation: (target: PanelOperationTarget) => (target.kind === "draft" ? "attribute.create" : "attribute.update"),
    draftInput: (input: Record<string, unknown>) => inputSchema.parse(input).values,
    formInstructions: "Read the attribute's form for the intended target. Use its fields and option sources, save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.",
    create: {
      draftValues: (values: unknown, _domainId: string) => formValues.parse(values),
      createdObject: (data: unknown) => attributeIdentity(attributeViewSchema.parse(data)),
    },
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, _intentId: string): Promise<SinglePanelOperationOutcome> {
      const values = inputSchema.parse(input).values;
      let body: Record<string, unknown>;
      if (target.kind === "draft") {
        body = { className: values.className, name: values.name, showName: values.showName, type: values.type,
          attrDesc: values.attrDesc, enable: values.enable, businessKey: values.businessKey, primaryKey: values.primaryKey };
      } else {
        const [className, name] = JSON.parse(target.primaryKey) as [string, string];
        body = { className, name, showName: values.showName, attrDesc: values.attrDesc,
          enable: values.enable, businessKey: values.businessKey };
      }
      const response = await host.request(`${gateway}/attribute/${target.kind === "draft" ? "create" : "update"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) return refusal(response);
      const data = attributeViewSchema.parse(await response.json());
      return { kind: "success", data, affected: {
        objects: [attributeIdentity(data)],
        objectTypes: [ATTRIBUTE, OBJECT_TYPE],
      } };
    },
  },
  {
    handlerRef: `${RELATIONSHIP}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: RELATIONSHIP },
    effect: "write",
    batch: false,
    targetType: RELATIONSHIP,
    targetSchema: targets(RELATIONSHIP),
    inputSchema,
    resultSchema: relationshipViewSchema,
    draftOperation: (target: PanelOperationTarget) => (target.kind === "draft" ? "relationship.create" : "relationship.update"),
    draftInput: (input: Record<string, unknown>) => inputSchema.parse(input).values,
    formInstructions: "Read the relationship's form for the intended target. Use its fields and the options its ends offer, save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.",
    create: {
      draftValues: (values: unknown, _domainId: string) => formValues.parse(values),
      createdObject: (data: unknown) => ({ objectType: RELATIONSHIP, primaryKey: relationshipViewSchema.parse(data).relationship }),
    },
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>, _intentId: string): Promise<SinglePanelOperationOutcome> {
      const values = inputSchema.parse(input).values;
      const body = target.kind === "draft"
        ? { relationship: values.relationship, fromclass: values.fromclass, toclass: values.toclass,
            desc: values.desc, fromField: values.fromField, toField: values.toField }
        : { relationship: target.primaryKey, desc: values.desc, fromField: values.fromField, toField: values.toField };
      const response = await host.request(`${gateway}/relationship/${target.kind === "draft" ? "create" : "update"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) return refusal(response);
      const data = relationshipViewSchema.parse(await response.json());
      return { kind: "success", data, affected: {
        objects: [{ objectType: RELATIONSHIP, primaryKey: data.relationship }],
        objectTypes: target.kind === "draft" ? [RELATIONSHIP, OBJECT_TYPE] : [RELATIONSHIP],
      } };
    },
  },
] satisfies readonly PanelServerOperation[];
