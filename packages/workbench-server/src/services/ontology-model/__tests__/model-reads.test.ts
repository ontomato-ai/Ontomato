import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTE,
  DELETE_ATTRIBUTE,
  DELETE_OBJECT_TYPE,
  DELETE_RELATIONSHIP,
  OBJECT_TYPE,
  platformObjectTypes,
  RELATIONSHIP,
  SET_PRIMARY_KEY,
} from "@ontomato/contracts/platform-object-types";
import { panelFormDescriptionSchema, panelOptionListSchema, panelRecordListSchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createOntologyModelReadAdapter } from "../model-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test/" } } }));

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "test-domain", userId: "test-owner" };
const viewer = { token: "test-viewer", locale: "en", apiKey: "viewer-key", headers: { "x-scope": "domain" } };

const objectTypes = [
  {
    className: "Device",
    showName: "",
    classDesc: "A device",
    attributeCount: 3,
    businessKeyCount: 1,
    relationshipCount: 2,
    primaryKey: { status: "ok", count: 1, name: "id", showName: "Device ID" },
    searchableAttributes: ["id", "Site", "site_id"],
  },
  {
    className: "Site",
    showName: "Site",
    classDesc: "A site",
    attributeCount: 1,
    businessKeyCount: 0,
    relationshipCount: 1,
    primaryKey: { status: "missing", count: 0 },
    searchableAttributes: [],
  },
];

const attributes = [
  {
    className: "Device",
    name: "id",
    showName: "",
    type: "varchar",
    attrDesc: "",
    enable: true,
    businessKey: false,
    primaryKey: true,
  },
  {
    className: "Device",
    name: "site_id",
    showName: "Site",
    type: "varchar",
    attrDesc: "Owning site",
    enable: false,
    businessKey: true,
    primaryKey: false,
  },
];

const relationships = [
  { relationship: "owns", fromclass: "Device", toclass: "Site", desc: "", fromField: "site_id", toField: "id", fromShowName: "Smart Device", toShowName: "Site" },
  { relationship: "runs", fromclass: "Site", toclass: "Device", desc: "runs on", fromField: "id", toField: "id" },
];

const option = (value: string, label: string) => ({ value, label, description: null, disabled: false, disabledReason: null });
const classOptions = [option("Device", "Device"), option("Site", "Site")];
const deviceFieldOptions = [option("id", "id"), option("site_id", "Site")];
const typeOptions = ["varchar", "int", "float", "datetime", "boolean", "text"].map(type => option(type, type));
const textField = (path: string, label: string, required: boolean) => ({
  path, label, control: { kind: "text" }, valueSchema: { type: "string" }, required, readOnly: false,
});
const selectField = (path: string, label: string, options: ReturnType<typeof option>[], refreshOnChange = false) => ({
  path,
  label,
  control: { kind: "select", options },
  valueSchema: { type: "string" },
  required: true,
  readOnly: false,
  ...(refreshOnChange && { refreshOnChange: true }),
});
const switchField = (path: string, label: string) => ({
  path, label, control: { kind: "switch" }, valueSchema: { type: "boolean" }, required: true, readOnly: false,
});

const objectTypeForm = {
  fields: [
    textField("/className", "API name", true),
    textField("/primaryKeyName", "Primary key name", true),
    textField("/showName", "Display name", true),
    textField("/classDesc", "Description", false),
  ],
  values: { className: "", primaryKeyName: "", showName: "", classDesc: "" },
  save: { method: "POST", path: "/ontology/model/object-type/create", bodySchema: { type: "object" } },
};

const attributeForm = {
  fields: [
    selectField("/className", "Owner object type", classOptions),
    textField("/name", "API name", true),
    selectField("/type", "Data type", typeOptions),
    textField("/showName", "Display name", true),
    textField("/attrDesc", "Description", false),
    switchField("/enable", "Enabled"),
    switchField("/businessKey", "Business key"),
    switchField("/primaryKey", "Primary key"),
  ],
  values: { className: "", name: "", type: "", showName: "", attrDesc: "", enable: true, businessKey: false, primaryKey: false },
  save: { method: "POST", path: "/ontology/model/attribute/create", bodySchema: { type: "object" } },
};

