import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { formFieldKey } from "@ontomato/contracts/form-fields";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { panelFormTargetSchema, type PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import {
  ATTRIBUTE,
  DELETE_ATTRIBUTE,
  DELETE_OBJECT_TYPE,
  DELETE_RELATIONSHIP,
  OBJECT_TYPE,
  RELATIONSHIP,
  SET_PRIMARY_KEY,
} from "@ontomato/contracts/platform-object-types";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import type {
  PanelImpactInspector,
  PanelOperationHost,
  PanelOperationTarget,
  PanelRecordTarget,
  PanelWriteServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import {
  attributeViewSchema,
  modelErrorSchema,
  objectTypeViewSchema,
  parseAttributePrimaryKey,
  relationshipViewSchema,
} from "./model-views";

const modelPath = `${DATA_QUERY_GATEWAY}/ontology/model`;

const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const formValues = panelFormSaveInputSchema.shape.values;
const emptyResultSchema = z.object({}).strict();
const classDeletionSchema = z.object({ relationships: z.array(z.string()) }).strict();
const deletionImpactSchema = z.object({ relationships: z.array(relationshipViewSchema) }).strict();
const setPrimaryKeyResultSchema = z.object({ attributes: z.array(attributeViewSchema) }).strict();

const targets = (type: string) => z.discriminatedUnion("kind", [
  panelFormTargetSchema.options[0].extend({ objectType: z.literal(type), primaryKey: z.string().min(1) }).strict(),
  panelFormTargetSchema.options[1],
]);

const recordTarget = (type: string) =>
  panelFormTargetSchema.options[0].extend({ objectType: z.literal(type), primaryKey: z.string().min(1) }).strict();

const attributeIdentity = (view: { className: string; name: string }): PanelObjectIdentity =>
  ({ objectType: ATTRIBUTE, primaryKey: JSON.stringify([view.className, view.name]) });

async function refused(response: Response): Promise<SinglePanelOperationOutcome> {
  const { error } = modelErrorSchema.parse(await response.json());
  if (error.code === "FIELD_VALIDATION_FAILED" || error.fields) {
    return {
      kind: "refusal",
      code: error.code,
      message: error.message,
      errors: (error.fields ?? []).map(item => ({ ...item, field: item.field.replace(/^\/values\//, "/") })),
    };
  }
  const details = runtimeJsonObjectSchema.parse(error);
  return response.status >= 500
    ? { kind: "failure", code: error.code, message: error.message, details }
    : { kind: "refusal", code: error.code, message: error.message, details };
}

type Outcome<T> = { ok: true; data: T } | { ok: false; outcome: SinglePanelOperationOutcome };

async function postModelWrite<T>(
  host: PanelOperationHost,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<Outcome<T>> {
  const response = await host.request(`${modelPath}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { ok: false, outcome: await refused(response) };
  return { ok: true, data: schema.parse(await response.json()) };
}

/** Reads one stored model view as the reader; the owner's refusal (a vanished object, say) becomes the outcome. */
async function getModelView<T>(host: PanelOperationHost, path: string, schema: z.ZodType<T>): Promise<Outcome<T>> {
  const response = await host.request(`${modelPath}${path}`, {});
  if (!response.ok) return { ok: false, outcome: await refused(response) };
  return { ok: true, data: schema.parse(await response.json()) };
}

/**
 * The editable values an update writes. Java replaces the whole editable form, so a save that names its
 * `submittedFields` keeps every field it did not submit at the stored value instead of clearing it.
 */
async function editedValues(
  { values, submittedFields }: z.infer<typeof saveInputSchema>,
  stored: () => Promise<Outcome<Record<string, unknown>>>,
): Promise<Outcome<Record<string, unknown>>> {
  if (submittedFields === undefined) return { ok: true, data: values };
  const current = await stored();
  if (!current.ok) return current;
  const submitted = new Set(submittedFields.map(pointer => formFieldKey(pointer, "/")));
  return { ok: true, data: Object.fromEntries(Object.entries(current.data).map(([key, value]) =>
    [key, submitted.has(key) ? values[key] : value])) };
}

/** Reads an existing model record's display name for confirmation, falling back to its key when unreadable. */
async function ownerName(
  host: PanelOperationHost,
  target: PanelRecordTarget,
  path: string,
  name: (body: unknown) => string,
): Promise<string> {
  const response = await host.request(path, {});
  if (response.ok) return name(await response.json());
  if (response.status === 403 || response.status === 404) return target.primaryKey;
  const { error } = modelErrorSchema.parse(await response.json());
  throw new HttpError(response.status, error.message, error.code);
}

const objectTypeTargetLabel = (host: PanelOperationHost, target: PanelRecordTarget) =>
  ownerName(host, target, `${modelPath}/object-type?className=${encodeURIComponent(target.primaryKey)}`, body => {
    const view = objectTypeViewSchema.parse(body);
    return view.showName || view.className;
  });

const attributeTargetLabel = (host: PanelOperationHost, target: PanelRecordTarget) => {
  const { className, name } = parseAttributePrimaryKey(target.primaryKey);
  return ownerName(host, target, `${modelPath}/attributes?className=${encodeURIComponent(className)}`, body => {
    const view = z.array(attributeViewSchema).parse(body).find(attribute => attribute.name === name);
    return view ? view.showName || view.name : target.primaryKey;
  });
};

const relationshipTargetLabel = (host: PanelOperationHost, target: PanelRecordTarget) =>
  ownerName(host, target, `${modelPath}/relationship?relationship=${encodeURIComponent(target.primaryKey)}`, body => {
    const view = relationshipViewSchema.parse(body);
    return view.desc || view.relationship;
  });

const deleteObjectTypeImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_OBJECT_TYPE}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const response = await host.request(
      `${modelPath}/object-type/deletion-impact?className=${encodeURIComponent(target.primaryKey)}`,
      {},
    );
    if (!response.ok) {
      const { error } = modelErrorSchema.parse(await response.json());
      throw new HttpError(response.status, error.message, error.code);
    }
    const impact = deletionImpactSchema.parse(await response.json());
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteObjectTypeImpact", {
        relationships: impact.relationships.length,
      }),
      objects: impact.relationships.map(view => ({
        target: { objectType: RELATIONSHIP, primaryKey: view.relationship },
        label: view.desc || view.relationship,
      })),
      total: impact.relationships.length,
    };
  },
};

/**
 * The ontology model's three form saves, three delete actions and the set-primary-key action.
 * `affected` names every modified record and every object type whose catalog lists or counts changed.
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
    inputSchema: saveInputSchema,
    resultSchema: objectTypeViewSchema,
    draftOperation: (target: PanelOperationTarget) => (target.kind === "draft" ? "objectType.create" : "objectType.update"),
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions: "Read the object type's form for the intended target. Use its fields and option sources, save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.",
    create: {
      draftValues: (values: unknown, _domainId: string) => formValues.parse(values),
      createdObject: (data: unknown) => ({ objectType: OBJECT_TYPE, primaryKey: objectTypeViewSchema.parse(data).className }),
    },
    async execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
      input: Record<string, unknown>,
      _intentId: string,
    ): Promise<SinglePanelOperationOutcome> {
      const save = saveInputSchema.parse(input);
      const { values } = save;
      let body: Record<string, unknown>;
      if (target.kind === "draft") {
        body = { className: values.className, primaryKeyName: values.primaryKeyName, showName: values.showName, classDesc: values.classDesc };
      } else {
        const edited = await editedValues(save, async () => {
          const view = await getModelView(host, `/object-type?className=${encodeURIComponent(target.primaryKey)}`, objectTypeViewSchema);
          return view.ok ? { ok: true, data: { showName: view.data.showName, classDesc: view.data.classDesc } } : view;
        });
        if (!edited.ok) return edited.outcome;
        body = { className: target.primaryKey, showName: edited.data.showName, classDesc: edited.data.classDesc };
      }
      const result = await postModelWrite(
        host,
        `/object-type/${target.kind === "draft" ? "create" : "update"}`,
        body,
        objectTypeViewSchema,
      );
      if (!result.ok) return result.outcome;
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse(result.data),
        affected: {
          objects: [{ objectType: OBJECT_TYPE, primaryKey: result.data.className }],
          objectTypes: target.kind === "draft" ? [OBJECT_TYPE, ATTRIBUTE] : [OBJECT_TYPE],
        },
      };
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
    inputSchema: saveInputSchema,
    resultSchema: attributeViewSchema,
    draftOperation: (target: PanelOperationTarget) => (target.kind === "draft" ? "attribute.create" : "attribute.update"),
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions: "Read the attribute's form for the intended target. Use its fields and option sources, save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.",
    create: {
      draftValues: (values: unknown, _domainId: string) => formValues.parse(values),
      createdObject: (data: unknown) => attributeIdentity(attributeViewSchema.parse(data)),
    },
    async execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
      input: Record<string, unknown>,
      _intentId: string,
    ): Promise<SinglePanelOperationOutcome> {
      const save = saveInputSchema.parse(input);
      const { values } = save;
      let body: Record<string, unknown>;
      if (target.kind === "draft") {
        body = {
          className: values.className,
          name: values.name,
          showName: values.showName,
          type: values.type,
          attrDesc: values.attrDesc,
          enable: values.enable,
          businessKey: values.businessKey,
          primaryKey: values.primaryKey,
        };
      } else {
        const key = parseAttributePrimaryKey(target.primaryKey);
        const edited = await editedValues(save, async () => {
          const views = await getModelView(
            host, `/attributes?className=${encodeURIComponent(key.className)}`, z.array(attributeViewSchema),
          );
          if (!views.ok) return views;
          const view = views.data.find(attribute => attribute.name === key.name);
          if (view === undefined) {
            return { ok: false, outcome: { kind: "refusal", code: "ATTRIBUTE_NOT_FOUND", message: `Attribute ${key.name} not found` } };
          }
          return { ok: true, data: { showName: view.showName, attrDesc: view.attrDesc, enable: view.enable, businessKey: view.businessKey } };
        });
        if (!edited.ok) return edited.outcome;
        body = {
          ...key,
          showName: edited.data.showName,
          attrDesc: edited.data.attrDesc,
          enable: edited.data.enable,
          businessKey: edited.data.businessKey,
        };
      }
      const result = await postModelWrite(
        host,
        `/attribute/${target.kind === "draft" ? "create" : "update"}`,
        body,
        attributeViewSchema,
      );
      if (!result.ok) return result.outcome;
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse(result.data),
        affected: {
          objects: [attributeIdentity(result.data)],
          objectTypes: [ATTRIBUTE, OBJECT_TYPE],
        },
      };
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
    inputSchema: saveInputSchema,
    resultSchema: relationshipViewSchema,
    draftOperation: (target: PanelOperationTarget) => (target.kind === "draft" ? "relationship.create" : "relationship.update"),
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions: "Read the relationship's form for the intended target. Use its fields and the options its ends offer, save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.",
    create: {
      draftValues: (values: unknown, _domainId: string) => formValues.parse(values),
      createdObject: (data: unknown) => ({ objectType: RELATIONSHIP, primaryKey: relationshipViewSchema.parse(data).relationship }),
    },
    async execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
      input: Record<string, unknown>,
      _intentId: string,
    ): Promise<SinglePanelOperationOutcome> {
      const save = saveInputSchema.parse(input);
      const { values } = save;
      let body: Record<string, unknown>;
      if (target.kind === "draft") {
        body = {
          relationship: values.relationship,
          fromclass: values.fromclass,
          toclass: values.toclass,
          desc: values.desc,
          fromField: values.fromField,
          toField: values.toField,
        };
      } else {
        const edited = await editedValues(save, async () => {
          const view = await getModelView(
            host, `/relationship?relationship=${encodeURIComponent(target.primaryKey)}`, relationshipViewSchema,
          );
          return view.ok ? { ok: true, data: { desc: view.data.desc, fromField: view.data.fromField, toField: view.data.toField } } : view;
        });
        if (!edited.ok) return edited.outcome;
        body = { relationship: target.primaryKey, desc: edited.data.desc, fromField: edited.data.fromField, toField: edited.data.toField };
      }
      const result = await postModelWrite(
        host,
        `/relationship/${target.kind === "draft" ? "create" : "update"}`,
        body,
        relationshipViewSchema,
      );
      if (!result.ok) return result.outcome;
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse(result.data),
        affected: {
          objects: [{ objectType: RELATIONSHIP, primaryKey: result.data.relationship }],
          objectTypes: target.kind === "draft" ? [RELATIONSHIP, OBJECT_TYPE] : [RELATIONSHIP],
        },
      };
    },
  },
  {
    handlerRef: DELETE_OBJECT_TYPE,
    labelKey: "panels.ontologyModel.operations.deleteObjectType",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_OBJECT_TYPE },
    effect: "write",
    batch: false,
    targetType: OBJECT_TYPE,
    targetInput: "objectType",
    targetSchema: recordTarget(OBJECT_TYPE),
    inputSchema: z.object({}).strict(),
    resultSchema: classDeletionSchema,
    targetLabel: objectTypeTargetLabel,
    inspectImpact: deleteObjectTypeImpact,
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const result = await postModelWrite(host, "/object-type/delete", { className: target.primaryKey }, classDeletionSchema);
      if (!result.ok) return result.outcome;
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse(result.data),
        affected: {
          objects: [
            { objectType: OBJECT_TYPE, primaryKey: target.primaryKey },
            ...result.data.relationships.map(name => ({ objectType: RELATIONSHIP, primaryKey: name })),
          ],
          objectTypes: result.data.relationships.length ? [OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP] : [OBJECT_TYPE, ATTRIBUTE],
        },
      };
    },
  },
  {
    handlerRef: DELETE_ATTRIBUTE,
    labelKey: "panels.ontologyModel.operations.deleteAttribute",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_ATTRIBUTE },
    effect: "write",
    batch: false,
    targetType: ATTRIBUTE,
    targetInput: "attribute",
    targetSchema: recordTarget(ATTRIBUTE),
    inputSchema: z.object({}).strict(),
    resultSchema: emptyResultSchema,
    targetLabel: attributeTargetLabel,
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const key = parseAttributePrimaryKey(target.primaryKey);
      const result = await postModelWrite(host, "/attribute/delete", key, emptyResultSchema);
      if (!result.ok) return result.outcome;
      return {
        kind: "success",
        data: {},
        affected: { objects: [attributeIdentity(key)], objectTypes: [ATTRIBUTE, OBJECT_TYPE] },
      };
    },
  },
  {
    handlerRef: DELETE_RELATIONSHIP,
    labelKey: "panels.ontologyModel.operations.deleteRelationship",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_RELATIONSHIP },
    effect: "write",
    batch: false,
    targetType: RELATIONSHIP,
    targetInput: "relationship",
    targetSchema: recordTarget(RELATIONSHIP),
    inputSchema: z.object({}).strict(),
    resultSchema: emptyResultSchema,
    targetLabel: relationshipTargetLabel,
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const result = await postModelWrite(
        host,
        "/relationship/delete",
        { relationship: target.primaryKey },
        emptyResultSchema,
      );
      if (!result.ok) return result.outcome;
      return {
        kind: "success",
        data: {},
        affected: {
          objects: [{ objectType: RELATIONSHIP, primaryKey: target.primaryKey }],
          objectTypes: [RELATIONSHIP, OBJECT_TYPE],
        },
      };
    },
  },
  {
    handlerRef: SET_PRIMARY_KEY,
    labelKey: "panels.ontologyModel.operations.setPrimaryKey",
    kind: "action",
    binding: { kind: "PlatformOperation", id: SET_PRIMARY_KEY },
    effect: "write",
    batch: false,
    targetType: ATTRIBUTE,
    targetInput: "attribute",
    targetSchema: recordTarget(ATTRIBUTE),
    inputSchema: z.object({}).strict(),
    resultSchema: setPrimaryKeyResultSchema,
    targetLabel: attributeTargetLabel,
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const result = await postModelWrite(
        host,
        "/attribute/primary-key",
        parseAttributePrimaryKey(target.primaryKey),
        z.array(attributeViewSchema),
      );
      if (!result.ok) return result.outcome;
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse({ attributes: result.data }),
        affected: { objects: result.data.map(attributeIdentity), objectTypes: [ATTRIBUTE, OBJECT_TYPE] },
      };
    },
  },
] satisfies readonly PanelWriteServerOperation[];
