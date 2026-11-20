import { afterEach, expect, it, vi } from "vitest";
import { panelRecordSchema } from "@ontomato/contracts/panel-projection";
import { platformOntologyNeighborsResponseSchema } from "@ontomato/contracts/platform-ontology";
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

  const page = await createCustomerOntologyReadAdapter(owner, viewer).query("person", { search: "ali", page: 2, size: 3 });
  // The total is the owner's count, not the rows this page happens to hold.
  expect(page.total).toBe(42);
  expect(page.items.map(record => panelRecordSchema.parse(record))).toEqual([
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
  expect(page.items[0]).toMatchObject({ primaryKey: "l9", label: "l9" });
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

it("reads both directions of the anchor's relations, including a self-loop, and dedups the neighbors", async () => {
  const dslCalls: Record<string, any>[] = [];
  const attributeReads: string[] = [];
  stubOwner(request => {
    const className = request.url.searchParams.get("className");
    if (request.url.pathname === "/ontology/model/attributes") {
      attributeReads.push(className!);
      return catalogRoute(request);
    }
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: true, data: { classDef: { className: "person" }, data: { name: "Alice", age: 30 } } });
    if (request.url.pathname === "/dsl/executeV1") {
      dslCalls.push(request.body!);
      const { kind } = dslRoute(request.body!);
      if (kind === "person_to_org")
        return Response.json(dslAnswer([{ id: "o1", title: "Acme" }, { id: "o2", title: "Globex" }]));
      return Response.json(dslAnswer([{ id: "p2", name: "Bob" }]));
    }
    return undefined;
  });

  const result = await createCustomerOntologyReadAdapter(owner, viewer)
    .neighbors({ className: "person", primaryKey: "p1" }, {});
  // The result keeps M3's neighbors shape, checked here without the added truncation flag.
  const m3 = platformOntologyNeighborsResponseSchema.parse({
    ...result,
    relations: result.relations.map(({ truncated: _truncated, ...relation }) => relation),
  });

  // The anchor's class and each target class are read once per call; the self-loop's target is the anchor's own class.
  expect(attributeReads).toEqual(["person", "org"]);

  // Each (relation, direction) is one DSL call: the anchor is matched by its primary key, the rows are asked one over the limit.
  const personToPerson = dslCalls.filter(call => dslRoute(call)!.kind === "person_to_person");
  expect(personToPerson.map(call => dslRoute(call)!.direction)).toEqual(["outgoing", "incoming"]);
  expect(dslCalls.filter(call => dslRoute(call)!.kind === "person_to_org").map(call => dslRoute(call)!.direction))
    .toEqual(["outgoing"]);
  const outgoing = relationPattern(personToPerson[0]);
  expect(outgoing.objects[0]).toMatchObject({ class: "person" });
  expect(outgoing.objects[0].conditions.properties).toEqual({ field: "id", operator: "=", value: "p1" });
  expect(outgoing.relationship).toEqual([{ from: 0, to: 1, type: ["person_to_person"] }]);
  expect(relationPattern(personToPerson[1]).relationship).toEqual([{ from: 1, to: 0, type: ["person_to_person"] }]);
  expect(personToPerson[0].answer.steps[0].output.limit).toEqual({ count: 51, offset: 0 });
  expect(personToPerson[0].answer.steps[0].output.sort).toEqual({ fields: [{ variable: "target", field: "id", order: "asc" }] });

  expect(m3.node).toEqual({ className: "person", primaryKey: "p1", label: "Alice", layer: "fact" });
  expect(m3.edges).toEqual([
    {
      id: "person_to_org:outgoing:p1:o1", relationKind: "person_to_org",
      from: { className: "person", primaryKey: "p1" }, to: { className: "org", primaryKey: "o1" },
      direction: "outgoing", derived: false,
    },
    {
      id: "person_to_org:outgoing:p1:o2", relationKind: "person_to_org",
      from: { className: "person", primaryKey: "p1" }, to: { className: "org", primaryKey: "o2" },
      direction: "outgoing", derived: false,
    },
    {
      id: "person_to_person:outgoing:p1:p2", relationKind: "person_to_person",
      from: { className: "person", primaryKey: "p1" }, to: { className: "person", primaryKey: "p2" },
      direction: "outgoing", derived: false,
    },
    {
      // An incoming edge keeps the relationship's own direction: the neighbor is its from end.
      id: "person_to_person:incoming:p1:p2", relationKind: "person_to_person",
      from: { className: "person", primaryKey: "p2" }, to: { className: "person", primaryKey: "p1" },
      direction: "incoming", derived: false,
    },
  ]);
  expect(m3.neighbors).toEqual([
    { className: "org", primaryKey: "o1", label: "Acme", layer: "fact" },
    { className: "org", primaryKey: "o2", label: "Globex", layer: "fact" },
    // Both directions of the self-loop reach the same object; it stays one neighbor.
    { className: "person", primaryKey: "p2", label: "Bob", layer: "fact" },
  ]);
  expect(result.relations).toEqual([
    { relationKind: "person_to_org", status: "ok", edgeCount: 2, truncated: false },
    { relationKind: "person_to_person", status: "ok", edgeCount: 2, truncated: false },
  ]);
});