const relationshipForm = {
  fields: [
    textField("/relationship", "Relationship name", true),
    selectField("/fromclass", "Source object", classOptions, true),
    selectField("/fromField", "Source field", deviceFieldOptions),
    selectField("/toclass", "Target object", classOptions, true),
    selectField("/toField", "Target field", deviceFieldOptions),
    textField("/desc", "Description", true),
  ],
  values: { relationship: "", fromclass: "", fromField: "", toclass: "", toField: "", desc: "" },
  save: { method: "POST", path: "/ontology/model/relationship/create", bodySchema: { type: "object" } },
};

/** The owner labels its fields the same in the field-label read as in its forms. */
const labelsOf = (form: { fields: readonly { path: string; label: string }[] }) =>
  Object.fromEntries(form.fields.map(field => [field.path.slice(1), field.label]));
const fieldLabels = {
  objectType: labelsOf(objectTypeForm),
  attribute: labelsOf(attributeForm),
  relationship: labelsOf(relationshipForm),
};

const forms: Record<string, typeof objectTypeForm | typeof attributeForm | typeof relationshipForm> = {
  "/ontology/model/object-type/form": objectTypeForm,
  "/ontology/model/attribute/form": attributeForm,
  "/ontology/model/relationship/form": relationshipForm,
};

interface RecordedRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: Record<string, unknown> | null;
}

function stubOwner(handler: (request: RecordedRequest) => Response | undefined) {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init: NonNullable<Parameters<typeof fetch>[1]> = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    const recorded = { method: init.method ?? "GET", url, headers, body };
    requests.push(recorded);
    const response = handler(recorded);
    if (!response) throw new Error(`Unexpected owner call: ${recorded.method} ${url.pathname}${url.search}`);
    return response;
  }));
  return requests;
}

function catalogRoute(request: RecordedRequest): Response | undefined {
  if (request.method !== "GET") return undefined;
  const className = request.url.searchParams.get("className");
  switch (request.url.pathname) {
    case "/ontology/model/field-labels":
      return Response.json(fieldLabels);
    case "/ontology/model/object-types":
      return Response.json(objectTypes);
    case "/ontology/model/object-type": {
      const found = objectTypes.find(item => item.className === className);
      return found
        ? Response.json(found)
        : Response.json({ error: { code: "OBJECT_TYPE_NOT_FOUND", message: "Object type not found" } }, { status: 404 });
    }
    case "/ontology/model/attributes":
      return Response.json(className ? attributes.filter(item => item.className === className) : attributes);
    case "/ontology/model/relationships":
      return Response.json(
        className
          ? relationships.filter(item => item.fromclass === className || item.toclass === className)
          : relationships,
      );
    case "/ontology/model/relationship": {
      const rel = request.url.searchParams.get("relationship");
      const found = relationships.find(item => item.relationship === rel);
      return found
        ? Response.json(found)
        : Response.json({ error: { code: "RELATIONSHIP_NOT_FOUND", message: "Relationship not found" } }, { status: 404 });
    }
    default:
      return undefined;
  }
}

