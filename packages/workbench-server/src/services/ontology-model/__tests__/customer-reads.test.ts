import { afterEach, expect, it, vi } from "vitest";
import { panelFormDescriptionSchema, panelRecordQuerySchema, panelRecordSchema, panelRelationNeighborsSchema } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createCustomerOntologyReadAdapter, prepareCustomerNeighborsRead } from "../customer-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "test-domain", userId: "test-owner" };
const viewer = { token: "test-viewer", locale: "en" };

const personAttributes = [
  { className: "person", name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
  { className: "person", name: "name", showName: "Name", type: "varchar", attrDesc: "", enable: true, businessKey: true, primaryKey: false },
  { className: "person", name: "age", showName: "Age", type: "int", attrDesc: "", enable: true, businessKey: false, primaryKey: false },
];
const orgAttributes = [
  { className: "org", name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
  { className: "org", name: "title", showName: "Title", type: "varchar", attrDesc: "", enable: true, businessKey: true, primaryKey: false },
];
const logAttributes = [
  { className: "log", name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
];
const classAttributes: Record<string, typeof personAttributes> = {
  person: personAttributes,
  org: orgAttributes,
  log: logAttributes,
};
type OwnerRequest = { url: URL; body?: Record<string, any> };
type OwnerHandler = (request: OwnerRequest) => Response | undefined;

/** Stubs the owner calls with one router; every request must carry the viewer's token and language. */
function stubOwner(handle: OwnerHandler) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    expect(new Headers(init.headers).get("Accept-Language")).toBe("en");
    const request: OwnerRequest = { url: new URL(url) };
    if (init.body) request.body = JSON.parse(String(init.body));
    const response = handle(request);
    if (response) return response;
    throw new Error(`Unexpected owner request ${init.method} ${request.url.pathname}`);
  }));
}

function catalogRoute(request: OwnerRequest): Response | undefined {
  if (request.url.pathname !== "/ontology/model/attributes") return undefined;
  const attributes = classAttributes[request.url.searchParams.get("className")!];
  return attributes
    ? Response.json(attributes)
    : Response.json({ error: { code: "OBJECT_TYPE_NOT_FOUND", message: "Class not found" } }, { status: 404 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("queries a class's page with the declared paging and maps each row the owner returns", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/getWholeClassDataByPage") {
      expect(request.body).toEqual({
        classname: "person", pagenum: 2, pagecount: 3, search: "ali",
        filters: [{ field: "age", operator: "gte", value: 30 }], sort: { field: "name", order: "desc" },
      });
      return Response.json({
        success: true,
        data: [
          { id: "p1", name: "Alice", age: 30 },
          { id: "p2", name: null, age: null },
          { id: "p3", name: "Zed", age: { years: 30 } },
        ],
        total_count: 42, readable_fields: ["id", "name", "age"],
        total_page: 14,
        cur_page: 2,
      });
    }
    return undefined;
  });

  const page = await createCustomerOntologyReadAdapter(owner, viewer).query("person", {
    search: "ali", page: { number: 2, size: 5 }, size: 3,
    filters: [{ field: "age", operator: "gte", value: 30 }], sort: { field: "name", order: "desc" },
  });
  // The total is the owner's count, not the rows this page happens to hold.
  expect(page.total).toBe(42);
  panelRecordQuerySchema.parse(page);
  expect(page.rows.map(record => panelRecordSchema.parse(record))).toEqual([
    {
      className: "person", primaryKey: "p1", label: "Alice",
      fields: { id: "p1", name: "Alice", age: "30" },
      fieldLabels: { id: "ID", name: "Name", age: "Age" },
    },
    {
      // Empty business keys fall back to the primary key, and null values become empty text.
      className: "person", primaryKey: "p2", label: "p2",
      fields: { id: "p2", name: "", age: "" },
      fieldLabels: { id: "ID", name: "Name", age: "Age" },
    },
    {
      className: "person", primaryKey: "p3", label: "Zed",
      fields: { id: "p3", name: "Zed", age: '{"years":30}' },
      fieldLabels: { id: "ID", name: "Name", age: "Age" },
    },
  ]);
});

it("labels a class without business keys by the primary key", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/getWholeClassDataByPage")
      return Response.json({ success: true, data: [{ id: "l9", message: "started" }], total_count: 1, readable_fields: ["id", "message"] });
    return undefined;
  });

  const page = await createCustomerOntologyReadAdapter(owner, viewer).query("log", {});
  expect(page.rows[0]).toMatchObject({ primaryKey: "l9", label: "l9" });
});

