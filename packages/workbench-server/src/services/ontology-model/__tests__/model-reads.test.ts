import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { panelFormDescriptionSchema, panelRecordListSchema, panelRecordSchema } from "@ontomato/contracts/panel-projection";
import { createOntologyModelReadAdapter } from "../model-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test/" } } }));

const owner = { domainId: "test-domain", userId: "test-owner" };
const viewer = { token: "test-viewer", locale: "en", apiKey: "viewer-key", headers: { "x-scope": "domain" } };

const objectTypes = [
  {
    className: "Device",
    showName: "",
    classDesc: "A device",
    attributeCount: 3,
    businessKeyCount: 1,
    relationshipCount: 1,
    primaryKey: { status: "ok", name: "id" },
  },
  {
    className: "Site",
    showName: "Site",
    classDesc: "A site",
    attributeCount: 1,
    businessKeyCount: 0,
    relationshipCount: 1,
    primaryKey: { status: "missing" },
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
    enable: true,
    businessKey: true,
    primaryKey: false,
  },
];

const relationships = [
  { relationship: "owns", fromclass: "Device", toclass: "Site", desc: "", fromField: "site_id", toField: "id" },
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
  save: { method: "POST", path: "/ontology/model/object-type/create", bodySchema: { type: "object" }, draftOperation: "objectType.create" },
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
  save: { method: "POST", path: "/ontology/model/attribute/create", bodySchema: { type: "object" }, draftOperation: "attribute.create" },
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
  save: { method: "POST", path: "/ontology/model/relationship/create", bodySchema: { type: "object" }, draftOperation: "relationship.create" },
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
      if (request.method === "POST" && request.url.pathname === "/ontology/model/object-type/form") {
        return Response.json({
          ...objectTypeForm,
          fields: objectTypeForm.fields.map(field => ({ ...field, label: `${field.label}${labelSuffix}` })),
        });
      }
      return catalogRoute(request) ?? formRoute(request);
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
          relationshipCount: "1",
          primaryKey: "ok",
        },
        fieldLabels: { className: "API name", showName: "Display name", classDesc: "Description" },
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
        },
        fieldLabels: { className: "API name", showName: "Display name", classDesc: "Description" },
      },
    ]);

    labelSuffix = " v2";
    const refreshedTypes = await adapter.list(OBJECT_TYPE);
    expect(refreshedTypes[0]?.fieldLabels).toEqual({
      className: "API name v2",
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
          name: "id",
          type: "varchar",
          attrDesc: "",
          enable: "true",
          businessKey: "false",
          primaryKey: "true",
        },
        fieldLabels: {
          className: "Owner object type",
          name: "API name",
          type: "Data type",
          attrDesc: "Description",
          enable: "Enabled",
          businessKey: "Business key",
          primaryKey: "Primary key",
        },
      },
      {
        primaryKey: '["Device","site_id"]',
        label: "Site",
        fields: {
          className: "Device",
          name: "site_id",
          type: "varchar",
          attrDesc: "Owning site",
          enable: "true",
          businessKey: "true",
          primaryKey: "false",
        },
        fieldLabels: {
          className: "Owner object type",
          name: "API name",
          type: "Data type",
          attrDesc: "Description",
          enable: "Enabled",
          businessKey: "Business key",
          primaryKey: "Primary key",
        },
      },
    ]);
    expect("references" in (attrs[0] ?? {})).toBe(false);

    const rels = panelRecordListSchema.parse(await adapter.list(RELATIONSHIP));
    expect(rels).toEqual([
      {
        primaryKey: "owns",
        label: "owns",
        fields: { fromclass: "Device", toclass: "Site", desc: "", fromField: "site_id", toField: "id" },
        fieldLabels: {
          fromclass: "Source object",
          toclass: "Target object",
          desc: "Description",
          fromField: "Source field",
          toField: "Target field",
        },
      },
      {
        primaryKey: "runs",
        label: "runs on",
        fields: { fromclass: "Site", toclass: "Device", desc: "runs on", fromField: "id", toField: "id" },
        fieldLabels: {
          fromclass: "Source object",
          toclass: "Target object",
          desc: "Description",
          fromField: "Source field",
          toField: "Target field",
        },
      },
    ]);

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
    stubOwner(request => catalogRoute(request) ?? formRoute(request));
    const adapter = createOntologyModelReadAdapter(owner, viewer);

    const objectType = panelRecordSchema.parse(await adapter.record(OBJECT_TYPE, "Device"));
    expect(objectType).toMatchObject({
      primaryKey: "Device",
      label: "Device",
      fields: { attributeCount: "3", primaryKey: "ok" },
      fieldLabels: { className: "API name", showName: "Display name", classDesc: "Description" },
    });

    const attribute = panelRecordSchema.parse(await adapter.record(ATTRIBUTE, JSON.stringify(["Device", "site_id"])));
    expect(attribute).toMatchObject({
      primaryKey: '["Device","site_id"]',
      label: "Site",
      fields: { className: "Device", name: "site_id", businessKey: "true" },
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
    expect(create.save.draftOperation).toBe("objectType.create");

    const attrCreate = panelFormDescriptionSchema.parse(await adapter.createForm(ATTRIBUTE));
    expect(formRequests.at(-1)).toEqual({ target: { kind: "draft" }, changedField: null });
    expect(attrCreate.save.draftOperation).toBe("attribute.create");

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
      save: { draftOperation: "objectType.create" },
    });
    expect(createResult.fields.map(field => field.path)).toContain("/primaryKeyName");
    // The form is re-described around the refused draft, not the empty opening form.
    expect(refreshes.at(-1)).toEqual({ target: { kind: "draft" }, values: createDraft, changedField: "/showName" });

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
});
