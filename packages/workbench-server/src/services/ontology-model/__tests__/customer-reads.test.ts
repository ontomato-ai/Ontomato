import { afterEach, expect, it, vi } from "vitest";
import { panelRecordQuerySchema, panelRecordSchema, panelRelationNeighborsSchema } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createCustomerOntologyReadAdapter } from "../customer-reads";

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
const personRelationships = [
  { relationship: "person_to_org", fromclass: "person", toclass: "org", desc: "", fromField: "person_id", toField: "org_id" },
  { relationship: "person_to_person", fromclass: "person", toclass: "person", desc: "", fromField: "from_id", toField: "to_id" },
];

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

/** The model catalog routes: attributes by class, and the relationships touching a class. */
function catalogRoute(request: OwnerRequest): Response | undefined {
  if (request.url.pathname !== "/ontology/model/attributes" && request.url.pathname !== "/ontology/model/relationships")
    return undefined;
  const className = request.url.searchParams.get("className")!;
  if (request.url.pathname === "/ontology/model/attributes") {
    const attributes = classAttributes[className];
    return attributes
      ? Response.json(attributes)
      : Response.json({ error: { code: "OBJECT_TYPE_NOT_FOUND", message: "Class not found" } }, { status: 404 });
  }
  return Response.json(personRelationships.filter(relation =>
    relation.fromclass === className || relation.toclass === className));
}

/** Routes one DSL call by its relationship type and the idx ends it names, like the Java engine sees them. */
function dslRoute(dsl: Record<string, any>): { kind: string; direction: "outgoing" | "incoming" } {
  const pattern = dsl.answer.steps[0].graph.patterns[0];
  const relationship = pattern.relationship[0];
  return {
    kind: relationship.type[0],
    direction: relationship.from === 0 ? "outgoing" : "incoming",
  };
}

function dslAnswer(rows: Record<string, unknown>[]): Record<string, unknown> {
  return { data: [{ answer: rows }] };
}

function relationPattern(dsl: Record<string, any>) {
  return dsl.answer.steps[0].graph.patterns[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("queries a class's page with the declared paging and maps each row the owner returns", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/getWholeClassDataByPage") {
      expect(request.body).toMatchObject({ classname: "person", pagenum: 2, pagecount: 3, search: "ali" });
      return Response.json({
        success: true,
        data: [
          { id: "p1", name: "Alice", age: 30 },
          { id: "p2", name: null, age: null },
          { id: "p3", name: "Zed", age: { years: 30 } },
        ],
        total_count: 42,
        total_page: 14,
        cur_page: 2,
      });
    }
    return undefined;
  });

  const page = await createCustomerOntologyReadAdapter(owner, viewer).query("person", { search: "ali", page: { number: 2, size: 3 } });
  // The total is the owner's count, not the rows this page happens to hold.
  expect(page.total).toBe(42);
  panelRecordQuerySchema.parse(page);
  expect(page.rows.map(record => panelRecordSchema.parse(record))).toEqual([
    {
      primaryKey: "p1", label: "Alice",
      fields: { id: "p1", name: "Alice", age: "30" },
      fieldLabels: { id: "ID", name: "Name", age: "Age" },
    },
    {
      // Empty business keys fall back to the primary key, and null values become empty text.
      primaryKey: "p2", label: "p2",
      fields: { id: "p2", name: "", age: "" },
      fieldLabels: { id: "ID", name: "Name", age: "Age" },
    },
    {
      primaryKey: "p3", label: "Zed",
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
      return Response.json({ success: true, data: [{ id: "l9", message: "started" }], total_count: 1 });
    return undefined;
  });

  const page = await createCustomerOntologyReadAdapter(owner, viewer).query("log", {});
  expect(page.rows[0]).toMatchObject({ primaryKey: "l9", label: "l9" });
});