it("keeps no visible fields distinct from forbidden and an empty page", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/getWholeClassDataByPage")
      return Response.json({ success: false, code: "NO_VISIBLE_FIELDS", message: "您没有数据权限" });
    return undefined;
  });

  await expect(createCustomerOntologyReadAdapter(owner, viewer).query("person", {}))
    .rejects.toMatchObject({ status: 422, code: "NO_VISIBLE_FIELDS" });
});

it("reads one object and restores the primary-key value the owner omits", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode") {
      expect(request.body).toEqual({ class: "person", id: "person:p1" });
      // Java drops a primary-key column literally named "id" from the answer.
      return Response.json({ success: true, data: { classDef: { className: "person" }, data: { name: "Alice", age: 30 } } });
    }
    return undefined;
  });

  const record = panelRecordSchema.parse(await createCustomerOntologyReadAdapter(owner, viewer).record("person", "p1"));
  expect(record).toEqual({
    className: "person", primaryKey: "p1", label: "Alice",
    fields: { id: "p1", name: "Alice", age: "30" },
    fieldLabels: { id: "ID", name: "Name", age: "Age" },
  });
});

it("tells the owner's missing object, permission refusal and query failure apart by code, whatever the language", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode") {
      const answers: Record<string, unknown> = {
        "person:p9": { success: false, code: "OBJECT_NOT_FOUND", message: "对象不存在" },
        "person:p1": { success: false, code: "DATA_PERMISSION_DENIED", message: "您没有数据权限" },
        "person:p5": { success: false, code: "QUERY_FAILED", message: "查询出错" },
      };
      return Response.json(answers[request.body?.id as string]);
    }
    return undefined;
  });

  const reads = createCustomerOntologyReadAdapter(owner, viewer);
  await expect(reads.record("person", "p9")).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND", message: "对象不存在" });
  await expect(reads.record("person", "p1")).rejects.toMatchObject({ status: 403, code: "CUSTOMER_DATA_PERMISSION" });
  await expect(reads.record("person", "p5")).rejects.toMatchObject({ status: 502, code: "CUSTOMER_OBJECT_READ_FAILED" });
});

const anchor = { className: "person", primaryKey: "p1" };
const org = { className: "org", primaryKey: "o1" };

function directionRows(direction: "incoming" | "outgoing", targetClass: string, rows: Record<string, unknown>[]) {
  return { direction, targetClass, status: "ok", rows };
}

const peopleFacts = {
  anchor: { attributes: personAttributes, answer: { success: true, data: { data: { name: "Alice" } } } },
  label: "Friends",
  targetAttributes: {},
  typeLabels: { person: "Person" },
};

it("reads the declared relationship from its incoming end, with all readable business keys and continuation", () => {
  const first = prepareCustomerNeighborsRead("person_to_org", { node: org, limit: 1 }, "en");
  const second = prepareCustomerNeighborsRead("person_to_org", { node: org, limit: 1, offset: 1 }, "en");
  expect(first.call).toEqual({ type: "customer:Relationship", name: "neighbors", parameters: {
    relationshipId: "person_to_org", node: org, limit: 1, offset: 0,
  } });
  expect(second.call.parameters.offset).toBe(1);
  const facts = {
    anchor: { attributes: orgAttributes, answer: { success: true, data: { data: { title: "Acme" } } } },
    label: "Belongs to",
    targetAttributes: { person: [...personAttributes,
      { ...personAttributes[1], name: "team", showName: "Team" }] },
    typeLabels: { person: "Person", org: "Organization" },
  };
  const p1 = { id: "p1", name: "Alice", team: "Ops" };
  const p3 = { id: "p3" };
  expect(panelRelationNeighborsSchema.parse(first.present({
    ...facts, directions: [directionRows("incoming", "person", [p1, p3])],
  }))).toMatchObject({
    node: { ...org, label: "Acme", typeLabel: "Organization", layer: "fact" },
    neighbors: [{ ...anchor, label: "Alice / Ops", typeLabel: "Person", layer: "fact" }],
    edges: [{ relationKind: "person_to_org", from: anchor, to: org, direction: "incoming", derived: false }],
    relations: [{ relationKind: "person_to_org", status: "ok", edgeCount: 1, truncated: true }],
    nextOffset: 1, total: null,
  });
  expect(second.present({ ...facts, directions: [directionRows("incoming", "person", [p3])] })).toMatchObject({
    neighbors: [{ primaryKey: "p3", label: "p3" }],
    relations: [{ status: "ok", edgeCount: 1, truncated: false }],
    nextOffset: null, total: 2,
  });
});

