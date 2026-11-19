import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { formFieldKey, formFieldPointer } from "@ontomato/contracts/form-fields";
import {
  panelFormDescriptionSchema,
  type PanelFormDescription,
  type PanelFormRequest,
  type PanelFormSaveInput,
} from "@ontomato/contracts/panel-projection";
import type { PanelFormTarget } from "@ontomato/contracts/panel-manifest";
import {
  PlatformObjectRefusal,
  type PlatformObjectAdapterFactory,
  type PlatformObjectQuery,
  type PlatformObjectQueryResult,
  type PlatformObjectRecord,
  type PlatformRequests,
} from "./platform-objects";

/** The owner's typed views of its three objects, as `packages/contracts/panel-client-requests.ts` declares the reads. */
interface ObjectTypeView {
  className: string;
  showName: string;
  classDesc: string;
  attributeCount: number;
  businessKeyCount: number;
  relationshipCount: number;
  primaryKey: { status: string };
}
interface AttributeView {
  className: string;
  name: string;
  showName: string;
  type: string;
  attrDesc: string;
  enable: boolean;
  businessKey: boolean;
  primaryKey: boolean;
}
interface RelationshipView {
  relationship: string;
  fromclass: string;
  toclass: string;
  desc: string;
  fromField: string;
  toField: string;
}

const json = { "Content-Type": "application/json" };

/**
 * The owner's refusal of a read, a draft or a save, as a generic form shows it: the owner's own message, and the
 * message of each field it named, by that field's own path — the owner names values under `/values/`, a form's
 * fields under `/`. A failure that is not the owner's answer passes through unchanged.
 */
function refusalOf(body: unknown, cause: unknown): PlatformObjectRefusal | null {
  const error = (body as { error?: { message?: string; fields?: { field: string; message: string }[] } } | null)?.error;
  if (!error?.message) return null;
  const fields = Object.fromEntries((error.fields ?? []).map(field => {
    const key = formFieldKey(field.field, "/values/");
    return [key === null ? field.field : formFieldPointer("/", key), field.message];
  }));
  return new PlatformObjectRefusal(error.message, fields, cause === null ? undefined : { cause });
}

/** One request to the owner: its answer's body, or its refusal raised as the form and its fields read it. */
async function modelRequest<T>(requests: PlatformRequests, path: string, init: NonNullable<Parameters<typeof fetch>[1]>) {
  let response: Response;
  try {
    response = await requests.request(path, init, "/data-query");
  } catch (error) {
    const refused = refusalOf((error as { payload?: unknown }).payload, error);
    throw refused ?? error;
  }
  const body = await response.json();
  if (!response.ok) throw refusalOf(body, null) ?? new Error(`The ontology model service answered HTTP ${response.status}`);
  return body as T;
}

function objectTypeRecord(view: ObjectTypeView): PlatformObjectRecord {
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
      primaryKey: view.primaryKey.status,
    },
  };
}

function attributeRecord(view: AttributeView, classLabel: string): PlatformObjectRecord {
  return {
    // The attribute's own key is the two-part one the owner's form target and read client use.
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
    // The list's owner column: a click follows the reference to the object type.
    references: { className: { className: OBJECT_TYPE, primaryKey: view.className, label: classLabel } },
  };
}

function relationshipRecord(view: RelationshipView): PlatformObjectRecord {
  return {
    primaryKey: view.relationship,
    label: view.desc || view.relationship,
    // A graph reads the two classes a relationship joins from these fields, as its projection's `graph` names them.
    fields: {
      fromclass: view.fromclass,
      toclass: view.toclass,
      desc: view.desc,
      fromField: view.fromField,
      toField: view.toField,
    },
  };
}

/** Case-insensitive substring match over the owner's own texts; an empty search matches everything. */
/** Case-insensitive substring match over the owner's own texts; an empty search matches everything. */
const matches = (search: string | undefined, ...texts: readonly string[]) =>
  !search || texts.some(text => text.toLowerCase().includes(search!.toLowerCase()));

/** The searched and filtered records, sliced by the caller's page; the total is the owner's real count, never the page's. */
function paged(items: readonly PlatformObjectRecord[], query: PlatformObjectQuery): PlatformObjectQueryResult {
  if (!query.page) return { items, total: items.length };
  const offset = query.page.offset ?? 0;
  return { items: items.slice(offset, offset + query.page.limit), total: items.length };
}

/**
 * The ontology model's three objects, each read through its owner's typed interface and written through the owner's
 * own create and update requests. The owner decides every field, option and refusal; this client decides only which
 * of its requests a list, a form or a save sends.
 */