it("reports the owner's data-permission refusal on a class page as forbidden", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/getWholeClassDataByPage")
      return Response.json({ success: false, code: "DATA_PERMISSION_DENIED", message: "您没有数据权限" });
    return undefined;
  });

  await expect(createCustomerOntologyReadAdapter(owner, viewer).query("person", {}))
    .rejects.toMatchObject({ status: 403, code: "CUSTOMER_DATA_PERMISSION" });
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
    primaryKey: "p1", label: "Alice",
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

/** The owner answers the anchor's record and each relation-direction query with the given rows. */
function stubNeighbors(rows: (kind: string, direction: string) => Response, dslCalls: Record<string, any>[] = [], attributeReads: string[] = []) {
  stubOwner(request => {
    if (request.url.pathname === "/ontology/model/attributes") attributeReads.push(request.url.searchParams.get("className")!);
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: true, data: { classDef: { className: "person" }, data: { name: "Alice", age: 30 } } });
    if (request.url.pathname === "/dsl/executeV1") {
      dslCalls.push(request.body!);
      const { kind, direction } = dslRoute(request.body!);
      return rows(kind, direction);
    }
    return undefined;
  });
}

it("reads an outgoing relationship's neighbors with the anchor's key, one row over the limit", async () => {
  const dslCalls: Record<string, any>[] = [];
  const attributeReads: string[] = [];
  stubNeighbors(() => Response.json(dslAnswer([{ id: "o1", title: "Acme" }, { id: "o2", title: "Globex" }])), dslCalls, attributeReads);

  const result = panelRelationNeighborsSchema.parse(
    await createCustomerOntologyReadAdapter(owner, viewer).neighbors("person_to_org", { node: anchor }),
  );

  // The anchor's class and the target class are read once per call.
  expect(attributeReads).toEqual(["person", "org"]);
  expect(dslCalls.map(call => dslRoute(call))).toEqual([{ kind: "person_to_org", direction: "outgoing" }]);
  const pattern = relationPattern(dslCalls[0]);
  expect(pattern.objects[0]).toMatchObject({ class: "person" });
  expect(pattern.objects[0].conditions.properties).toEqual({ field: "id", operator: "=", value: "p1" });
  expect(pattern.relationship).toEqual([{ from: 0, to: 1, type: ["person_to_org"] }]);
  expect(dslCalls[0].answer.steps[0].output.limit).toEqual({ count: 51, offset: 0 });
  expect(dslCalls[0].answer.steps[0].output.sort).toEqual({ fields: [{ variable: "target", field: "id", order: "asc" }] });

  expect(result.node).toEqual({ className: "person", primaryKey: "p1", label: "Alice", layer: "fact" });
  expect(result.edges.map(edge => [edge.id, edge.from, edge.to, edge.direction])).toEqual([
    ["person_to_org:outgoing:p1:o1", anchor, { className: "org", primaryKey: "o1" }, "outgoing"],
    ["person_to_org:outgoing:p1:o2", anchor, { className: "org", primaryKey: "o2" }, "outgoing"],
  ]);
  expect(result.neighbors).toEqual([
    { className: "org", primaryKey: "o1", label: "Acme", layer: "fact" },
    { className: "org", primaryKey: "o2", label: "Globex", layer: "fact" },
  ]);
  expect(result.relations).toEqual([{ relationKind: "person_to_org", status: "ok", edgeCount: 2, truncated: false }]);
});