it("pages the outgoing then incoming edges of a self-loop and keeps a neighbor reached twice as one", () => {
  const rows = [{ id: "p2", name: "Bob" }];
  const facts = { ...peopleFacts, directions: [directionRows("incoming", "person", rows), directionRows("outgoing", "person", rows)] };
  const first = prepareCustomerNeighborsRead("person_to_person", { node: anchor, limit: 1 }).present(facts);
  const second = prepareCustomerNeighborsRead("person_to_person", { node: anchor, limit: 1, offset: first.nextOffset }).present(facts);
  const all = prepareCustomerNeighborsRead("person_to_person", { node: anchor }).present(facts);
  expect(first).toMatchObject({ edges: [{ direction: "outgoing", from: anchor }], nextOffset: 1, total: null });
  expect(second).toMatchObject({ edges: [{ direction: "incoming", to: anchor }], nextOffset: null, total: 2 });
  expect(all.neighbors).toEqual([{ className: "person", primaryKey: "p2", label: "Bob", layer: "fact", typeLabel: "Person" }]);
  expect(all.edges.map(edge => edge.id)).toEqual(["person_to_person:outgoing:p1:p2", "person_to_person:incoming:p1:p2"]);
});

it("refuses relationKinds that point the read at another relationship", () => {
  expect(() => prepareCustomerNeighborsRead("person_to_org", { node: anchor, relationKinds: ["person_to_person"] }))
    .toThrow("relationKinds can only name the source relationship");
});

it("fails a relationship the anchor's class does not have", () => {
  expect(prepareCustomerNeighborsRead("made_up", { node: anchor }).present({
    ...peopleFacts, label: null, directions: [],
  })).toMatchObject({ edges: [], relations: [{ relationKind: "made_up", status: "failed", edgeCount: 0, truncated: false }] });
});

it("reports a refusal in one direction and preserves rows in the other", () => {
  const direction = { direction: "incoming", targetClass: "person" };
  expect(prepareCustomerNeighborsRead("person_to_person", { node: anchor }).present({
    ...peopleFacts, directions: [
      directionRows("outgoing", "person", [{ id: "p2", name: "Bob" }]),
      { ...direction, status: "refused", reason: "Class is outside the authorized scope" },
    ],
  })).toMatchObject({
    edges: [{ direction: "outgoing" }],
    relations: [{ relationKind: "person_to_person", status: "refused", edgeCount: 1, reason: "Class is outside the authorized scope" }],
    nextOffset: null, total: null,
  });
});

it("marks the relationship failed when the owner reports an execution failure", () => {
  expect(prepareCustomerNeighborsRead("person_to_person", { node: anchor }, "en").present({
    ...peopleFacts, directions: [{ direction: "outgoing", targetClass: "person", status: "failed" }],
  })).toMatchObject({
    relations: [{ status: "failed", edgeCount: 0, reason: "Failed to read this relationship. Please try again later." }],
  });
});

it.each([
  ["DATA_PERMISSION_DENIED", 403, "CUSTOMER_DATA_PERMISSION"],
  ["OBJECT_NOT_FOUND", 404, "OBJECT_NOT_FOUND"],
])("keeps center failure %s separate from a relationship refusal", (code, status, expectedCode) => {
  const { present } = prepareCustomerNeighborsRead("person_to_org", { node: anchor });
  try {
    present({
      ...peopleFacts, label: null, directions: [],
      anchor: { ...peopleFacts.anchor, answer: { success: false, code, message: "Owner's reason" } },
    });
    expect.unreachable();
  } catch (error) {
    expect(error).toMatchObject({ status, code: expectedCode, message: "Owner's reason" });
  }
});

