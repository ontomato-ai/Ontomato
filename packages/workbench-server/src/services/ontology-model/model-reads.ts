import { z } from "zod";
import { formFieldKey, type FormFieldError } from "@ontomato/contracts/form-fields";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import {
  panelFormDescriptionSchema,
  panelFormRequestSchema,
  type PanelFormDescription,
  type PanelFormRequest,
  type PanelFormValues,
  type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendResponseError, backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";

/** The owner's typed views of the three model objects, as `OntologyModelController` answers them. */
export const objectTypeViewSchema = z.object({
  className: z.string(),
  showName: z.string(),
  classDesc: z.string(),
  attributeCount: z.number(),
  businessKeyCount: z.number(),
  relationshipCount: z.number(),
  primaryKey: z.object({ status: z.string(), name: z.string().optional() }),
}).strict();

export const attributeViewSchema = z.object({
  className: z.string(),
  name: z.string(),
  showName: z.string(),
  type: z.string(),
  attrDesc: z.string(),
  enable: z.boolean(),
  businessKey: z.boolean(),
  primaryKey: z.boolean(),
}).strict();

export const relationshipViewSchema = z.object({
  relationship: z.string(),
  fromclass: z.string(),
  toclass: z.string(),
  desc: z.string(),
  fromField: z.string(),
  toField: z.string(),
}).strict();

export type ObjectTypeView = z.infer<typeof objectTypeViewSchema>;
export type AttributeView = z.infer<typeof attributeViewSchema>;
export type RelationshipView = z.infer<typeof relationshipViewSchema>;

/** The owner's answer for a refused request, as the controller's error handler shapes it. */
export const modelErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.array(z.object({ field: z.string(), code: z.string(), message: z.string() }).strict()).optional(),
  }).passthrough(),
});

const attributePrimaryKeySchema = z.tuple([z.string().min(1), z.string().min(1)]);

/** Splits an attribute's two-part JSON primary key into its owning class name and attribute name. */
export function parseAttributePrimaryKey(primaryKey: string): { className: string; name: string } {
  const [className, name] = attributePrimaryKeySchema.parse(JSON.parse(primaryKey));
  return { className, name };
}

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

export interface OntologyModelReadAdapter {
  list(typeId: string, params?: OntologyModelListParams): Promise<PanelRecord[]>;
  record(typeId: string, primaryKey: string): Promise<PanelRecord>;
  form(typeId: string, primaryKey: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
  createForm(typeId: string, params?: OntologyModelFormParams): Promise<PanelFormDescription>;
}

function objectTypeRecord(view: ObjectTypeView, fieldLabels: Record<string, string>): PanelRecord {
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
    fieldLabels,
  };
}

function attributeRecord(view: AttributeView, fieldLabels: Record<string, string>): PanelRecord {
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
    fieldLabels,
  };
}

function relationshipRecord(view: RelationshipView, fieldLabels: Record<string, string>): PanelRecord {
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
    fieldLabels,
  };
}

/** One model type's owner reads: its list, its single record, and the record mapping. */
interface ModelTypeReader<V> {
  readonly formPath: string;
  /** The record fields named by the owner's form; derived summary fields omit fieldLabels. */
  readonly recordFields: readonly string[];
  views(className?: string): Promise<readonly V[]>;
  one(primaryKey: string): Promise<V>;
  record(view: V, fieldLabels: Record<string, string>): PanelRecord;
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

  /** Reads the owner's field labels for this call in the viewer's language from the create form without caching. */
  async function labelsOf(reader: Pick<ModelTypeReader<unknown>, "formPath" | "recordFields">) {
    const answer = await ownerForm(reader.formPath, { target: { kind: "draft" }, changedField: null });
    const labels: Record<string, string> = {};
    for (const field of answer.fields) {
      const key = formFieldKey(field.path, "/");
      if (key !== null && reader.recordFields.includes(key)) labels[key] = field.label;
    }
    return labels;
  }

  function refusedFields(error: unknown) {
    if (!(error instanceof BackendResponseError) || error.status !== 422) return null;
    try {
      const { error: refused } = modelErrorSchema.parse(JSON.parse(error.detail));
      return refused.code === "FIELD_VALIDATION_FAILED" ? refused.fields ?? [] : null;
    } catch {
      return null;
    }
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
      const fields = refusedFields(error);
      if (fields === null) throw error;
      const opening = await ownerForm(formPath, { target, changedField: null });
      // Owner pointers use `/values/<key>` while form fields use `/<key>`. `invalid_format` and `already_exists`
      // await alignment in A's shared `formFieldErrorCodeSchema`.
      return {
        ...opening,
        values,
        errors: fields.map(item => ({ ...item, field: item.field.replace(/^\/values\//, "/") })) as FormFieldError[],
      };
    }
  }

  function typedReads<V>(typeId: string, reader: ModelTypeReader<V>): ModelReads {
    return {
      async list(params) {
        const [views, fieldLabels] = await Promise.all([reader.views(params?.className), labelsOf(reader)]);
        return views.map(view => reader.record(view, fieldLabels));
      },
      async record(primaryKey) {
        const [view, fieldLabels] = await Promise.all([reader.one(primaryKey), labelsOf(reader)]);
        return reader.record(view, fieldLabels);
      },
      form: (primaryKey, params) =>
        describeForm(reader.formPath, { kind: "object", objectType: typeId, primaryKey }, params),
      createForm: params =>
        describeForm(reader.formPath, { kind: "draft" }, params),
    };
  }

  const objectTypeReader: ModelTypeReader<ObjectTypeView> = {
    formPath: "/ontology/model/object-type/form",
    recordFields: ["className", "showName", "classDesc"],
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
    recordFields: ["className", "name", "type", "attrDesc", "enable", "businessKey", "primaryKey"],
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
    recordFields: ["fromclass", "toclass", "desc", "fromField", "toField"],
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

  return {
    list: async (typeId, params) => readerFor(typeId).list(params),
    record: async (typeId, primaryKey) => readerFor(typeId).record(primaryKey),
    form: async (typeId, primaryKey, params) => readerFor(typeId).form(primaryKey, params),
    createForm: async (typeId, params) => readerFor(typeId).createForm(params),
  };
}