function formRoute(request: RecordedRequest): Response | undefined {
  if (request.method !== "POST") return undefined;
  const form = forms[request.url.pathname];
  return form ? Response.json(form) : undefined;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ontology model read adapter", () => {
  it("lists all three model types with owner labels, viewer headers and no cross-call label cache", async () => {
    let labelSuffix = "";
    const requests = stubOwner(request => {
      if (request.url.pathname === "/ontology/model/field-labels") {
        const objectType = Object.fromEntries(
          Object.entries(fieldLabels.objectType).map(([key, label]) => [key, `${label}${labelSuffix}`]),
        );
        return Response.json({ ...fieldLabels, objectType });
      }
      return catalogRoute(request);
    });
    const adapter = createOntologyModelReadAdapter(owner, viewer, "alice");

    const types = panelRecordListSchema.parse(await adapter.list(OBJECT_TYPE));
    expect(types).toEqual([
      {
        primaryKey: "Device",
        label: "Device",
        fields: {
          className: "Device",
          showName: "",
          classDesc: "A device",
          attributeCount: "3",
          businessKeyCount: "1",
          relationshipCount: "2",
          primaryKey: "ok",
          primaryKeyCount: "1",
          primaryKeyName: "id",
          searchableAttributes: ["id", "Site", "site_id"],
        },
        fieldLabels: { className: "API name", primaryKeyName: "Primary key name", showName: "Display name", classDesc: "Description" },
        tones: { primaryKey: "success" },
        outputs: {
          className: "Device", primaryKeyStatus: "ok", primaryKeyName: "id", primaryKeyShowName: "Device ID",
          primaryKeyCount: 1, attributeCount: 3, businessKeyCount: 1, relationshipCount: 2,
        },
      },
      {
        primaryKey: "Site",
        label: "Site",
        fields: {
          className: "Site",
          showName: "Site",
          classDesc: "A site",
          attributeCount: "1",
          businessKeyCount: "0",
          relationshipCount: "1",
          primaryKey: "missing",
          primaryKeyCount: "0",
        },
        fieldLabels: { className: "API name", showName: "Display name", classDesc: "Description" },
        tones: { primaryKey: "warning" },
        outputs: {
          className: "Site", primaryKeyStatus: "missing", primaryKeyName: "", primaryKeyShowName: "",
          primaryKeyCount: 0, attributeCount: 1, businessKeyCount: 0, relationshipCount: 1,
        },
      },
    ]);

    labelSuffix = " v2";
    const refreshedTypes = await adapter.list(OBJECT_TYPE);
    expect(refreshedTypes[0]?.fieldLabels).toEqual({
      className: "API name v2",
      primaryKeyName: "Primary key name v2",
      showName: "Display name v2",
      classDesc: "Description v2",
    });

    const attrs = panelRecordListSchema.parse(await adapter.list(ATTRIBUTE));
    expect(attrs).toEqual([
      {
        primaryKey: '["Device","id"]',
        label: "id",
        fields: {
          className: "Device",
          classNameLabel: "Device",
          ownerObject: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Device", label: "Device" },
          name: "id",
          type: "varchar",
          attrDesc: "",
          enable: "true",
          businessKey: "false",
          primaryKey: "true",
        },
        fieldLabels: {
          className: "Owner object type",
          classNameLabel: "Owner object type",
          ownerObject: "Owner object type",
          name: "API name",
          type: "Data type",
          attrDesc: "Description",
          enable: "Enabled",
          businessKey: "Business key",
          primaryKey: "Primary key",
        },
        tones: { primaryKey: "success", businessKey: "default", enable: "success" },
        outputs: { isPrimaryKey: true, className: "Device" },
      },
      {
        primaryKey: '["Device","site_id"]',
        label: "Site",
        fields: {
          className: "Device",
          classNameLabel: "Device",
          ownerObject: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Device", label: "Device" },
          name: "site_id",
          type: "varchar",
          attrDesc: "Owning site",
          enable: "false",
          businessKey: "true",
          primaryKey: "false",
        },
        fieldLabels: {
          className: "Owner object type",
          classNameLabel: "Owner object type",
          ownerObject: "Owner object type",
          name: "API name",
          type: "Data type",
          attrDesc: "Description",
          enable: "Enabled",
          businessKey: "Business key",
          primaryKey: "Primary key",
        },
        tones: { primaryKey: "default", businessKey: "info", enable: "warning" },
        outputs: { isPrimaryKey: false, className: "Device" },
      },
    ]);
    expect("references" in (attrs[0] ?? {})).toBe(false);

    const rels = panelRecordListSchema.parse(await adapter.list(RELATIONSHIP));
    expect(rels).toEqual([
      {
        primaryKey: "owns",
        label: "owns",
        subtitle: "Smart Device → Site",
        fields: {
          fromclass: "Device",
          toclass: "Site",
          fromclassLabel: "Smart Device",
          toclassLabel: "Site",
          fromObject: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Device", label: "Smart Device" },
          toObject: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Site", label: "Site" },
          desc: "",
          fromField: "site_id",
          toField: "id",
        },
        fieldLabels: {
          fromclass: "Source object",
          toclass: "Target object",
          fromObject: "Source object",
          toObject: "Target object",
          fromclassLabel: "Source object",
          toclassLabel: "Target object",
          desc: "Description",
          fromField: "Source field",
          toField: "Target field",
        },
      },
      {
        primaryKey: "runs",
        label: "runs on",
        subtitle: "Site → Device",
        fields: {
          fromclass: "Site",
          toclass: "Device",
          fromclassLabel: "Site",
          toclassLabel: "Device",
          fromObject: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Site", label: "Site" },
          toObject: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Device", label: "Device" },
          desc: "runs on",
          fromField: "id",
          toField: "id",
        },
        fieldLabels: {
          fromclass: "Source object",
          toclass: "Target object",
          fromObject: "Source object",
          toObject: "Target object",
          fromclassLabel: "Source object",
          toclassLabel: "Target object",
          desc: "Description",
          fromField: "Source field",
          toField: "Target field",
        },
      },
    ]);

    // Lists read under the readers' GET permission; no form description is posted for labels.
    expect(requests.every(req => req.method === "GET")).toBe(true);
    for (const req of requests) {
      expect(req.headers.get("tk")).toBe(viewer.token);
      expect(req.headers.get("Accept-Language")).toBe(viewer.locale);
      expect(req.headers.get("X-API-Key")).toBe(viewer.apiKey);
      expect(req.headers.get("x-scope")).toBe("domain");
    }
  });

  it("filters attributes and relationships by className on the Java endpoint", async () => {
    const requests = stubOwner(request => catalogRoute(request) ?? formRoute(request));
    const adapter = createOntologyModelReadAdapter(owner, viewer);

    await adapter.list(ATTRIBUTE, { className: "Device" });
    await adapter.list(RELATIONSHIP, { className: "Site" });

    expect(requests.some(r => r.url.pathname === "/ontology/model/attributes" && r.url.search === "?className=Device")).toBe(true);
    expect(requests.some(r => r.url.pathname === "/ontology/model/relationships" && r.url.search === "?className=Site")).toBe(true);
  });

  it("reads single records for all three types and surfaces 404s when missing", async () => {
    stubOwner(request => request.url.pathname === "/ontology/model/object-types"
      ? Response.json([{ ...objectTypes[0], showName: "Smart Device" }, objectTypes[1]])
      : catalogRoute(request));
    const adapter = createOntologyModelReadAdapter(owner, viewer);

    const objectType = panelRecordSchema.parse(await adapter.record(OBJECT_TYPE, "Device"));
    expect(objectType).toMatchObject({
      primaryKey: "Device",
      label: "Device",
      fields: { attributeCount: "3", primaryKey: "ok", primaryKeyName: "id" },
      fieldLabels: { className: "API name", showName: "Display name", classDesc: "Description" },
      tones: { primaryKey: "success" },
      outputs: { primaryKeyStatus: "ok", primaryKeyName: "id", attributeCount: 3, businessKeyCount: 1, relationshipCount: 2 },
    });

    const attribute = panelRecordSchema.parse(await adapter.record(ATTRIBUTE, JSON.stringify(["Device", "site_id"])));
    expect(attribute).toMatchObject({
      primaryKey: '["Device","site_id"]',
      label: "Site",
      fields: {
        className: "Device", name: "site_id", businessKey: "true", classNameLabel: "Smart Device",
        ownerObject: { kind: "reference", className: OBJECT_TYPE, primaryKey: "Device", label: "Smart Device" },
      },
      tones: { primaryKey: "default", businessKey: "info", enable: "warning" },
      outputs: { isPrimaryKey: false, className: "Device" },
    });

    const relationship = panelRecordSchema.parse(await adapter.record(RELATIONSHIP, "owns"));
    expect(relationship.fields).toMatchObject({ fromclass: "Device", toclass: "Site", fromField: "site_id" });

    await expect(adapter.record(ATTRIBUTE, JSON.stringify(["Device", "gone"])))
      .rejects.toMatchObject({ status: 404, code: "ATTRIBUTE_NOT_FOUND" });
    await expect(adapter.record(OBJECT_TYPE, "Missing"))
      .rejects.toMatchObject({ status: 404, message: "Object type not found" });
    await expect(adapter.record(RELATIONSHIP, "missing"))
      .rejects.toMatchObject({ status: 404, message: "Relationship not found" });
  });

  it.each([
    [{ status: "multiple", count: 2 }, "danger"],
    [{ status: "disabled", count: 1, name: "id", showName: "Device ID" }, "warning"],
  ])("reports the owner's primary key state and count", async (primaryKey, tone) => {
    stubOwner(request => request.url.pathname === "/ontology/model/object-type"
      ? Response.json({ ...objectTypes[0], primaryKey })
      : catalogRoute(request));
    const adapter = createOntologyModelReadAdapter(owner, viewer);

    expect(await adapter.record(OBJECT_TYPE, "Device")).toMatchObject({
      tones: { primaryKey: tone },
      fields: { primaryKeyCount: String(primaryKey.count) },
      outputs: { primaryKeyStatus: primaryKey.status, primaryKeyCount: primaryKey.count },
    });
  });

  it("describes edit forms and create forms with the right targets and changedField refreshes", async () => {
    const formRequests: Record<string, unknown>[] = [];
    stubOwner(request => {
      if (request.method === "POST" && forms[request.url.pathname]) {
        formRequests.push(request.body!);
        return Response.json(forms[request.url.pathname]);
      }
      return catalogRoute(request);
    });
    const adapter = createOntologyModelReadAdapter(owner, viewer);

    const create = panelFormDescriptionSchema.parse(await adapter.createForm(OBJECT_TYPE, {}));
    expect(formRequests.at(-1)).toEqual({ target: { kind: "draft" }, changedField: null });
    expect(create.errors).toEqual([]);
    expect(create.fields.map(field => field.path)).toContain("/primaryKeyName");

    panelFormDescriptionSchema.parse(await adapter.createForm(ATTRIBUTE));
    expect(formRequests.at(-1)).toEqual({ target: { kind: "draft" }, changedField: null });

    await adapter.form(OBJECT_TYPE, "Device", {});
    expect(formRequests.at(-1)).toEqual({
      target: { kind: "object", objectType: OBJECT_TYPE, primaryKey: "Device" },
      changedField: null,
    });

    await adapter.form(RELATIONSHIP, "owns", { values: { fromclass: "Site" }, changedField: "/fromclass" });
    expect(formRequests.at(-1)).toEqual({
      target: { kind: "object", objectType: RELATIONSHIP, primaryKey: "owns" },
      values: { fromclass: "Site" },
      changedField: "/fromclass",
    });

    await adapter.createForm(RELATIONSHIP, { values: { fromclass: "Device" }, changedField: "/fromclass" });
    expect(formRequests.at(-1)).toEqual({
      target: { kind: "draft" },
      values: { fromclass: "Device" },
      changedField: "/fromclass",
    });
  });

  it("merges 422 field validation refusals into the form description for both createForm and form", async () => {
    const refreshes: unknown[] = [];
    stubOwner(request => {
      if (request.method !== "POST" || !forms[request.url.pathname]) return catalogRoute(request);
      const body = request.body!;
      if (body.changedField !== null) refreshes.push(body);
      if (body.values !== undefined && body.changedField === null) {
        return Response.json({
          error: {
            code: "FIELD_VALIDATION_FAILED",
            message: "Some fields are invalid",
            fields: [{ field: "/values/showName", code: "required", message: "A display name is required" }],
          },
        }, { status: 422 });
      }
      return Response.json(forms[request.url.pathname]);
    });
    const adapter = createOntologyModelReadAdapter(owner, viewer);
    const createDraft = { className: "Pump", primaryKeyName: "pump_no", showName: "", classDesc: "" };

    const createResult = panelFormDescriptionSchema.parse(await adapter.createForm(OBJECT_TYPE, { values: createDraft }));
    expect(createResult).toMatchObject({
      values: createDraft,
      errors: [{ field: "/showName", code: "required", message: "A display name is required" }],
    });
    expect(createResult.fields.map(field => field.path)).toContain("/primaryKeyName");
    // The form is re-described around the refused draft, not the empty opening form.
    expect(refreshes.at(-1)).toEqual({ target: { kind: "draft" }, values: createDraft, changedField: "/showName" });
    // A partial draft keeps the owner's defaults for the fields it left out.
    const partial = panelFormDescriptionSchema.parse(await adapter.createForm(OBJECT_TYPE, { values: { showName: "" } }));
    expect(partial.values).toEqual({ ...objectTypeForm.values, showName: "" });

    const editDraft = { className: "Device", name: "site_id", showName: "", attrDesc: "", enable: true, businessKey: false, primaryKey: false };
    const editResult = panelFormDescriptionSchema.parse(
      await adapter.form(ATTRIBUTE, JSON.stringify(["Device", "site_id"]), { values: editDraft }),
    );
    expect(editResult).toMatchObject({
      values: editDraft,
      errors: [{ field: "/showName", code: "required", message: "A display name is required" }],
    });
  });

  it("returns normalized values on valid draft checks and exposes non-validation failures", async () => {
    const normalized = { className: "Pump", primaryKeyName: "pump_no", showName: "Pump", classDesc: "" };
    stubOwner(request => {
      if (request.method === "POST" && request.url.pathname === "/ontology/model/object-type/form") {
        if (request.body?.values !== undefined && request.body.changedField === null) {
          return Response.json({ ...objectTypeForm, values: normalized });
        }
        return Response.json(objectTypeForm);
      }
      if (request.method === "POST" && request.url.pathname === "/ontology/model/relationship/form") {
        return Response.json({ error: { code: "MODEL_INVALID", message: "Model is broken" } }, { status: 409 });
      }
      return catalogRoute(request);
    });
    const adapter = createOntologyModelReadAdapter(owner, viewer);
    const draft = { className: "Pump ", primaryKeyName: "pump_no", showName: "Pump", classDesc: "" };

    const form = panelFormDescriptionSchema.parse(await adapter.createForm(OBJECT_TYPE, { values: draft }));
    expect(form.values).toEqual(normalized);
    expect(form.errors).toEqual([]);

    await expect(adapter.createForm(RELATIONSHIP, { values: { relationship: "bad" } }))
      .rejects.toMatchObject({ status: 409, code: "MODEL_INVALID" });
    await expect(adapter.list("platform:Unknown")).rejects.toThrow("Unsupported ontology model type: platform:Unknown");
  });

  it("describes each registered action operation from the operation the coordinator dispatches", () => {
    const adapter = createOntologyModelReadAdapter(owner, viewer);
    for (const [typeId, operation] of [
      [OBJECT_TYPE, DELETE_OBJECT_TYPE],
      [ATTRIBUTE, DELETE_ATTRIBUTE],
      [ATTRIBUTE, SET_PRIMARY_KEY],
      [RELATIONSHIP, DELETE_RELATIONSHIP],
    ] as const) {
      // An operation is described by the operations read of the member that names it, not by a read of its own.
      expect(platformObjectTypes[typeId]!.reads).not.toHaveProperty([`${operation}.describe`]);
      expect(platformObjectTypes[typeId]!.operations).toContain(operation);
    }

    expect(adapter.describe(DELETE_OBJECT_TYPE)).toMatchObject({
      handlerRef: DELETE_OBJECT_TYPE,
      label: "Delete object type",
      effect: "write",
      batch: false,
      target: { source: "input", input: "objectType" },
      inspectImpact: { handlerRef: `${DELETE_OBJECT_TYPE}.inspect-impact` },
    });
    const setPrimaryKey = adapter.describe(SET_PRIMARY_KEY);
    expect(setPrimaryKey).toMatchObject({ label: "Set as primary key", target: { source: "input", input: "attribute" } });
    expect(setPrimaryKey.inspectImpact).toEqual({ handlerRef: `${SET_PRIMARY_KEY}.inspect-impact` });
    expect(adapter.describe(DELETE_RELATIONSHIP).target).toEqual({ source: "input", input: "relationship" });
  });

  it("forwards mode=inline for inlineForm reads and preserves submitOn declarations", async () => {
    const requestedUrls: string[] = [];
    stubOwner(request => {
      if (request.method === "POST" && request.url.pathname === "/ontology/model/object-type/form") {
        requestedUrls.push(`${request.url.pathname}${request.url.search}`);
        return Response.json({
          ...objectTypeForm,
          fields: [
            {
              path: "/showName",
              label: "Display name",
              required: false,
              readOnly: false,
              valueSchema: { type: "string" },
              control: { kind: "text" },
              submitOn: "blur",
            },
          ],
        });
      }
      if (request.method === "POST" && request.url.pathname === "/ontology/model/attribute/form") {
        requestedUrls.push(`${request.url.pathname}${request.url.search}`);
        return Response.json({
          ...objectTypeForm,
          fields: [
            {
              path: "/enable",
              label: "Enabled",
              required: false,
              readOnly: false,
              valueSchema: { type: "boolean" },
              control: { kind: "switch" },
              submitOn: "change",
            },
          ],
          values: { className: "Device", name: "site_id", enable: true },
        });
      }
      return catalogRoute(request);
    });
    const adapter = createOntologyModelReadAdapter(owner, viewer);
    const objectInline = panelFormDescriptionSchema.parse(await adapter.inlineForm(OBJECT_TYPE, "Device"));
    const attrInline = panelFormDescriptionSchema.parse(
      await adapter.inlineForm(ATTRIBUTE, JSON.stringify(["Device", "site_id"])),
    );
    expect(requestedUrls).toEqual([
      "/ontology/model/object-type/form?mode=inline",
      "/ontology/model/attribute/form?mode=inline",
    ]);
    expect(objectInline.fields[0]?.submitOn).toBe("blur");
    expect(attrInline.fields[0]?.submitOn).toBe("change");
  });

  it("offers the classes as picker options and resolves chosen class names, keeping a vanished one as unavailable", async () => {
    stubOwner(request => request.url.pathname === "/ontology/model/object-types"
      ? Response.json([{ ...objectTypes[0], showName: "Site" }, objectTypes[1]])
      : catalogRoute(request));
    const adapter = createOntologyModelReadAdapter(owner, viewer);

    expect(panelOptionListSchema.parse(await adapter.objectTypeOptions())).toEqual({ options: [
      { primaryKey: "Device", value: "Device", label: "Site (Device)", description: "A device" },
      { primaryKey: "Site", value: "Site", label: "Site", description: "A site" },
    ] });
    expect(panelOptionListSchema.parse(await adapter.resolveObjectTypes(["Device", "Gone"]))).toEqual({ options: [
      { primaryKey: "Device", value: "Device", label: "Site (Device)", description: "A device" },
      { primaryKey: "Gone", value: "Gone", label: "Gone", unavailable: { reason: "This object type no longer exists." } },
    ] });
  });
});