it("reads an ordinary customer class edit form from attribute metadata and current object values", async () => {
  const richAttributes = [
    { className: "student", name: "id", showName: "Student ID", type: "varchar", attrDesc: "Unique ID", enable: true, businessKey: false, primaryKey: true },
    { className: "student", name: "name", showName: "Full Name", type: "varchar", attrDesc: "Display name", enable: true, businessKey: true, primaryKey: false },
    { className: "student", name: "age", showName: "Age", type: "int", attrDesc: "", enable: true, businessKey: false, primaryKey: false },
    { className: "student", name: "score", showName: "Score", type: "float", attrDesc: "", enable: true, businessKey: false, primaryKey: false },
    { className: "student", name: "active", showName: "Active", type: "boolean", attrDesc: "", enable: true, businessKey: false, primaryKey: false },
    { className: "student", name: "bio", showName: "Bio", type: "text", attrDesc: "", enable: true, businessKey: false, primaryKey: false },
    { className: "student", name: "status", showName: "Status", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: false, enum: ["pending", "approved"] },
    { className: "student", name: "legacy", showName: "Legacy", type: "varchar", attrDesc: "", enable: false, businessKey: false, primaryKey: false },
  ];
  stubOwner(request => {
    if (request.url.pathname === "/ontology/model/attributes") return Response.json(richAttributes);
    if (request.url.pathname === "/data/queryInfoByNode") {
      expect(request.body).toEqual({ class: "student", id: "student:s-1" });
      return Response.json({
        success: true,
        data: { data: { name: "Li Ming", age: "16", score: 92.5, active: "true", bio: "Track A", status: "pending" } },
      });
    }
    return undefined;
  });

  const form = await createCustomerOntologyReadAdapter(owner, viewer).form("student", "s-1");
  expect(panelFormDescriptionSchema.parse(form)).toEqual(form);
  // Disabled attribute 'legacy' is excluded; primary key is readOnly in edit mode.
  expect(form.fields.map(field => field.path)).toEqual(["/id", "/name", "/age", "/score", "/active", "/bio", "/status"]);
  expect(form.fields[0]).toMatchObject({ path: "/id", label: "Student ID", help: "Unique ID", required: true, readOnly: true, control: { kind: "text" } });
  expect(form.fields[2]).toMatchObject({ path: "/age", control: { kind: "number" } });
  expect(form.fields[4]).toMatchObject({ path: "/active", control: { kind: "switch" } });
  expect(form.fields[5]).toMatchObject({ path: "/bio", control: { kind: "text", multiline: true, rows: 3 } });
  expect(form.fields[6]).toMatchObject({
    path: "/status",
    control: {
      kind: "select",
      options: [
        { value: "pending", label: "pending", description: null, disabled: false, disabledReason: null },
        { value: "approved", label: "approved", description: null, disabled: false, disabledReason: null },
      ],
    },
  });
  expect(form.values).toEqual({
    id: "s-1", name: "Li Ming", age: 16, score: 92.5, active: true, bio: "Track A", status: "pending",
  });
  expect(form.errors).toEqual([]);
  expect(form.save.method).toBe("PUT");

  // Draft validation merges editable values, keeps read-only PK, and reports type/option violations.
  const checked = await createCustomerOntologyReadAdapter(owner, viewer).form("student", "s-1", {
    values: { id: "hacked", name: "Li Hua", age: 16.5, status: "unknown" },
    changedField: null,
  });
  expect(checked.values.id).toBe("s-1");
  expect(checked.values.name).toBe("Li Hua");
  expect(checked.errors).toEqual([
    expect.objectContaining({ field: "/age", code: "invalid_number" }),
    expect.objectContaining({ field: "/status", code: "invalid_option" }),
  ]);
});

it("reads an ordinary customer class createForm with editable primary key and validates required/typed draft fields", async () => {
  stubOwner(request => catalogRoute(request));

  const form = await createCustomerOntologyReadAdapter(owner, viewer).createForm("person");
  expect(panelFormDescriptionSchema.parse(form)).toEqual(form);
  expect(form.fields.map(field => field.path)).toEqual(["/id", "/name", "/age"]);
  expect(form.fields[0]).toMatchObject({ path: "/id", required: true, readOnly: false });
  expect(form.values).toEqual({ id: "", name: "", age: null });
  expect(form.errors).toEqual([]);
  expect(form.save.method).toBe("POST");

  const missingPk = await createCustomerOntologyReadAdapter(owner, viewer).createForm("person", {
    values: { id: "", name: "Bob", age: 25 },
    changedField: null,
  });
  expect(missingPk.errors).toEqual([expect.objectContaining({ field: "/id", code: "required" })]);
});