it("reads only the declared relation kinds, and an unknown kind fails alone", async () => {
  const dslCalls: string[] = [];
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: true, data: { classDef: { className: "person" }, data: { name: "Alice" } } });
    if (request.url.pathname === "/dsl/executeV1") {
      dslCalls.push(dslRoute(request.body!)!.kind);
      return Response.json(dslAnswer([{ id: "o1", title: "Acme" }]));
    }
    return undefined;
  });

  const result = await createCustomerOntologyReadAdapter(owner, viewer)
    .neighbors({ className: "person", primaryKey: "p1" }, { relationKinds: ["person_to_org", "made_up"] });

  expect(dslCalls).toEqual(["person_to_org"]);
  expect(result.relations).toEqual([
    { relationKind: "person_to_org", status: "ok", edgeCount: 1, truncated: false },
    { relationKind: "made_up", status: "failed", edgeCount: 0, truncated: false, reason: expect.any(String) },
  ]);
  expect(result.edges).toHaveLength(1);
});

it("keeps the read alive when one relation is refused, and names only that relation", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: true, data: { classDef: { className: "person" }, data: { name: "Alice" } } });
    if (request.url.pathname === "/dsl/executeV1") {
      if (dslRoute(request.body!)!.kind === "person_to_org")
        return Response.json({ success: false, code: 403, message: "Class is outside the authorized scope" }, { status: 403 });
      return Response.json(dslAnswer([{ id: "p2", name: "Bob" }]));
    }
    return undefined;
  });

  const result = await createCustomerOntologyReadAdapter(owner, viewer)
    .neighbors({ className: "person", primaryKey: "p1" }, {});

  expect(result.relations.find(relation => relation.relationKind === "person_to_org"))
    .toMatchObject({ status: "refused", edgeCount: 0, reason: "Class is outside the authorized scope" });
  expect(result.relations.find(relation => relation.relationKind === "person_to_person"))
    .toMatchObject({ status: "ok", edgeCount: 2 });
  expect(result.edges.map(edge => edge.relationKind)).toEqual(["person_to_person", "person_to_person"]);
});

it("marks a relation the owner's execution failed, with its reason", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: true, data: { classDef: { className: "person" }, data: { name: "Alice" } } });
    if (request.url.pathname === "/dsl/executeV1") {
      if (dslRoute(request.body!)!.kind === "person_to_org")
        return Response.json({ error: "upstream adapter failed" });
      return Response.json(dslAnswer([{ id: "p2", name: "Bob" }]));
    }
    return undefined;
  });

  const result = await createCustomerOntologyReadAdapter(owner, viewer)
    .neighbors({ className: "person", primaryKey: "p1" }, {});

  expect(result.relations.find(relation => relation.relationKind === "person_to_org"))
    .toMatchObject({ status: "failed", edgeCount: 0, reason: "upstream adapter failed" });
  expect(result.relations.find(relation => relation.relationKind === "person_to_person"))
    .toMatchObject({ status: "ok", edgeCount: 2 });
});

it("caps the returned rows at the limit and reports the relation as truncated by the extra row", async () => {
  stubOwner(request => {
    const route = catalogRoute(request);
    if (route) return route;
    if (request.url.pathname === "/data/queryInfoByNode")
      return Response.json({ success: true, data: { classDef: { className: "person" }, data: { name: "Alice" } } });
    if (request.url.pathname === "/dsl/executeV1") {
      const { kind } = dslRoute(request.body!);
      const rows = kind === "person_to_org"
        ? [{ id: "o1", title: "Acme" }, { id: "o2", title: "Globex" }, { id: "o3", title: "Initech" }]
        : [{ id: "p2", name: "Bob" }];
      return Response.json(dslAnswer(rows));
    }
    return undefined;
  });

  const result = await createCustomerOntologyReadAdapter(owner, viewer)
    .neighbors({ className: "person", primaryKey: "p1" }, { limit: 2 });

  expect(result.relations.find(relation => relation.relationKind === "person_to_org"))
    .toMatchObject({ status: "ok", edgeCount: 2, truncated: true });
  expect(result.relations.find(relation => relation.relationKind === "person_to_person"))
    .toMatchObject({ status: "ok", edgeCount: 2, truncated: false });
  expect(result.edges.filter(edge => edge.relationKind === "person_to_org").map(edge => edge.id))
    .toEqual(["person_to_org:outgoing:p1:o1", "person_to_org:outgoing:p1:o2"]);
  expect(result.neighbors.map(neighbor => neighbor.primaryKey)).toEqual(["o1", "o2", "p2"]);
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
    .neighbors({ className: "person", primaryKey: "p9" }, {}))
    .rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
});
