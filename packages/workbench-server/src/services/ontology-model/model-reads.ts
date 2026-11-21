import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
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
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendResponseError, backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
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
  record(typeId: string, primaryKey: string): Promise<PanelRecord>;
  form(typeId: string, primaryKey: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
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
    label: view.showName || view.className,
    ...(view.classDesc && { description: view.classDesc }),
  };
}

function objectTypeRecord(view: ObjectTypeView): Omit<PanelRecord, "fieldLabels"> {
  return {
    primaryKey: view.className,
    label: view.showName || view.className,
    fields: {
      className: view.className,
      showName: view.showName,
      classDesc: view.classDesc,
      attributeCount: String(view.attributeCount),
      businessKeyCount: String(view.businessKeyCount),
      relationshipCount: String(view.relationshipCount),
      // The owner's derived primary-key state: missing, multiple, disabled or ok.
      primaryKey: view.primaryKey.status,
    },
  };
}

function attributeRecord(view: AttributeView): Omit<PanelRecord, "fieldLabels"> {
  return {
    primaryKey: JSON.stringify([view.className, view.name]),
    label: view.showName || view.name,
    fields: {
      className: view.className,
      name: view.name,
      type: view.type,
      attrDesc: view.attrDesc,
      enable: String(view.enable),
      businessKey: String(view.businessKey),
      primaryKey: String(view.primaryKey),
    },
  };
}

function relationshipRecord(view: RelationshipView): Omit<PanelRecord, "fieldLabels"> {
  return {
    primaryKey: view.relationship,
    label: view.desc || view.relationship,
    // Graph projections read edge endpoints from `fromclass` and `toclass`; keep both field names stable.
    fields: {
      fromclass: view.fromclass,
      toclass: view.toclass,
      desc: view.desc,
      fromField: view.fromField,
      toField: view.toField,
    },
  };
}

/** One model type's owner reads: its list, its single record, and the record mapping. */
interface ModelTypeReader<V> {
  readonly formPath: string;
  /** This type's entry in the owner's field labels. */
  readonly labels: keyof FieldLabels;
  views(className?: string): Promise<readonly V[]>;
  one(primaryKey: string): Promise<V>;
  record(view: V): Omit<PanelRecord, "fieldLabels">;
}

interface ModelReads {
  list(params?: OntologyModelListParams): Promise<PanelRecord[]>;
  record(primaryKey: string): Promise<PanelRecord>;
  form(primaryKey: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
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
  async function labelsOf(reader: Pick<ModelTypeReader<unknown>, "labels">) {
    return (await ownerGet("ontology-model-field-labels", fieldLabelsSchema, "/ontology/model/field-labels"))[reader.labels];
  }

  /** Labels the fields a record has; derived summary fields have no owner label and stay unlabelled. */
  function labelled(record: Omit<PanelRecord, "fieldLabels">, labels: Record<string, string>): PanelRecord {
    return { ...record, fieldLabels: Object.fromEntries(Object.entries(labels).filter(([key]) => key in record.fields)) };
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

  function typedReads<V>(typeId: string, reader: ModelTypeReader<V>): ModelReads {
    return {
      async list(params) {
        const [views, labels] = await Promise.all([reader.views(params?.className), labelsOf(reader)]);
        return views.map(view => labelled(reader.record(view), labels));
      },
      async record(primaryKey) {
        const [view, labels] = await Promise.all([reader.one(primaryKey), labelsOf(reader)]);
        return labelled(reader.record(view), labels);
      },
      form: (primaryKey, params) =>
        describeForm(reader.formPath, { kind: "object", objectType: typeId, primaryKey }, params),
      createForm: params =>
        describeForm(reader.formPath, { kind: "draft" }, params),
    };
  }

  const objectTypeReader: ModelTypeReader<ObjectTypeView> = {
    formPath: "/ontology/model/object-type/form",
    labels: "objectType",
    views: () => ownerGet("ontology-model-object-types", z.array(objectTypeViewSchema), "/ontology/model/object-types"),
    one: primaryKey => ownerGet(
      "ontology-model-object-type",
      objectTypeViewSchema,
      `/ontology/model/object-type?className=${encodeURIComponent(primaryKey)}`,
    ),
    record: objectTypeRecord,
  };

  const attributeReader: ModelTypeReader<AttributeView> = {
    formPath: "/ontology/model/attribute/form",
    labels: "attribute",
    views: className => ownerGet(
      "ontology-model-attributes",
      z.array(attributeViewSchema),
      `/ontology/model/attributes${className ? `?className=${encodeURIComponent(className)}` : ""}`,
    ),
    async one(primaryKey) {
      // Java has no single-attribute read endpoint; read the owning class's attributes and raise 404 when absent.
      const { className, name } = parseAttributePrimaryKey(primaryKey);
      const attributes = await attributeReader.views(className);
      const view = attributes.find(attribute => attribute.name === name);
      if (view === undefined) throw new HttpError(404, "Attribute not found", "ATTRIBUTE_NOT_FOUND");
      return view;
    },
    record: attributeRecord,
  };

  const relationshipReader: ModelTypeReader<RelationshipView> = {
    formPath: "/ontology/model/relationship/form",
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
    [ATTRIBUTE]: typedReads(ATTRIBUTE, attributeReader),
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
      inputSchema: zodToJsonSchema(operation.inputSchema, { effectStrategy: "input" }),
      resultSchema: zodToJsonSchema(operation.resultSchema, { effectStrategy: "input" }),
      ...(operation.inspectImpact && { inspectImpact: { handlerRef: operation.inspectImpact.handlerRef } }),
    });
  }

  async function objectTypeOptions(): Promise<PanelOptionList> {
    return { options: (await objectTypeReader.views()).map(objectTypeOption) };
  }

  async function resolveObjectTypes(values: readonly unknown[]): Promise<PanelOptionList> {
    const options = new Map((await objectTypeReader.views()).map(view => [view.className, objectTypeOption(view)]));
    return { options: values.map(value => {
      const className = String(value);
      return options.get(className) ?? {
        primaryKey: className, value: className, label: className,
        unavailable: { reason: tForLocale(viewer.locale, "panels.ontologyModel.objectTypeUnavailable") },
      };
    }) };
  }

  return {
    describe,
    objectTypeOptions,
    resolveObjectTypes,
    list: async (typeId, params) => readerFor(typeId).list(params),
    record: async (typeId, primaryKey) => readerFor(typeId).record(primaryKey),
    form: async (typeId, primaryKey, params) => readerFor(typeId).form(primaryKey, params),
    createForm: async (typeId, params) => readerFor(typeId).createForm(params),
  };
}