it("propagates owner data permission refusals and missing objects on customer form reads", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: false, code: "DATA_PERMISSION_DENIED", message: "No read permission" });
    return undefined;
  });

  await expect(createCustomerOntologyReadAdapter(owner, viewer).form("person", "p1"))
    .rejects.toMatchObject({ status: 403, code: "CUSTOMER_DATA_PERMISSION" });
});


it("keeps Java-authorized scalar column labels on empty pages", async () => {
  stubOwner(request => catalogRoute(request) ?? (
    request.url.pathname === "/data/getWholeClassDataByPage"
      ? Response.json({ success: true, data: [], total_count: 0, readable_fields: ["id", "name"] })
      : undefined
  ));
  expect(await createCustomerOntologyReadAdapter(owner, viewer).query("person", {})).toEqual({
    rows: [], total: 0, fieldLabels: { id: "ID", name: "Name" },
  });
});

it("propagates semantic tones declared on attribute options to query rows, single records, and form options", async () => {
  const tonedAttributes = [
    { className: "order", name: "id", showName: "Order ID", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
    { className: "order", name: "title", showName: "Title", type: "varchar", attrDesc: "", enable: true, businessKey: true, primaryKey: false },
    {
      className: "order",
      name: "status",
      showName: "Status",
      type: "varchar",
      attrDesc: "",
      enable: true,
      businessKey: false,
      primaryKey: false,
      options: [
        { value: "APPROVED", label: "Approved", tone: "success" },
        { value: "REJECTED", label: "Rejected", tone: "danger" },
        { value: "DRAFT", label: "Draft" },
      ],
    },
  ];
  stubOwner(request => {
    if (request.url.pathname === "/ontology/model/attributes") return Response.json(tonedAttributes);
    if (request.url.pathname === "/data/getWholeClassDataByPage") {
      return Response.json({
        success: true,
        data: [
          { id: "o-1", title: "Order 1", status: "APPROVED" },
          { id: "o-2", title: "Order 2", status: "REJECTED" },
          { id: "o-3", title: "Order 3", status: "DRAFT" },
        ],
        total_count: 3,
        readable_fields: ["id", "title", "status"],
      });
    }
    if (request.url.pathname === "/data/queryInfoByNode") {
      return Response.json({ success: true, data: { data: { id: "o-1", title: "Order 1", status: "APPROVED" } } });
    }
    return undefined;
  });

  const adapter = createCustomerOntologyReadAdapter(owner, viewer);
  const page = await adapter.query("order", {});
  expect(page.rows[0]!.tones).toEqual({ status: "success" });
  expect(page.rows[1]!.tones).toEqual({ status: "danger" });
  expect(page.rows[2]!.tones).toBeUndefined();

  const detail = await adapter.record("order", "o-1");
  expect(detail.tones).toEqual({ status: "success" });

  const form = await adapter.form("order", "o-1");
  expect(form.fields.find(f => f.path === "/status")?.control).toMatchObject({
    kind: "select",
    options: [
      { value: "APPROVED", label: "Approved", tone: "success" },
      { value: "REJECTED", label: "Rejected", tone: "danger" },
      { value: "DRAFT", label: "Draft" },
    ],
  });
});

it("accepts and saves a value outside an attribute's declared options without rejecting the write", async () => {
  const attributes = [
    { className: "order", name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
    {
      className: "order", name: "status", showName: "Status", type: "varchar", attrDesc: "", enable: true,
      businessKey: false, primaryKey: false,
      options: [{ value: "APPROVED", label: "Approved", tone: "success" }, { value: "DRAFT", label: "Draft" }],
    },
    {
      className: "order", name: "amount", showName: "Amount", type: "double", attrDesc: "", enable: true,
      businessKey: false, primaryKey: false,
      options: [{ value: 1, label: "One", tone: "info" }, { value: 2.5, label: "Two and a half" }],
    },
  ];
  stubOwner(request => {
    if (request.url.pathname === "/ontology/model/attributes") return Response.json(attributes);
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: true, data: { data: { id: "o-1", status: "SHIPPED", amount: "7.5" } } });
    return undefined;
  });
  const adapter = createCustomerOntologyReadAdapter(owner, viewer);

  const form = await adapter.form("order", "o-1");
  expect(panelFormDescriptionSchema.parse(form)).toEqual(form);
  // Declared choices allow typing another value; the value keeps the attribute's own type.
  expect(form.fields.find(field => field.path === "/status")?.control)
    .toMatchObject({ kind: "select", allowCreate: true });
  expect(form.fields.find(field => field.path === "/status")?.valueSchema).toMatchObject({ type: ["string", "null"] });
  expect(form.fields.find(field => field.path === "/amount")?.valueSchema).toMatchObject({ type: ["number", "null"] });
  // Values already outside the declared options are shown as they are.
  expect(form.values).toMatchObject({ status: "SHIPPED", amount: 7.5 });

  const undeclared = await adapter.form("order", "o-1", {
    values: { status: "CANCELLED", amount: "12.5" },
    changedField: null,
  });
  expect(undeclared.values).toMatchObject({ status: "CANCELLED", amount: 12.5 });
  expect(undeclared.errors).toEqual([]);

  const notANumber = await adapter.form("order", "o-1", {
    values: { status: "APPROVED", amount: "twelve" },
    changedField: null,
  });
  expect(notANumber.errors).toEqual([expect.objectContaining({ field: "/amount", code: "invalid_number" })]);
});

