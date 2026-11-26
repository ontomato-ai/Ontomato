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
  type AttributeView,
  type RelationshipView,
} from "./model-views";

const modelPath = `${DATA_QUERY_GATEWAY}/ontology/model`;

const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const emptyResultSchema = z.object({}).strict();
const classDeletionSchema = z.object({ relationships: z.array(z.string()) }).strict();
const deletionImpactSchema = z.object({ relationships: z.array(relationshipViewSchema) }).strict();
const setPrimaryKeyResultSchema = z.object({ attributes: z.array(attributeViewSchema) }).strict();
const attributeListSchema = z.array(attributeViewSchema);
const relationshipListSchema = z.array(relationshipViewSchema);

const objectTypePath = (className: string) => `/object-type?className=${encodeURIComponent(className)}`;
const attributesPath = (className: string) => `/attributes?className=${encodeURIComponent(className)}`;
const relationshipPath = (name: string) => `/relationship?relationship=${encodeURIComponent(name)}`;

const targets = (type: string) => z.discriminatedUnion("kind", [
  panelFormTargetSchema.options[0].extend({ objectType: z.literal(type), primaryKey: z.string().min(1) }).strict(),
  panelFormTargetSchema.options[1],
]);

const recordTarget = (type: string) =>
  panelFormTargetSchema.options[0].extend({ objectType: z.literal(type), primaryKey: z.string().min(1) }).strict();

const attributeIdentity = (view: { className: string; name: string }): PanelObjectIdentity =>
  ({ objectType: ATTRIBUTE, primaryKey: JSON.stringify([view.className, view.name]) });

const objectTypeIdentity = (className: string): PanelObjectIdentity =>
  ({ objectType: OBJECT_TYPE, primaryKey: className });

function relationshipEndpoints({ fromclass, toclass }: RelationshipView): PanelObjectIdentity[] {
  return [...new Set([fromclass, toclass])].map(objectTypeIdentity);
}

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

async function modelReadError(response: Response): Promise<HttpError> {
  const { error } = modelErrorSchema.parse(await response.json());
  return new HttpError(response.status, error.message, error.code);
}

async function readModelView<T>(host: PanelOperationHost, path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await host.request(`${modelPath}${path}`, {});
  if (!response.ok) throw await modelReadError(response);
  return schema.parse(await response.json());
}

/** Reads an existing model record's display name for confirmation, falling back to its key when unreadable. */
async function ownerName(
  host: PanelOperationHost,
  key: string,
  path: string,
  name: (body: unknown) => string,
): Promise<string> {
  const response = await host.request(`${modelPath}${path}`, {});
  if (response.ok) return name(await response.json());
  if (response.status === 403 || response.status === 404) return key;
  throw await modelReadError(response);
}

const objectTypeLabel = (host: PanelOperationHost, className: string) =>
  ownerName(host, className, objectTypePath(className), body => {
    const view = objectTypeViewSchema.parse(body);
    return view.showName || view.className;
  });

const objectTypeTargetLabel = (host: PanelOperationHost, target: PanelRecordTarget) => objectTypeLabel(host, target.primaryKey);

async function attributeTargetLabel(host: PanelOperationHost, target: PanelRecordTarget) {
  const { className, name } = parseAttributePrimaryKey(target.primaryKey);
  const [classLabel, attributeLabel] = await Promise.all([
    objectTypeLabel(host, className),
    ownerName(host, name, attributesPath(className), body => {
      const view = attributeListSchema.parse(body).find(attribute => attribute.name === name);
      return view?.showName || name;
    }),
  ]);
  return `${classLabel} · ${attributeLabel}`;
}

const relationshipTargetLabel = (host: PanelOperationHost, target: PanelRecordTarget) =>
  ownerName(host, target.primaryKey, relationshipPath(target.primaryKey), body => {
    const view = relationshipViewSchema.parse(body);
    return view.desc || view.relationship;
  });

async function attributeForAvailability(host: PanelOperationHost, className: string, name: string) {
  const response = await host.request(`${modelPath}${attributesPath(className)}`, {});
  if (response.status === 403 || response.status === 404) return undefined;
  if (!response.ok) throw await modelReadError(response);
  return attributeListSchema.parse(await response.json()).find(view => view.name === name);
}

const deleteObjectTypeImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_OBJECT_TYPE}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const [impact, view] = await Promise.all([
      readModelView(host, `/object-type/deletion-impact?className=${encodeURIComponent(target.primaryKey)}`, deletionImpactSchema),
      readModelView(host, objectTypePath(target.primaryKey), objectTypeViewSchema),
    ]);
    const objects = [
      { target: objectTypeIdentity(view.className), label: view.showName || view.className },
      ...impact.relationships.map(view => ({
        target: { objectType: RELATIONSHIP, primaryKey: view.relationship },
        label: view.desc || view.relationship,
      })),
    ];
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteObjectTypeImpact", {
        attributes: view.attributeCount,
        relationships: impact.relationships.length,
      }),
      objects,
      total: objects.length,
    };
  },
};

function primaryKeyImpact(
  host: PanelOperationHost,
  classLabel: string,
  next: Pick<AttributeView, "className" | "name" | "showName">,
  replaced: readonly AttributeView[],
  summaryKey: string,
) {
  const objects = [{
    target: attributeIdentity(next),
    label: tForLocale(host.locale, "panels.confirmation.setPrimaryKeyNewTarget", {
      className: classLabel, attribute: next.showName || next.name,
    }),
  }, ...replaced.map(view => ({
    target: attributeIdentity(view),
    label: tForLocale(host.locale, "panels.confirmation.setPrimaryKeyReplacedTarget", {
      className: classLabel, attribute: view.showName || view.name,
    }),
  }))];
  return { summary: tForLocale(host.locale, summaryKey, { className: classLabel }), objects, total: objects.length };
}