it("carries the attribute form's optional-values column through the contract as the owner declares it", async () => {
  // The shape the Java owner emits for a text or numeric attribute: three columns, and a tone choice that is cleared
  // instead of offered as an empty option.
  const optionsField = {
    path: "/options",
    label: "Optional values",
    required: false,
    readOnly: false,
    valueSchema: {
      type: "array",
      title: "Optional values",
      items: {
        type: "object",
        properties: {
          value: { type: ["string", "number"] },
          label: { type: "string" },
          tone: { type: ["string", "null"] },
        },
        required: ["value", "label"],
        additionalProperties: false,
      },
    },
    control: {
      kind: "object-array",
      itemKeyPath: "/value",
      presentation: "table",
      itemFields: [
        { path: "/value", label: "Value", required: true, readOnly: false, valueSchema: { type: "string", title: "Value" }, control: { kind: "text" } },
        { path: "/label", label: "Display name", required: true, readOnly: false, valueSchema: { type: "string", title: "Display name" }, control: { kind: "text" } },
        {
          path: "/tone",
          label: "Tone",
          required: false,
          readOnly: false,
          valueSchema: { type: ["string", "null"], title: "Tone" },
          control: {
            kind: "select",
            clearable: true,
            options: ["default", "info", "success", "warning", "danger"].map(tone => ({
              value: tone, label: tone, description: null, disabled: false, disabledReason: null,
            })),
          },
        },
      ],
      defaultItem: { value: "", label: "", tone: null },
    },
  };
  stubOwner(request => {
    if (request.url.pathname === "/ontology/model/attribute/form") {
      return Response.json({
        ...attributeForm,
        fields: [...attributeForm.fields, optionsField],
        values: { ...attributeForm.values, options: [{ value: "DRAFT", label: "Draft", tone: "warning" }] },
      });
    }
    return undefined;
  });

  const form = await createOntologyModelReadAdapter(owner, viewer).createForm(ATTRIBUTE);
  expect(panelFormDescriptionSchema.parse(form)).toEqual(form);
  const options = form.fields.find(field => field.path === "/options");
  expect(options?.control).toMatchObject({ kind: "object-array", presentation: "table", itemKeyPath: "/value" });
  expect(form.values.options).toEqual([{ value: "DRAFT", label: "Draft", tone: "warning" }]);
});
