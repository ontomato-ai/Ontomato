import type { RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { z } from "zod";
import { panelAddress } from "@ontomato/contracts/panel-host";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import {
  panelFormDescriptionSchema,
  panelFormRequestSchema,
  type PanelFormDescription,
  type PanelFormRequest,
  type PanelFormValues,
  type PanelOption,
  type PanelOptionList,
  type PanelRecord,
  type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import { panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import {
  ATTRIBUTE,
  DELETE_ATTRIBUTE,
  DELETE_OBJECT_TYPE,
  DELETE_RELATIONSHIP,
  OBJECT_TYPE,
  RELATIONSHIP,
  SET_PRIMARY_KEY,
} from "@ontomato/contracts/platform-object-types";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import { cachedZodToJsonSchema } from "../../utils/zod-json-schema";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendResponseError, backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { PanelWriteServerOperation } from "../product-panels/server-operations";
import {
  attributeViewSchema,
  fieldLabelsSchema,
  modelErrorSchema,
  objectTypeViewSchema,
  parseAttributePrimaryKey,
  relationshipViewSchema,
  type AttributeView,
  type FieldLabels,
  type ObjectTypeView,
  type RelationshipView,
} from "./model-views";
import { ontologyModelServerOperations } from "./model-operations";

/** Java's form endpoints return fields, values and save metadata without an errors array. */
const modelFormSchema = panelFormDescriptionSchema.omit({ errors: true });

export interface OntologyModelListParams {
  /** The owning class for attributes, or either end's class for relationships; object types ignore this filter. */
  className?: string;
}

export interface OntologyModelFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

/** The label key of each action operation the ontology model registers; the rest of its description is the operation's own. */
const actionLabels = {
  [DELETE_OBJECT_TYPE]: "panels.ontologyModel.operations.deleteObjectType",
  [DELETE_ATTRIBUTE]: "panels.ontologyModel.operations.deleteAttribute",
  [DELETE_RELATIONSHIP]: "panels.ontologyModel.operations.deleteRelationship",
  [SET_PRIMARY_KEY]: "panels.ontologyModel.operations.setPrimaryKey",
} as const;
export type OntologyModelAction = keyof typeof actionLabels;

type ModelActionOperation = Extract<PanelWriteServerOperation, { kind: "action" }>;
const modelOperations: readonly PanelWriteServerOperation[] = ontologyModelServerOperations;
type PanelOwnerOperationDescriptor = z.infer<typeof panelOwnerOperationDescriptorSchema>;

export interface OntologyModelReadAdapter {
  list(typeId: string, params?: OntologyModelListParams): Promise<PanelRecord[]>;
  count(typeId: string): Promise<PanelRecordQuery>;
  record(typeId: string, primaryKey: string): Promise<PanelRecord>;
  form(typeId: string, primaryKey: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
  inlineForm(typeId: string, primaryKey: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
  createForm(typeId: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
  /** The `<operation>.describe` read: the action as the coordinator dispatches it, labelled in the viewer's language. */
  describe(operation: OntologyModelAction): PanelOwnerOperationDescriptor;
  /** `platform:ObjectType.options`: every class as a choice whose value is its class name. */
  objectTypeOptions(): Promise<PanelOptionList>;
  /** `platform:ObjectType.resolve`: the chosen class names back as choices; a class that no longer exists stays, marked unavailable. */
  resolveObjectTypes(values: readonly unknown[]): Promise<PanelOptionList>;
}

function objectTypeOption(view: ObjectTypeView): PanelOption {
  return {
    primaryKey: view.className,
    value: view.className,
    label: view.showName && view.showName !== view.className ? `${view.showName} (${view.className})` : view.className,
    ...(view.classDesc && { description: view.classDesc }),
  };
}

function resolveObjectTypeOptions(views: readonly ObjectTypeView[], values: readonly unknown[], locale?: string): PanelOptionList {
  const options = new Map(views.map(view => [view.className, objectTypeOption(view)]));
  return { options: values.map(value => {
    const className = String(value);
    return options.get(className) ?? {
      primaryKey: className, value: className, label: className,
      unavailable: { reason: tForLocale(locale, "panels.ontologyModel.objectTypeUnavailable") },
    };
  }) };
}

export function withModelingPath(record: PanelRecord, focus: "object" | "relation", id: string): PanelRecord {
  return {
    ...record,
    outputs: { modelingPath: panelAddress("/ontology/visual-modeling", focus === "relation"
      ? { selectedEdge: id, back: "playground" }
      : { selectedNode: id, back: "playground" }) },
  };
}

function objectTypeLabel(view: ObjectTypeView) {
  return view.showName || view.className;
}

export function presentObjectTypeLabel(payload: unknown): string {
  return objectTypeLabel(objectTypeViewSchema.parse(payload));
}

function objectTypeRecord(view: ObjectTypeView): Omit<PanelRecord, "fieldLabels"> {
  const { status, name, showName, count } = view.primaryKey;
  return {
    primaryKey: view.className,
    label: objectTypeLabel(view),
    fields: {
      className: view.className,
      showName: view.showName,
      classDesc: view.classDesc,
      attributeCount: String(view.attributeCount),
      businessKeyCount: String(view.businessKeyCount),
      relationshipCount: String(view.relationshipCount),
      // The owner's derived primary-key state: missing, multiple, disabled or ok.
      primaryKey: status,
      primaryKeyCount: String(count),
      ...(name !== undefined && { primaryKeyName: name }),
      ...(view.searchableAttributes && view.searchableAttributes.length > 0 && {
        searchableAttributes: view.searchableAttributes,
      }),
    },
    tones: { primaryKey: status === "ok" ? "success" : status === "multiple" ? "danger" : "warning" },
    outputs: {
      className: view.className,
      primaryKeyStatus: status,
      primaryKeyName: name ?? "",
      primaryKeyShowName: showName ?? name ?? "",
      primaryKeyCount: count,
      attributeCount: view.attributeCount,
      businessKeyCount: view.businessKeyCount,
      relationshipCount: view.relationshipCount,
    },
  };
}

function attributeRecord(view: AttributeView, classLabels: ReadonlyMap<string, string>): Omit<PanelRecord, "fieldLabels"> {
  const ownerLabel = classLabels.get(view.className) ?? view.className;
  return {
    primaryKey: JSON.stringify([view.className, view.name]),
    label: view.showName || view.name,
    fields: {
      className: view.className,
      classNameLabel: ownerLabel,
      ...(view.className && {
        ownerObject: { kind: "reference" as const, className: OBJECT_TYPE, primaryKey: view.className, label: ownerLabel },
      }),
      name: view.name,
      type: view.type,
      attrDesc: view.attrDesc,
      enable: String(view.enable),
      businessKey: String(view.businessKey),
      primaryKey: String(view.primaryKey),
    },
    tones: {
      primaryKey: view.primaryKey ? "success" : "default",
      businessKey: view.businessKey ? "info" : "default",
      enable: view.enable ? "success" : "warning",
    },
    outputs: { isPrimaryKey: view.primaryKey, className: view.className },
  };
}

function relationshipRecord(view: RelationshipView): Omit<PanelRecord, "fieldLabels"> {
  const fromLabel = view.fromShowName?.trim() || view.fromclass;
  const toLabel = view.toShowName?.trim() || view.toclass;
  const subtitle = fromLabel && toLabel ? `${fromLabel} → ${toLabel}` : (fromLabel || toLabel);
  return {
    primaryKey: view.relationship,
    label: view.desc || view.relationship,
    ...(subtitle && { subtitle }),
    // Graph projections read edge endpoints from `fromclass` and `toclass`; keep both field names stable.
    fields: {
      fromclass: view.fromclass,
      toclass: view.toclass,
      fromclassLabel: fromLabel,
      toclassLabel: toLabel,
      ...(view.fromclass && {
        fromObject: { kind: "reference" as const, className: OBJECT_TYPE, primaryKey: view.fromclass, label: fromLabel },
      }),
      ...(view.toclass && {
        toObject: { kind: "reference" as const, className: OBJECT_TYPE, primaryKey: view.toclass, label: toLabel },
      }),
      desc: view.desc,
      fromField: view.fromField,
      toField: view.toField,
    },
  };
}

/** Labels the fields a record has; derived summary fields have no owner label and stay unlabelled. */
function labelled(record: Omit<PanelRecord, "fieldLabels">, labels: Record<string, string>): PanelRecord {
  const fieldLabels = Object.fromEntries(Object.entries(labels).filter(([key]) => key in record.fields));
  // Reference and display-label fields share the owner's labels for the corresponding class fields.
  if ("ownerObject" in record.fields && labels.className) fieldLabels.ownerObject = labels.className;
  if ("classNameLabel" in record.fields && labels.className) fieldLabels.classNameLabel = labels.className;
  if ("fromObject" in record.fields && labels.fromclass) fieldLabels.fromObject = labels.fromclass;
  if ("toObject" in record.fields && labels.toclass) fieldLabels.toObject = labels.toclass;
  if ("fromclassLabel" in record.fields && labels.fromclass) fieldLabels.fromclassLabel = labels.fromclass;
  if ("toclassLabel" in record.fields && labels.toclass) fieldLabels.toclassLabel = labels.toclass;
  return { ...record, fieldLabels };
}

const modelBatchLabels = z.object({ fieldLabels: z.record(z.string()) });

function renderModelRecords<V>(
  name: "list" | "record", value: unknown, viewSchema: z.ZodType<V>, record: (view: V) => Omit<PanelRecord, "fieldLabels">,
) {
  if (name === "list") {
    const { views, fieldLabels } = modelBatchLabels.extend({ views: z.array(viewSchema) }).parse(value);
    return views.map(view => labelled(record(view), fieldLabels));
  }
  const { view, fieldLabels } = modelBatchLabels.extend({ view: z.unknown() }).parse(value);
  return labelled(record(viewSchema.parse(view)), fieldLabels);
}

/** Turn the model owner's batch payload into the same panel record as its ordinary read. */
export function renderModelRead(type: string, name: string, value: unknown, params: Record<string, unknown>, locale?: string) {
  if (type === OBJECT_TYPE && (name === "options" || name === "resolve")) {
    const views = z.array(objectTypeViewSchema).parse(value);
    return name === "options"
      ? { options: views.map(objectTypeOption) }
      : resolveObjectTypeOptions(views, params.values as readonly unknown[], locale);
  }
  if (name === "form" || name === "createForm" || name === "inlineForm") {
    const form = panelFormDescriptionSchema.partial({ errors: true }).parse(value);
    return { ...form, errors: form.errors ?? [] };
  }
  if (name !== "list" && name !== "record") return value;
  if (type === OBJECT_TYPE) return renderModelRecords(name, value, objectTypeViewSchema, objectTypeRecord);
  if (type === RELATIONSHIP) return renderModelRecords(name, value, relationshipViewSchema, relationshipRecord);
  if (type === ATTRIBUTE) {
    const { classLabels } = z.object({ classLabels: z.record(z.string()) }).parse(value);
    const labels = new Map(Object.entries(classLabels));
    return renderModelRecords(name, value, attributeViewSchema, view => attributeRecord(view, labels));
  }
  throw new Error(`Unsupported ontology model type: ${type}`);
}

/** One model type's owner reads: its list, its single record, and the record mapping. */
interface ModelTypeReader<V> {
  readonly formPath: string;
  readonly countPath: string;
  /** This type's entry in the owner's field labels. */
  readonly labels: keyof FieldLabels;
  views(className?: string): Promise<readonly V[]>;
  one(primaryKey: string): Promise<V>;
  record(view: V): Omit<PanelRecord, "fieldLabels">;
}

interface ModelReads {
  list(params?: OntologyModelListParams): Promise<PanelRecord[]>;
  count(): Promise<PanelRecordQuery>;
  record(primaryKey: string): Promise<PanelRecord>;
  form(primaryKey: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
  inlineForm(primaryKey: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
  createForm(params?: OntologyModelFormParams): Promise<PanelFormDescription>;
}

/**
 * Reads of the ontology model (`platform:ObjectType`, `platform:Attribute`, `platform:Relationship`) for panel
 * projections, running against the Java owner with the viewer's credentials and locale.
 */
export function createOntologyModelReadAdapter(
  _owner: ProductOwner,
  viewer: AssistantCredentials,
  _callerUserName?: string,
): OntologyModelReadAdapter {
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  // A checked draft's 422 carries every field's reason; the default 200-char error clip would truncate it.
  const formOptions = { ...options, errorDetailLimit: 16384 };

  async function ownerGet<T>(endpoint: string, schema: z.ZodType<T>, path: string): Promise<T> {
    const response = await backendGet(endpoint, `${base}${path}`, options);
    return schema.parse(JSON.parse(response.text));
  }

  async function ownerForm(path: string, request: PanelFormRequest) {
    const response = await backendPost(
      "ontology-model-form",
      `${base}${path}`,
      panelFormRequestSchema.parse(request),
      formOptions,
    );
    return modelFormSchema.parse(JSON.parse(response.text));
  }

  /** Reads the owner's field labels in the viewer's language for this call, under the same permission as the lists. */
  async function labelsOf(type: keyof FieldLabels) {
    return (await ownerGet("ontology-model-field-labels", fieldLabelsSchema, "/ontology/model/field-labels"))[type];
  }

  function refusedFields(error: unknown) {
    if (!(error instanceof BackendResponseError) || error.status !== 422) return null;
    const { error: refused } = modelErrorSchema.parse(JSON.parse(error.detail));
    return refused.code === "FIELD_VALIDATION_FAILED" ? refused.fields ?? [] : null;
  }

  async function describeForm(
    formPath: string,
    target: PanelFormTarget,
    { values, changedField }: OntologyModelFormParams = {},
  ): Promise<PanelFormDescription> {
    const field = changedField ?? null;
    if (values === undefined || field !== null) {
      const answer = await ownerForm(formPath, {
        target,
        ...(values !== undefined && { values }),
        changedField: field,
      });
      return { ...answer, errors: [] };
    }
    try {
      const answer = await ownerForm(formPath, { target, values, changedField: null });
      return { ...answer, errors: [] };
    } catch (error) {
      const refused = refusedFields(error);
      if (refused === null) throw error;
      // Owner pointers use `/values/<key>` while form fields use `/<key>`.
      const errors = refused.map(item => ({ ...item, field: item.field.replace(/^\/values\//, "/") }));
      // A mid-edit refresh describes the form around the draft without refusing it, so options that depend on
      // other values (a relationship's join fields follow its end classes) match what was submitted.
      const around = await ownerForm(formPath, { target, values, changedField: errors[0]!.field });
      // The owner fills the fields the draft left out with its defaults; the reader's own values stay as submitted.
      return { ...around, values: { ...around.values, ...values }, errors };
    }
  }

  async function modelCount(path: string): Promise<PanelRecordQuery> {
    const { total } = await ownerGet("ontology-model-count", z.object({
      total: z.number().int().nonnegative(),
    }), `${path}?countOnly=true`);
    return { rows: [], total };
  }

  function typedReads<V>(typeId: string, reader: ModelTypeReader<V>): ModelReads {
    return {
      ...modelForms(typeId, reader.formPath),
      count: () => modelCount(reader.countPath),
      async list(params) {
        const [views, labels] = await Promise.all([reader.views(params?.className), labelsOf(reader.labels)]);
        return views.map(view => labelled(reader.record(view), labels));
      },
      async record(primaryKey) {
        const [view, labels] = await Promise.all([reader.one(primaryKey), labelsOf(reader.labels)]);
        return labelled(reader.record(view), labels);
      },
    };
  }

  function modelForms(typeId: string, formPath: string): Pick<ModelReads, "form" | "inlineForm" | "createForm"> {
    return {
      form: (primaryKey, params) =>
        describeForm(formPath, { kind: "object", objectType: typeId, primaryKey }, params),
      inlineForm: (primaryKey, params) =>
        describeForm(`${formPath}?mode=inline`, { kind: "object", objectType: typeId, primaryKey }, params),
      createForm: params =>
        describeForm(formPath, { kind: "draft" }, params),
    };
  }

  const objectTypeReader: ModelTypeReader<ObjectTypeView> = {
    formPath: "/ontology/model/object-type/form",
    countPath: "/ontology/model/object-types",
    labels: "objectType",
    views: () => ownerGet("ontology-model-object-types", z.array(objectTypeViewSchema), "/ontology/model/object-types"),
    one: primaryKey => ownerGet(
      "ontology-model-object-type",
      objectTypeViewSchema,
      `/ontology/model/object-type?className=${encodeURIComponent(primaryKey)}`,
    ),
    record: objectTypeRecord,
  };

  function attributeViews(className?: string) {
    return ownerGet(
      "ontology-model-attributes",
      z.array(attributeViewSchema),
      `/ontology/model/attributes${className ? `?className=${encodeURIComponent(className)}` : ""}`,
    );
  }

  async function objectTypeLabels() {
    const views = await objectTypeReader.views();
    return new Map(views.map(view => [view.className, view.showName || view.className]));
  }

  const attributeReader: ModelReads = {
    ...modelForms(ATTRIBUTE, "/ontology/model/attribute/form"),
    count: () => modelCount("/ontology/model/attributes"),
    async list(params) {
      const [views, labels, classLabels] = await Promise.all([
        attributeViews(params?.className), labelsOf("attribute"), objectTypeLabels(),
      ]);
      return views.map(view => labelled(attributeRecord(view, classLabels), labels));
    },
    async record(primaryKey) {
      // Java has no single-attribute read endpoint; read the owning class's attributes and raise 404 when absent.
      const { className, name } = parseAttributePrimaryKey(primaryKey);
      const [views, labels, classLabels] = await Promise.all([
        attributeViews(className), labelsOf("attribute"), objectTypeLabels(),
      ]);
      const view = views.find(attribute => attribute.name === name);
      if (view === undefined) throw new HttpError(404, "Attribute not found", "ATTRIBUTE_NOT_FOUND");
      return labelled(attributeRecord(view, classLabels), labels);
    },
  };

  const relationshipReader: ModelTypeReader<RelationshipView> = {
    formPath: "/ontology/model/relationship/form",
    countPath: "/ontology/model/relationships",
    labels: "relationship",
    views: className => ownerGet(
      "ontology-model-relationships",
      z.array(relationshipViewSchema),
      `/ontology/model/relationships${className ? `?className=${encodeURIComponent(className)}` : ""}`,
    ),
    one: primaryKey => ownerGet(
      "ontology-model-relationship",
      relationshipViewSchema,
      `/ontology/model/relationship?relationship=${encodeURIComponent(primaryKey)}`,
    ),
    record: relationshipRecord,
  };

  const reads: Readonly<Record<string, ModelReads>> = {
    [OBJECT_TYPE]: typedReads(OBJECT_TYPE, objectTypeReader),
    [ATTRIBUTE]: attributeReader,
    [RELATIONSHIP]: typedReads(RELATIONSHIP, relationshipReader),
  };

  function readerFor(typeId: string): ModelReads {
    const reader = reads[typeId];
    if (!reader) throw new Error(`Unsupported ontology model type: ${typeId}`);
    return reader;
  }

  function describe(handlerRef: OntologyModelAction): PanelOwnerOperationDescriptor {
    const operation = modelOperations.find((item): item is ModelActionOperation =>
      item.kind === "action" && item.handlerRef === handlerRef)!;
    return panelOwnerOperationDescriptorSchema.parse({
      handlerRef,
      kind: operation.kind,
      label: tForLocale(viewer.locale, actionLabels[handlerRef]),
      effect: operation.effect,
      batch: operation.batch,
      target: { source: "input", input: operation.targetInput },
      inputSchema: cachedZodToJsonSchema(operation.inputSchema, { effectStrategy: "input" }),
      resultSchema: cachedZodToJsonSchema(operation.resultSchema, { effectStrategy: "input" }),
      ...(operation.inspectImpact && { inspectImpact: { handlerRef: operation.inspectImpact.handlerRef } }),
    });
  }

  async function objectTypeOptions(): Promise<PanelOptionList> {
    return { options: (await objectTypeReader.views()).map(objectTypeOption) };
  }

  async function resolveObjectTypes(values: readonly unknown[]): Promise<PanelOptionList> {
    return resolveObjectTypeOptions(await objectTypeReader.views(), values, viewer.locale);
  }

  return {
    describe,
    objectTypeOptions,
    resolveObjectTypes,
    list: async (typeId, params) => readerFor(typeId).list(params),
    count: typeId => readerFor(typeId).count(),
    record: async (typeId, primaryKey) => readerFor(typeId).record(primaryKey),
    form: async (typeId, primaryKey, params) => readerFor(typeId).form(primaryKey, params),
    inlineForm: async (typeId, primaryKey, params) => readerFor(typeId).inlineForm(primaryKey, params),
    createForm: async (typeId, params) => readerFor(typeId).createForm(params),
  };
}

function presentOntologyModelRegisteredRead(typeId: string, method: string): NonNullable<RegisteredDataReadRegistration["present"]> {
  return (payload, { params, selection, credentials }) => {
    const value = renderModelRead(typeId, method, payload, params, credentials.locale);
    return method === "record" && typeId !== ATTRIBUTE
      ? withModelingPath(value as Parameters<typeof withModelingPath>[0], typeId === OBJECT_TYPE ? "object" : "relation", selection.primaryKey!)
      : value;
  };
}

const validateOntologyModelForm: NonNullable<RegisteredDataReadRegistration["validate"]> = ({ params }) => {
  requireFormFieldNames(params.values, "values");
};

function ontologyModelRegistration(typeId: string, method: string): RegisteredDataReadRegistration {
  return {
    typeId, method,
    ...((method === "form" || method === "createForm" || method === "inlineForm") && { validate: validateOntologyModelForm }),
    ...(typeId === OBJECT_TYPE && (method === "options" || method === "resolve") && {
      javaCall: () => ({ type: OBJECT_TYPE, name: "options", parameters: {} }),
    }),
    present: presentOntologyModelRegisteredRead(typeId, method),
  };
}

export const ontologyModelDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...(["list", "record", "form", "createForm", "inlineForm", "options", "resolve"] as const).map(method =>
    ontologyModelRegistration(OBJECT_TYPE, method)),
  ...(["list", "record", "form", "createForm", "inlineForm"] as const).map(method =>
    ontologyModelRegistration(ATTRIBUTE, method)),
  ...(["list", "record", "form", "createForm"] as const).map(method =>
    ontologyModelRegistration(RELATIONSHIP, method)),
];