const setPrimaryKeyImpact: PanelImpactInspector = {
  handlerRef: `${SET_PRIMARY_KEY}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const { className, name } = parseAttributePrimaryKey(target.primaryKey);
    const [classView, attributes] = await Promise.all([
      readModelView(host, objectTypePath(className), objectTypeViewSchema),
      readModelView(host, attributesPath(className), attributeListSchema),
    ]);
    const next = attributes.find(view => view.name === name);
    if (!next) throw new HttpError(404, "Attribute not found", "ATTRIBUTE_NOT_FOUND");
    return primaryKeyImpact(host, classView.showName || classView.className, next,
      attributes.filter(view => view.primaryKey && view.name !== name), "panels.confirmation.setPrimaryKeyImpact");
  },
};

function draftPrimaryKeyClass(target: PanelOperationTarget | null, values: Record<string, unknown>) {
  if (target?.kind === "draft" && values.primaryKey === true && typeof values.className === "string") {
    return values.className.trim();
  }
}

/** Whether this save sends the attribute's option values, including an explicitly empty list that clears them. */
function submitsOptions(save: z.infer<typeof saveInputSchema>) {
  if (save.submittedFields === undefined) return save.values.options !== undefined;
  return save.submittedFields.some(pointer => formFieldKey(pointer, "/") === "options");
}

function editSubmitsPrimaryKey(save: z.infer<typeof saveInputSchema>) {
  if (save.submittedFields === undefined) return save.values.primaryKey !== undefined;
  return save.submittedFields.some(pointer => formFieldKey(pointer, "/") === "primaryKey");
}

const saveAttributePrimaryKeyImpact: PanelImpactInspector = {
  handlerRef: `${ATTRIBUTE}.save.inspect-impact`,
  async inspect(host, [call]) {
    const save = saveInputSchema.parse(call!.input);
    const { values } = save;
    if (call!.target?.kind === "draft") {
      const className = draftPrimaryKeyClass(call!.target, values);
      const name = typeof values.name === "string" ? values.name.trim() : "";
      if (!className || !name) return null;
      const [classView, attributes] = await Promise.all([
        readModelView(host, objectTypePath(className), objectTypeViewSchema),
        readModelView(host, attributesPath(className), attributeListSchema),
      ]);
      const replaced = attributes.filter(view => view.primaryKey);
      if (!replaced.length) return null;
      const showName = typeof values.showName === "string" ? values.showName.trim() : "";
      return primaryKeyImpact(host, classView.showName || classView.className, { className, name, showName },
        replaced, "panels.confirmation.createPrimaryKeyImpact");
    }
    if (call!.target?.kind !== "object" || !editSubmitsPrimaryKey(save) || values.primaryKey !== true) {
      return null;
    }
    const { className, name } = parseAttributePrimaryKey(call!.target.primaryKey);
    const [classView, attributes] = await Promise.all([
      readModelView(host, objectTypePath(className), objectTypeViewSchema),
      readModelView(host, attributesPath(className), attributeListSchema),
    ]);
    const current = attributes.find(view => view.name === name);
    if (!current || current.primaryKey) return null;
    const replaced = attributes.filter(view => view.primaryKey && view.name !== name);
    if (!replaced.length) return null;
    const showName = typeof values.showName === "string" && values.showName.trim()
      ? values.showName.trim()
      : current.showName;
    return primaryKeyImpact(host, classView.showName || classView.className, { className, name, showName },
      replaced, "panels.confirmation.setPrimaryKeyImpact");
  },
};

/** The impact a single delete shows its confirming human or agent: the one record, under its owner-read name. */
function deleteImpact(
  handlerRef: string,
  summaryKey: string,
  objectType: string,
  label: (host: PanelOperationHost, target: PanelRecordTarget) => Promise<string>,
): PanelImpactInspector {
  return {
    handlerRef: `${handlerRef}.inspect-impact`,
    async inspect(host, calls) {
      const target = calls[0]!.target as PanelRecordTarget;
      return {
        summary: tForLocale(host.locale, summaryKey),
        objects: [{ target: { objectType, primaryKey: target.primaryKey }, label: await label(host, target) }],
        total: 1,
      };
    },
  };
}

/**
 * The ontology model's three form saves, three delete actions and the set-primary-key action.
 * `affected` names every modified record and every object type whose catalog lists or counts changed.
 */
export const ontologyModelServerOperations = [
  {
    handlerRef: `${OBJECT_TYPE}.save`,
    labelKey: "panels.ontologyModel.operations.saveObjectType",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: OBJECT_TYPE },
    effect: "write",
    batch: false,
    targetType: OBJECT_TYPE,
    targetSchema: targets(OBJECT_TYPE),
    inputSchema: saveInputSchema,
    resultSchema: objectTypeViewSchema,
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,

    create: true,
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
          const view = await getModelView(host, objectTypePath(target.primaryKey), objectTypeViewSchema);
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
      const identity = { objectType: OBJECT_TYPE, primaryKey: result.data.className };
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse(result.data),
        ...(target.kind === "draft" && { created: identity }),
        affected: {
          objects: [identity],
          objectTypes: target.kind === "draft" ? [OBJECT_TYPE, ATTRIBUTE] : [OBJECT_TYPE],
        },
      };
    },
  },
  {
    handlerRef: `${ATTRIBUTE}.save`,
    labelKey: "panels.ontologyModel.operations.saveAttribute",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: ATTRIBUTE },
    effect: "write",
    batch: false,
    targetType: ATTRIBUTE,
    targetSchema: targets(ATTRIBUTE),
    inputSchema: saveInputSchema,
    resultSchema: attributeViewSchema,
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    inspectImpact: saveAttributePrimaryKeyImpact,

    create: true,
    async execute(
      host: PanelOperationHost,
      target: PanelOperationTarget,
      input: Record<string, unknown>,
      _intentId: string,
    ): Promise<SinglePanelOperationOutcome> {
      const save = saveInputSchema.parse(input);
      const { values } = save;
      const primaryKeyClass = draftPrimaryKeyClass(target, values);
      let replaced: PanelObjectIdentity[] = [];
      if (primaryKeyClass) {
        const attributes = await getModelView(host, attributesPath(primaryKeyClass), attributeListSchema);
        if (!attributes.ok) return attributes.outcome;
        replaced = attributes.data.filter(view => view.primaryKey).map(attributeIdentity);
      }
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
          ...(values.options !== undefined && { options: values.options }),
        };
      } else {
        const key = parseAttributePrimaryKey(target.primaryKey);
        const includePrimaryKey = editSubmitsPrimaryKey(save);
        let cachedViews: readonly AttributeView[] | undefined;
        const loadViews = async (): Promise<Outcome<readonly AttributeView[]>> => {
          if (cachedViews !== undefined) return { ok: true, data: cachedViews };
          const views = await getModelView(host, attributesPath(key.className), attributeListSchema);
          if (!views.ok) return views;
          cachedViews = views.data;
          return { ok: true, data: views.data };
        };
        const edited = await editedValues(save, async () => {
          const views = await loadViews();
          if (!views.ok) return views;
          const view = views.data.find(attribute => attribute.name === key.name);
          if (view === undefined) {
            return { ok: false, outcome: { kind: "refusal", code: "ATTRIBUTE_NOT_FOUND", message: `Attribute ${key.name} not found` } };
          }
          return {
            ok: true,
            data: {
              showName: view.showName,
              attrDesc: view.attrDesc,
              enable: view.enable,
              businessKey: view.businessKey,
              ...(includePrimaryKey && { primaryKey: view.primaryKey }),
            },
          };
        });
        if (!edited.ok) return edited.outcome;
        if (includePrimaryKey && edited.data.primaryKey === true) {
          const views = await loadViews();
          if (!views.ok) return views.outcome;
          const current = views.data.find(attribute => attribute.name === key.name);
          if (current && !current.primaryKey) {
            replaced = views.data.filter(view => view.primaryKey && view.name !== key.name).map(attributeIdentity);
          }
        }
        body = {
          ...key,
          showName: edited.data.showName,
          attrDesc: edited.data.attrDesc,
          enable: edited.data.enable,
          businessKey: edited.data.businessKey,
          // The owner keeps the stored options unless this save sends them; an empty list clears them.
          ...(submitsOptions(save) && { options: values.options ?? [] }),
          ...(includePrimaryKey && { primaryKey: edited.data.primaryKey }),
        };
      }
      const result = await postModelWrite(
        host,
        `/attribute/${target.kind === "draft" ? "create" : "update"}`,
        body,
        attributeViewSchema,
      );
      if (!result.ok) return result.outcome;
      const identity = attributeIdentity(result.data);
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse(result.data),
        ...(target.kind === "draft" && { created: identity }),
        affected: {
          objects: [identity, objectTypeIdentity(result.data.className), ...replaced],
          objectTypes: [ATTRIBUTE, OBJECT_TYPE],
        },
      };
    },
  },
  {
    handlerRef: `${RELATIONSHIP}.save`,
    labelKey: "panels.ontologyModel.operations.saveRelationship",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: RELATIONSHIP },
    effect: "write",
    batch: false,
    targetType: RELATIONSHIP,
    targetSchema: targets(RELATIONSHIP),
    inputSchema: saveInputSchema,
    resultSchema: relationshipViewSchema,
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,

    create: true,
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
            host, relationshipPath(target.primaryKey), relationshipViewSchema,
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
      const identity = { objectType: RELATIONSHIP, primaryKey: result.data.relationship };
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse(result.data),
        ...(target.kind === "draft" && { created: identity }),
        affected: {
          objects: [identity, ...relationshipEndpoints(result.data)],
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
    done: (host, name) => tForLocale(host.locale, "panels.ontologyModel.objectTypeDeleted", { name }),
    inspectImpact: deleteObjectTypeImpact,
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const result = await postModelWrite(host, "/object-type/delete", { className: target.primaryKey }, classDeletionSchema);
      if (!result.ok) return result.outcome;
      // The type goes, and with it the relationships that joined it.
      const removed = [
        { objectType: OBJECT_TYPE, primaryKey: target.primaryKey },
        ...result.data.relationships.map(name => ({ objectType: RELATIONSHIP, primaryKey: name })),
      ];
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse(result.data),
        affected: {
          objects: removed,
          objectTypes: result.data.relationships.length ? [OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP] : [OBJECT_TYPE, ATTRIBUTE],
          removed,
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
    done: (host, name) => tForLocale(host.locale, "panels.ontologyModel.attributeDeleted", { name }),
    inspectImpact: deleteImpact(DELETE_ATTRIBUTE, "panels.confirmation.deleteAttributeImpact", ATTRIBUTE, attributeTargetLabel),
    async unavailable(host: PanelOperationHost, target: PanelRecordTarget) {
      const { className, name } = parseAttributePrimaryKey(target.primaryKey);
      const view = await attributeForAvailability(host, className, name);
      if (!view) return { reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.attributeUnavailable") };
      if (view.primaryKey) return { reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.cannotDeletePrimaryKey") };
      const relationships = (await readModelView(host,
        `/relationships?className=${encodeURIComponent(className)}`, relationshipListSchema))
        .filter(rel => (rel.fromclass === className && rel.fromField === name) ||
          (rel.toclass === className && rel.toField === name));
      if (relationships.length) {
        return { reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.attributeInUse", {
          relationships: relationships.map(rel => rel.relationship).join(", "),
        }) };
      }
    },
    async unavailableBatch(
      host: PanelOperationHost,
      targets: readonly { rowKey: string; target: PanelRecordTarget }[],
    ) {
      const reasons = new Map<string, { reason: string }>();
      if (!targets.length) return reasons;
      const parsed = targets.map(entry => ({
        rowKey: entry.rowKey,
        ...parseAttributePrimaryKey(entry.target.primaryKey),
      }));
      const classes = [...new Set(parsed.map(entry => entry.className))];
      const attrPath = classes.length === 1 ? attributesPath(classes[0]!) : "/attributes";
      const relPath = classes.length === 1
        ? `/relationships?className=${encodeURIComponent(classes[0]!)}`
        : "/relationships";
      const [attrResp, relResp] = await Promise.all([
        host.request(`${modelPath}${attrPath}`, {}),
        host.request(`${modelPath}${relPath}`, {}),
      ]);
      if (!attrResp.ok && attrResp.status !== 403 && attrResp.status !== 404) {
        throw await modelReadError(attrResp);
      }
      if (!relResp.ok && relResp.status !== 403 && relResp.status !== 404) {
        throw await modelReadError(relResp);
      }
      const attributes = attrResp.ok ? attributeListSchema.parse(await attrResp.json()) : [];
      const relationships = relResp.ok ? relationshipListSchema.parse(await relResp.json()) : [];
      const attrByKey = new Map(attributes.map(view => [`${view.className}\u0000${view.name}`, view]));
      const usedBy = new Map<string, string[]>();
      for (const rel of relationships) {
        if (rel.fromclass && rel.fromField) {
          const fromKey = `${rel.fromclass}\u0000${rel.fromField}`;
          const list = usedBy.get(fromKey) ?? [];
          if (!list.includes(rel.relationship)) list.push(rel.relationship);
          usedBy.set(fromKey, list);
        }
        if (rel.toclass && rel.toField) {
          const toKey = `${rel.toclass}\u0000${rel.toField}`;
          const list = usedBy.get(toKey) ?? [];
          if (!list.includes(rel.relationship)) list.push(rel.relationship);
          usedBy.set(toKey, list);
        }
      }
      for (const { rowKey, className, name } of parsed) {
        const key = `${className}\u0000${name}`;
        const view = attrByKey.get(key);
        if (!view) {
          reasons.set(rowKey, { reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.attributeUnavailable") });
        } else if (view.primaryKey) {
          reasons.set(rowKey, { reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.cannotDeletePrimaryKey") });
        } else {
          const rels = usedBy.get(key);
          if (rels?.length) {
            reasons.set(rowKey, {
              reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.attributeInUse", {
                relationships: rels.join(", "),
              }),
            });
          }
        }
      }
      return reasons;
    },
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const key = parseAttributePrimaryKey(target.primaryKey);
      const result = await postModelWrite(host, "/attribute/delete", key, emptyResultSchema);
      if (!result.ok) return result.outcome;
      const attribute = attributeIdentity(key);
      return {
        kind: "success",
        data: {},
        affected: {
          objects: [attribute, objectTypeIdentity(key.className)],
          objectTypes: [ATTRIBUTE, OBJECT_TYPE],
          removed: [attribute],
        },
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
    done: (host, name) => tForLocale(host.locale, "panels.ontologyModel.relationshipDeleted", { name }),
    inspectImpact: deleteImpact(
      DELETE_RELATIONSHIP, "panels.confirmation.deleteRelationshipImpact", RELATIONSHIP, relationshipTargetLabel,
    ),
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const view = await getModelView(host, relationshipPath(target.primaryKey), relationshipViewSchema);
      if (!view.ok) return view.outcome;
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
          objects: [{ objectType: RELATIONSHIP, primaryKey: target.primaryKey }, ...relationshipEndpoints(view.data)],
          objectTypes: [RELATIONSHIP, OBJECT_TYPE],
          removed: [{ objectType: RELATIONSHIP, primaryKey: target.primaryKey }],
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
    inspectImpact: setPrimaryKeyImpact,
    targetLabel: attributeTargetLabel,
    done: (host, name) => tForLocale(host.locale, "panels.ontologyModel.primaryKeySet", { name }),
    async unavailable(host: PanelOperationHost, target: PanelRecordTarget) {
      const { className, name } = parseAttributePrimaryKey(target.primaryKey);
      const view = await attributeForAvailability(host, className, name);
      if (!view) return { reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.attributeUnavailable") };
      if (view.primaryKey) return { reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.alreadyPrimaryKey") };
      if (view.type !== "varchar" || !view.enable) {
        return { reason: tForLocale(host.locale, "panels.ontologyModel.unavailable.primaryKeyInvalid") };
      }
    },
    async execute(host: PanelOperationHost, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
      const key = parseAttributePrimaryKey(target.primaryKey);
      const result = await postModelWrite(
        host,
        "/attribute/primary-key",
        key,
        attributeListSchema,
      );
      if (!result.ok) return result.outcome;
      return {
        kind: "success",
        data: runtimeJsonObjectSchema.parse({ attributes: result.data }),
        affected: {
          objects: [...result.data.map(attributeIdentity), objectTypeIdentity(key.className)],
          objectTypes: [ATTRIBUTE, OBJECT_TYPE],
        },
      };
    },
  },
] satisfies readonly PanelWriteServerOperation[];