export const ontologyMetadataAdapters: PlatformObjectAdapterFactory = requests => {
  // One owner read serves a class list, an attribute's owner labels and the reference choices; concurrent callers
  // share that one in-flight request, and a later read reaches the owner again.
  let pending: Promise<readonly ObjectTypeView[]> | undefined;
  const objectTypes = () => pending ??= modelRequest<readonly ObjectTypeView[]>(requests, "/ontology/model/object-types", {})
    .finally(() => { pending = undefined; });
  const classLabels = async () => new Map((await objectTypes()).map(view => [view.className, view.showName || view.className]));
  async function attributes(className?: string) {
    const views = await modelRequest<readonly AttributeView[]>(requests,
      `/ontology/model/attributes${className ? `?className=${encodeURIComponent(className)}` : ""}`, {});
    const labels = await classLabels();
    return views.map(view => attributeRecord(view, labels.get(view.className) ?? view.className));
  }

  const describe = (path: string) => async (request: PanelFormRequest): Promise<PanelFormDescription> =>
    panelFormDescriptionSchema.parse(await modelRequest(requests, path, {
      method: "POST", headers: json, body: JSON.stringify(request),
    }));

  /** The save of one target: a draft creates through the owner's create request, an object updates it with the target's identity. */
  async function saveObjectType(target: PanelFormTarget, { values }: PanelFormSaveInput): Promise<PlatformObjectRecord> {
    const view = await modelRequest<ObjectTypeView>(requests,
      target.kind === "draft" ? "/ontology/model/object-type/create" : "/ontology/model/object-type/update", {
        method: "POST", headers: json,
        body: JSON.stringify(target.kind === "draft"
          ? { className: values.className, primaryKeyName: values.primaryKeyName, showName: values.showName,
              classDesc: values.classDesc }
          : { className: target.primaryKey, showName: values.showName, classDesc: values.classDesc }),
      });
    return objectTypeRecord(view);
  }

  async function saveAttribute(target: PanelFormTarget, { values }: PanelFormSaveInput): Promise<PlatformObjectRecord> {
    const labels = await classLabels();
    const view = await modelRequest<AttributeView>(requests,
      target.kind === "draft" ? "/ontology/model/attribute/create" : "/ontology/model/attribute/update", {
        method: "POST", headers: json,
        body: JSON.stringify(target.kind === "draft"
          ? { className: values.className, name: values.name, showName: values.showName, type: values.type,
              attrDesc: values.attrDesc, enable: values.enable, businessKey: values.businessKey,
              primaryKey: values.primaryKey }
          : { ...identity(target.primaryKey), showName: values.showName, attrDesc: values.attrDesc,
              enable: values.enable, businessKey: values.businessKey }),
      });
    return attributeRecord(view, labels.get(view.className) ?? view.className);
  }

  async function saveRelationship(target: PanelFormTarget, { values }: PanelFormSaveInput): Promise<PlatformObjectRecord> {
    const view = await modelRequest<RelationshipView>(requests,
      target.kind === "draft" ? "/ontology/model/relationship/create" : "/ontology/model/relationship/update", {
        method: "POST", headers: json,
        body: JSON.stringify(target.kind === "draft"
          ? { relationship: values.relationship, fromclass: values.fromclass, toclass: values.toclass,
              desc: values.desc, fromField: values.fromField, toField: values.toField }
          : { relationship: target.primaryKey, desc: values.desc, fromField: values.fromField,
              toField: values.toField }),
      });
    return relationshipRecord(view);
  }

  /** The attribute's target identity, split out of the two-part key the owner's reads and forms use. */
  function identity(primaryKey: string): { className: string; name: string } {
    const [className, name] = JSON.parse(primaryKey) as [string, string];
    return { className, name };
  }

  return [{
    objectType: OBJECT_TYPE,
    async list() {
      return (await objectTypes()).map(objectTypeRecord);
    },
    async read(primaryKey: string) {
      return objectTypeRecord(await modelRequest<ObjectTypeView>(requests,
        `/ontology/model/object-type?className=${encodeURIComponent(primaryKey)}`, {}));
    },
    async query({ search, page }: PlatformObjectQuery) {
      return paged((await objectTypes())
        .filter(view => matches(search, view.className, view.showName, view.classDesc))
        .map(objectTypeRecord), { search, page });
    },
    options: {
      async list() {
        return { options: (await objectTypes()).map(({ className, showName, classDesc }) => ({
          primaryKey: className, value: className, label: showName || classDesc || className,
        })) };
      },
      async resolve(values) {
        const labels = new Map((await objectTypes()).map(({ className, showName, classDesc }) =>
          [className, showName || classDesc || className]));
        return values.map(value => {
          const primaryKey = String(value);
          const label = labels.get(primaryKey);
          return label === undefined
            ? { primaryKey, value, label: primaryKey, unavailable: { reason: "assistant.unavailable" } }
            : { primaryKey, value, label };
        });
      },
    },
    forms: {
      describe: describe("/ontology/model/object-type/form"),
      save: saveObjectType,
    },
  }, {
    objectType: ATTRIBUTE,
    async list() {
      return attributes();
    },
    async query({ search, filters, page }: PlatformObjectQuery) {
      // An attribute's display name is its label; its fields hold the owner's own texts.
      return paged((await attributes(filters?.className))
        .filter(record => matches(search, record.fields.name, record.label, record.fields.type)),
      { search, filters, page });
    },
    forms: {
      describe: describe("/ontology/model/attribute/form"),
      save: saveAttribute,
    },
  }, {
    objectType: RELATIONSHIP,
    async list() {
      return (await modelRequest<readonly RelationshipView[]>(requests, "/ontology/model/relationships", {}))
        .map(relationshipRecord);
    },
    async read(primaryKey: string) {
      return relationshipRecord(await modelRequest<RelationshipView>(requests,
        `/ontology/model/relationship?relationship=${encodeURIComponent(primaryKey)}`, {}));
    },
    async query({ search, filters, page }: PlatformObjectQuery) {
      const className = filters?.className;
      const items = (await modelRequest<readonly RelationshipView[]>(requests,
        `/ontology/model/relationships${className ? `?className=${encodeURIComponent(className)}` : ""}`, {}))
        .filter(view => matches(search, view.relationship, view.desc, view.fromclass, view.toclass))
        .map(relationshipRecord);
      return paged(items, { search, filters, page });
    },
    forms: {
      describe: describe("/ontology/model/relationship/form"),
      save: saveRelationship,
    },
  }];
};