it("reads both directions of a self-loop and keeps a neighbor reached twice as one", async () => {
  const dslCalls: Record<string, any>[] = [];
  const attributeReads: string[] = [];
  stubNeighbors(() => Response.json(dslAnswer([{ id: "p2", name: "Bob" }])), dslCalls, attributeReads);

  const result = await createCustomerOntologyReadAdapter(owner, viewer).neighbors("person_to_person", { node: anchor });

  // The self-loop's target is the anchor's own class, read once.
  expect(attributeReads).toEqual(["person"]);
  expect(dslCalls.map(call => dslRoute(call).direction)).toEqual(["outgoing", "incoming"]);
  expect(relationPattern(dslCalls[1]).relationship).toEqual([{ from: 1, to: 0, type: ["person_to_person"] }]);
  // An incoming edge keeps the relationship's own direction: the neighbor is its from end.
  expect(result.edges.map(edge => [edge.direction, edge.from.primaryKey, edge.to.primaryKey]))
    .toEqual([["outgoing", "p1", "p2"], ["incoming", "p2", "p1"]]);
  expect(result.neighbors).toEqual([{ className: "person", primaryKey: "p2", label: "Bob", layer: "fact" }]);
  expect(result.relations).toEqual([{ relationKind: "person_to_person", status: "ok", edgeCount: 2, truncated: false }]);
});

it("refuses relationKinds that point the read at another relationship", async () => {
  stubNeighbors(() => Response.json(dslAnswer([{ id: "o1", title: "Acme" }])));
  const reads = createCustomerOntologyReadAdapter(owner, viewer);

  await expect(reads.neighbors("person_to_org", { node: anchor, relationKinds: ["person_to_person"] }))
    .rejects.toMatchObject({ status: 400 });
  await expect(reads.neighbors("person_to_org", { node: anchor, relationKinds: ["person_to_org"] }))
    .resolves.toMatchObject({ relations: [{ relationKind: "person_to_org", status: "ok" }] });
});

it("fails a relationship the anchor's class does not have, without querying it", async () => {
  const dslCalls: Record<string, any>[] = [];
  stubNeighbors(() => Response.json(dslAnswer([])), dslCalls);

  const result = await createCustomerOntologyReadAdapter(owner, viewer).neighbors("made_up", { node: anchor });

  expect(dslCalls).toEqual([]);
  expect(result.edges).toEqual([]);
  expect(result.relations).toEqual([
    { relationKind: "made_up", status: "failed", edgeCount: 0, truncated: false, reason: expect.any(String) },
  ]);
});

it("reports the viewer's refusal on the relationship as refused, with the owner's reason", async () => {
  stubNeighbors(() => Response.json({ success: false, code: 403, message: "Class is outside the authorized scope" }, { status: 403 }));

  const result = await createCustomerOntologyReadAdapter(owner, viewer).neighbors("person_to_org", { node: anchor });

  expect(result.relations).toEqual([{
    relationKind: "person_to_org", status: "refused", edgeCount: 0, truncated: false, reason: "Class is outside the authorized scope",
  }]);
  expect(result.edges).toEqual([]);
});

it("marks the relationship failed when the owner's execution fails, with its reason", async () => {
  stubNeighbors(() => Response.json({ error: "upstream adapter failed" }));

  const result = await createCustomerOntologyReadAdapter(owner, viewer).neighbors("person_to_org", { node: anchor });

  expect(result.relations).toEqual([{
    relationKind: "person_to_org", status: "failed", edgeCount: 0, truncated: false, reason: "upstream adapter failed",
  }]);
});

it("caps the returned rows at the limit and reports the relationship as truncated by the extra row", async () => {
  stubNeighbors(() => Response.json(dslAnswer([{ id: "o1", title: "Acme" }, { id: "o2", title: "Globex" }, { id: "o3", title: "Initech" }])));

  const result = await createCustomerOntologyReadAdapter(owner, viewer).neighbors("person_to_org", { node: anchor, limit: 2 });

  expect(result.relations).toEqual([{ relationKind: "person_to_org", status: "ok", edgeCount: 2, truncated: true }]);
  expect(result.neighbors.map(neighbor => neighbor.primaryKey)).toEqual(["o1", "o2"]);
});

it("fails the whole neighbors read by the record's rule when the anchor is unreadable", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: false, code: "OBJECT_NOT_FOUND", message: "Object not found" });
    return undefined;
  });

  await expect(createCustomerOntologyReadAdapter(owner, viewer)
    .neighbors("person_to_org", { node: { className: "person", primaryKey: "p9" } }))
    .rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
});