it("shows a declared option's display name and keeps the raw value in the record", async () => {
  const attributes = [
    { className: "order", name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
    {
      className: "order", name: "status", showName: "Status", type: "varchar", attrDesc: "", enable: true,
      businessKey: false, primaryKey: false,
      options: [
        { value: "APPROVED", label: "Approved", tone: "success" },
        { value: "DRAFT", label: "Draft" },
      ],
    },
  ];
  stubOwner(request => {
    if (request.url.pathname === "/ontology/model/attributes") return Response.json(attributes);
    if (request.url.pathname === "/data/getWholeClassDataByPage")
      return Response.json({
        success: true,
        total_count: 2,
        readable_fields: ["id", "status"],
        data: [{ id: "o-1", status: "APPROVED" }, { id: "o-2", status: "SHIPPED" }],
      });
    return undefined;
  });

  const page = await createCustomerOntologyReadAdapter(owner, viewer).query("order", {});
  expect(page.rows[0]).toMatchObject({
    fields: { id: "o-1", status: "APPROVED" },
    valueLabels: { status: "Approved" },
    tones: { status: "success" },
  });
  // A value outside the options stays as it is, with no display text and no tone.
  expect(page.rows[1]).toMatchObject({ fields: { id: "o-2", status: "SHIPPED" } });
  expect(page.rows[1]!.valueLabels).toBeUndefined();
  expect(page.rows[1]!.tones).toBeUndefined();
});

it("matches a declared option by the attribute's type, not by the value's text form", async () => {
  const attributes = [
    { className: "order", name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
    {
      className: "order", name: "amount", showName: "Amount", type: "double", attrDesc: "", enable: true,
      businessKey: false, primaryKey: false,
      options: [{ value: 1.5, label: "One and a half", tone: "info" }, { value: 2, label: "Two", tone: "success" }],
    },
    {
      className: "order", name: "code", showName: "Code", type: "varchar", attrDesc: "", enable: true,
      businessKey: false, primaryKey: false,
      options: [{ value: "007", label: "Agent", tone: "warning" }],
    },
  ];
  stubOwner(request => {
    if (request.url.pathname === "/ontology/model/attributes") return Response.json(attributes);
    if (request.url.pathname === "/data/getWholeClassDataByPage")
      return Response.json({
        success: true,
        total_count: 2,
        readable_fields: ["id", "amount", "code"],
        // The owner writes the same number differently, and a text value that looks like a number.
        data: [{ id: "o-1", amount: "1.50", code: "007" }, { id: "o-2", amount: 2, code: 7 }],
      });
    return undefined;
  });

  const page = await createCustomerOntologyReadAdapter(owner, viewer).query("order", {});
  // 1.50 and 1.5 are the same number, so the option matches; the value itself is left as stored.
  expect(page.rows[0]).toMatchObject({
    fields: { amount: "1.50", code: "007" },
    valueLabels: { amount: "One and a half", code: "Agent" },
    tones: { amount: "info", code: "warning" },
  });
  // Text compares strings: a number the owner returns for a text attribute matches no declared text option.
  expect(page.rows[1]).toMatchObject({
    fields: { amount: "2", code: "7" },
    valueLabels: { amount: "Two" },
    tones: { amount: "success" },
  });
});
