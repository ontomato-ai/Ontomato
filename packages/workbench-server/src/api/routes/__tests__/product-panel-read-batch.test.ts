import { objectDecisions } from "../../../__tests__/fixtures/agent-object-decisions";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Request, RequestHandler, Response } from "express";
import { tmpdir } from "node:os";
import { AGENT_EXECUTION_HEADER } from "@ontomato/contracts/agent-runtime-business-callbacks";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { ATTRIBUTE, DASHBOARD_CARD, DELETE_ATTRIBUTE, EXTERNAL_MCP_SERVICE, METRIC_VIEW, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { HttpError } from "../../../utils/errors";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), query: vi.fn(), list: vi.fn(), run: vi.fn(), executor: vi.fn(),
  candidate: vi.fn(), appCandidate: vi.fn(),
}));
vi.mock("../../../services/assistant/execution", async original => ({
  ...await original<typeof import("../../../services/assistant/execution")>(),
  runForOwner: mocks.run, credentialsForRun: mocks.executor,
}));
vi.mock("../../../utils/backend-client", async original => ({
  ...await original<typeof import("../../../utils/backend-client")>(),
  backendGet: mocks.get,
  backendPost: mocks.post,
}));
vi.mock("../../../infrastructure/postgres", async original => ({
  ...await original<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ query: mocks.query }),
}));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain-a",
}));
vi.mock("../../../services/ontology-model/model-reads", async original => ({
  ...await original<typeof import("../../../services/ontology-model/model-reads")>(),
  createOntologyModelReadAdapter: () => ({ list: mocks.list }),
}));
vi.mock("../../../services/workspaces/panel-candidate", () => ({ resolvePanelCandidateMember: mocks.candidate }));
vi.mock("../../../services/app-builder/preview-service", async original => ({
  ...await original<typeof import("../../../services/app-builder/preview-service")>(),
  resolveApplicationPreviewMember: mocks.appCandidate,
}));

const root = "ontology-frame";
const projectionIds = Array.from({ length: 19 }, (_, i) => `projection-${i}`);
const source = { kind: "frame", applicationId: "ontology", useId: "use-list" } as const;
const record = { primaryKey: "sample", label: "Sample", fields: {} };
const reads: ProductPanelReadRequest[] = projectionIds.map((_, i) => ({
  source, memberPath: [{ member: `item${i}` }], dataName: "rows", inputs: {},
}));
let readRouter: ReturnType<typeof import("../product-panel-data").createProductPanelReadRouter>;
let assistantExecutionRouter: typeof import("../assistant-execution").assistantExecutionRouter;
const authenticate = vi.fn<Parameters<RequestHandler>, ReturnType<RequestHandler>>();

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
  installContentLayout({ runtimeRoot: tmpdir(), publicSkillsRoot: tmpdir(), prompts: [], runtimeResources: [] });
  const { createProductPanelReadRouter } = await import("../product-panel-data");
  readRouter = createProductPanelReadRouter(authenticate);
  ({ assistantExecutionRouter } = await import("../assistant-execution"));
});

function postRead(path: "/product-panels/read" | "/product-panels/read-batch", body: unknown,
  headers: Record<string, string> = { tk: "reader-token" },
) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const req = {
      method: "POST", url: path, path, body, query: {}, headers,
      header: (name: string) => headers[name],
      protocol: "https",
    } as unknown as Request;
    const res = {
      status(code: number) { status = code; return this; },
      json(body: unknown) { resolve({ status, body }); },
    } as Response;
    readRouter(req, res, failure => reject(failure ?? new Error("No matching route")));
  });
}

function postScopedBatch(body: unknown) {
  return postRead("/product-panels/read-batch", body, { tk: "reader-token", [AGENT_EXECUTION_HEADER]: "run-fixture" });
}

beforeEach(() => {
  vi.resetAllMocks();
  authenticate.mockImplementation((req, _res, next) => {
    const apiKey = req.header("x-api-key");
    Object.assign(req, { userId: "reader", token: apiKey ? undefined : "reader-token", ...(apiKey && { apiKey }), locale: "en" });
    next();
  });
  mocks.get.mockImplementation(async (_endpoint, url: string) => {
    const useId = new URL(url, "http://data-engine.test").searchParams.get("useId");
    if (useId === "denied-entry") throw new HttpError(403, "Denied");
    return { text: JSON.stringify({ success: true, data: {
      applicationId: source.applicationId, framePanelId: root,
      use: { id: useId, names: { en: String(useId) }, pageKey: "list", panelId: "panel-content", path: "/ontology/list" },
    } }) };
  });
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "fixture");
  mocks.post.mockImplementation(async (_endpoint, url: string, body) => {
    if (url.endsWith("/authorization/objects/decide-batch"))
      return { text: JSON.stringify(objectDecisions(body, request => "target" in request && request.target.id !== projectionIds[2])) };
    if (url.endsWith("/internal/workbench-panel-reads")) {
      const viewer = { userId: "reader", domainId: "domain-a" };
      if (body.kind === "locate") {
        return { text: JSON.stringify({ viewer, entries: body.entries.map(({ useId }: { useId: string }) => useId === "denied-entry"
          ? { kind: "error", status: 403, error: "Denied" }
          : { kind: "ready", entry: {
            applicationId: source.applicationId, framePanelId: root,
            use: { id: useId, names: { en: String(useId) }, pageKey: "list", panelId: root, path: "/ontology/list" },
          } }) }) };
      }
      const modelFacts = { fieldLabels: {}, views: [{
        className: "sample", showName: "Sample", classDesc: "", attributeCount: 1,
        businessKeyCount: 0, relationshipCount: 0, primaryKey: { status: "ok", count: 1, name: "id", showName: "ID" },
      }] };
      return { text: JSON.stringify({ viewer, results: body.reads.map((read: {
        call?: { type: string }; uses?: { target: { id: string } }[];
      }) => {
        if (read.uses?.some(use => use.target.id === projectionIds[2])) return { status: "forbidden", error: "Projection denied" };
        if (!read.call) return { status: "ready" };
        if (read.call.type === ATTRIBUTE) return { status: "ready", payload: { views: [], fieldLabels: {}, classLabels: {} } };
        if (read.call.type === RELATIONSHIP) return { status: "error", error: "Could not read relationships" };
        return { status: "ready", payload: modelFacts };
      }) }) };
    }
    throw new Error(`Unexpected backend POST: ${url}`);
  });
  const time = new Date("2026-11-24T00:00:00Z");
  const base = { name: "Fixture", description: "", visibility: "domain", revision: 1, createdAt: time, updatedAt: time };
  mocks.query.mockImplementation(async (_sql, [domainId, selected]: [string, string | string[]]) => {
    const ids = typeof selected === "string" ? [selected] : selected;
    if (ids.includes(root)) {
      return { rows: [{
        ...base, id: root, domainId, ownerId: "author", definition: {
          ...base, content: { html: "<div></div>" },
          manifest: { state: {}, members: Object.fromEntries(projectionIds.map((id, i) =>
            [`item${i}`, { target: { projectionId: id } }])) },
        },
      }] };
    }
    return { rows: ids.map(id => ({
      ...base, id, domainId, ownerId: "author", definition: {
        ...base, componentId: "@ontomato/sdk:DataTable", config: {}, inputs: {}, outputs: {},
        data: { rows: {
          source: { type: { kind: "PlatformObjectType", id: id === projectionIds[1] ? ATTRIBUTE : id === projectionIds[3] ? RELATIONSHIP : OBJECT_TYPE } },
          read: "list", params: {},
        } },
      },
    })) };
  });
  mocks.list.mockImplementation(async type => {
    if (type === ATTRIBUTE) return [];
    if (type === RELATIONSHIP) throw new HttpError(422, "Could not read relationships");
    return [record];
  });
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const useRequest = (kind: string, id: string) => ({
  target: { kind, id, domainId: "domain-a" }, ownerFacts: { ownerId: "author", state: "PUBLISHED" }, verb: "USE",
});

it("reads a 19-member frame through one Java locate and one ordered owner batch", async () => {
  const response = await postScopedBatch({ reads });
  const ready = { status: "ready", value: [expect.objectContaining({ primaryKey: record.primaryKey, label: record.label })] };
  expect(response).toMatchObject({ status: 200, body: { results: [
    ready,
    { status: "empty" },
    { status: "forbidden", reason: expect.stringMatching(/\S/u) },
    { status: "error", message: "Could not read relationships" },
    ...Array.from({ length: projectionIds.length - 4 }, () => ready),
  ] } });

  expect(mocks.get).not.toHaveBeenCalled();
  const calls = mocks.post.mock.calls.map(([, url, body]) => [new URL(url, "http://data-engine.test").pathname, body] as const);
  expect(calls.map(([pathname, body]) => [pathname, body.kind])).toEqual([
    ["/internal/workbench-panel-reads", "locate"],
    ["/internal/workbench-panel-reads", "read"],
  ]);
  expect(calls[0]![1].entries).toEqual([{ applicationId: source.applicationId, useId: source.useId, kind: "frame" }]);
  const batch = calls[1]![1];
  expect(batch.viewer).toEqual({ userId: "reader", domainId: "domain-a" });
  expect(batch.reads).toHaveLength(projectionIds.length);
  for (const [index, item] of batch.reads.entries()) {
    expect(item).toMatchObject({
      source,
      registration: { panelId: root, framePanelId: root },
      call: { type: index === 1 ? ATTRIBUTE : index === 3 ? RELATIONSHIP : OBJECT_TYPE, name: "list", parameters: {} },
    });
    expect(item.uses).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: expect.objectContaining({ kind: "PANEL", id: root }) }),
      expect.objectContaining({ target: expect.objectContaining({ kind: "PROJECTION", id: projectionIds[index] }) }),
    ]));
  }

  const productQueries = mocks.query.mock.calls.map(([, ids]) => ids);
  expect(productQueries[0]).toEqual(["domain-a", root]);
  expect(productQueries.slice(1).map(([, id]) => id).sort()).toEqual([...projectionIds].sort());
  // Authorization is part of the Java owner batch; the old per-member object-decision and owner-adapter fan-out are gone.
  expect(calls.some(([, body]) => body.requests)).toBe(false);
  expect(mocks.list).not.toHaveBeenCalled();
});

it("does not carry located entries across batches or inspect definitions for a denied entry", async () => {
  const sample = [reads[0], { ...reads[0], source: { ...source, useId: "denied-entry" } }];
  expect((await postScopedBatch({ reads: sample })).body).toMatchObject({
    results: [{ status: "ready" }, { status: "forbidden", reason: "Denied" }],
  });
  expect(mocks.post.mock.calls.filter(([, , body]) => body.kind === "locate")).toHaveLength(1);

  mocks.query.mockClear();
  mocks.post.mockImplementation(async (_endpoint, url: string, body) => {
    if (!url.endsWith("/internal/workbench-panel-reads") || body.kind !== "locate") throw new Error(`Unexpected owner call: ${url}`);
    return { text: JSON.stringify({ viewer: { userId: "reader", domainId: "domain-a" }, entries: body.entries.map(() => ({
      kind: "error", status: 403, error: "Denied",
    })) }) };
  });
  expect((await postScopedBatch({ reads: sample })).body).toEqual({
    results: [{ status: "forbidden", reason: "Denied" }, { status: "forbidden", reason: "Denied" }],
  });
  expect(mocks.post.mock.calls.filter(([, , body]) => body.kind === "locate")).toHaveLength(2);
  expect(mocks.post.mock.calls.some(([, url]) => url.endsWith("/authorization/objects/decide-batch"))).toBe(false);
  expect(mocks.query).not.toHaveBeenCalled();
});

it("rejects invalid envelopes before entry or grant lookup", async () => {
  for (const body of [{ reads: [] }, { reads: [...reads, {}] }, { reads, extra: true }, { reads: Array(51).fill(reads[0]) }]) {
    expect((await postRead("/product-panels/read-batch", body)).status).toBe(400);
  }
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});

it("rejects a malformed locate response before reading member definitions", async () => {
  mocks.post.mockResolvedValueOnce({ text: JSON.stringify({
    viewer: { userId: "reader", domainId: "domain-a" }, entries: [{}, {}],
  }) });
  const result = await postScopedBatch({ reads: reads.slice(0, 2) });
  expect(result).toEqual({ status: 502, body: {
    correlationId: "assistant",
    error: { code: "PANEL_READ_OWNER_RESPONSE_INVALID", message: "Invalid response from the panel read owner" },
  } });
  expect(mocks.query).not.toHaveBeenCalled();
  expect(mocks.list).not.toHaveBeenCalled();
});

function stubFormalOwner() {
  const viewer = { userId: "java-reader", domainId: "domain-a" };
  mocks.post.mockImplementation(async (_endpoint, url: string, body) => {
    expect(new URL(url, "http://data-engine.test").pathname).toBe("/internal/workbench-panel-reads");
    if (body.kind === "locate") {
      const entries = body.entries.map(({ useId }: { useId: string }) => useId === "denied-entry"
        ? { kind: "error", status: 403, error: "Denied" }
        : { kind: "ready", entry: {
          applicationId: source.applicationId, framePanelId: root,
          use: { id: useId, names: { en: String(useId) }, pageKey: "list", panelId: root, path: "/ontology/list" },
        } });
      return { text: JSON.stringify({ viewer, entries }) };
    }
    expect(body.kind).toBe("read");
    expect(body.viewer).toEqual(viewer);
    const modelFacts = { fieldLabels: {}, views: [{
      className: "sample", showName: "Sample", classDesc: "", attributeCount: 1,
      businessKeyCount: 0, relationshipCount: 0, primaryKey: { status: "ok", count: 1, name: "id", showName: "ID" },
    }] };
    const results = body.reads.map(({ call }: { call?: { type: string } }) => ({
      status: "ready", ...(call && { payload: call.type === EXTERNAL_MCP_SERVICE ? workbenchManagement.mcpServicesRead.id : modelFacts }),
    }));
    return { text: JSON.stringify({ viewer, results }) };
  });
}

it("routes a single live read through Java twice with the original token", async () => {
  stubFormalOwner();
  const answer = await postRead("/product-panels/read", reads[0], {
    tk: "live-token", "x-api-key": "unused-key", "accept-language": "en;q=1",
  });
  expect(answer).toMatchObject({ status: 200, body: { status: "ready", value: [{ primaryKey: record.primaryKey, label: record.label }] } });
  expect(authenticate).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.post.mock.calls.map(([, , body, options]) => [
    body.kind, new Headers(options.headers).get("tk"), new Headers(options.headers).get("x-api-key"),
  ])).toEqual([["locate", "live-token", null], ["read", "live-token", null]]);
});

it("restores item order across live and candidate reads in a mixed batch", async () => {
  stubFormalOwner();
  const candidate = {
    ...reads[0], source: { kind: "candidate", workspace: { id: "11111111-1111-4111-8111-111111111111", ref: "working" } },
  };
  const appCandidate = { ...reads[0], source: { kind: "app-candidate", app: { id: "app-example", ref: "working" } } };
  const denied = { ...reads[0], source: { ...source, useId: "denied-entry" } };
  mocks.candidate.mockRejectedValue(new HttpError(403, "Workspace denied"));
  mocks.appCandidate.mockRejectedValue(new HttpError(422, "Invalid preview placement"));

  const answer = await postRead("/product-panels/read-batch", { reads: [candidate, reads[0], denied, appCandidate] }, {
    "x-api-key": "live-key",
  });
  expect(answer).toMatchObject({ status: 200, body: { results: [
    { status: "forbidden", reason: "Workspace denied" },
    { status: "ready", value: [{ primaryKey: record.primaryKey, label: record.label }] },
    { status: "forbidden", reason: "Denied" },
    { status: "error", message: "Invalid preview placement" },
  ] } });
  expect(authenticate).toHaveBeenCalledTimes(1);
  expect(mocks.post.mock.calls.map(([, , body, options]) => [body.kind, new Headers(options.headers).get("x-api-key")]))
    .toEqual([["locate", "live-key"], ["read", "live-key"]]);
});

it("isolates an unexpected candidate resolution failure in a mixed batch", async () => {
  stubFormalOwner();
  const candidate = {
    ...reads[0], source: { kind: "candidate", workspace: { id: "11111111-1111-4111-8111-111111111111", ref: "working" } },
  };
  mocks.candidate.mockRejectedValue(new TypeError("socket hang up"));

  const answer = await postRead("/product-panels/read-batch", { reads: [candidate, reads[0]] }, {
    "x-api-key": "live-key",
  });
  expect(answer).toMatchObject({ status: 200, body: { results: [
    { status: "error", message: "Service unavailable" },
    { status: "ready", value: [{ primaryKey: record.primaryKey, label: record.label }] },
  ] } });
  const readCalls = mocks.post.mock.calls.filter(([, , body]) => body.kind === "read");
  expect(readCalls).toHaveLength(1);
  expect(readCalls[0]?.[2].reads).toHaveLength(1);
  expect(readCalls[0]?.[2].reads[0]?.source).toEqual(source);
});

it("keeps other reads when an admitted MCP tools item receives a non-JSON response", async () => {
  stubFormalOwner();
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "fixture-runtime-token");
  vi.stubEnv("AGENT_RUNTIME_URL", "http://runtime.test");
  const serviceId = "11111111-1111-4111-8111-111111111111";
  const fetch = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
  vi.stubGlobal("fetch", fetch);
  const lookup = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (...args) => {
    const { rows } = await lookup(...args);
    return { rows: rows.map((row: { id: string; definition: object }) => row.id === projectionIds[1] ? {
      ...row, definition: { ...row.definition, data: { rows: {
        source: { object: { literal: { className: EXTERNAL_MCP_SERVICE, primaryKey: serviceId } } },
        read: "tools", params: {},
      } } },
    } : row) };
  });
  const candidate = {
    ...reads[0], source: { kind: "candidate", workspace: { id: "11111111-1111-4111-8111-111111111111", ref: "working" } },
  };
  mocks.candidate.mockRejectedValue(new HttpError(403, "Workspace denied"));
  expect(await postRead("/product-panels/read-batch", { reads: [reads[1], candidate, reads[0]] })).toMatchObject({
    status: 200, body: { results: [
      { status: "error", message: expect.any(String) },
      { status: "forbidden", reason: "Workspace denied" },
      { status: "ready", value: [{ primaryKey: record.primaryKey, label: record.label }] },
    ] },
  });
  expect(fetch).toHaveBeenCalledWith(`http://runtime.test/v1/mcp/services/${serviceId}/tools`, expect.anything());
});

it.each(["metric", "card result", "card form", "card metric source", "customer relationship", "customer record",
  "model form", "attribute list with row delete"])("checks both callback placements and sends the executor's scope for %s", async kind => {
  const isRelationship = kind === "customer relationship";
  const isRecord = kind === "customer record";
  const isModel = kind === "model form";
  const isAttributeList = kind === "attribute list with row delete";
  const cardRead = kind === "card result" ? "result" : kind === "card form" ? "form" : kind === "card metric source" ? "metricSource" : undefined;
  const runId = "11111111-1111-4111-8111-111111111111";
  const sessionId = "22222222-2222-4222-8222-222222222222";
  // A preview run that no page presents reads as any run does: the preview adds no refusal to a read.
  const run = { status: "running", sessionId, channel: { authority: { executionKind: kind === "metric" ? "preview" : "live" } } };
  const use = { id: source.useId, names: { en: String(source.useId) }, pageKey: "list", panelId: "panel-content", path: "/ontology/list" };
  mocks.run.mockResolvedValue(run);
  mocks.get.mockImplementation(async (_endpoint, url: string, options) => {
    const pathname = new URL(url, "http://data-engine.test").pathname;
    const data = { applicationId: source.applicationId, framePanelId: root, use };
    if (pathname === "/platform/applications/resolve-entry") {
      expect(new Headers(options.headers).get("tk")).toBe("reader-token");
      return { text: JSON.stringify({ success: true, data: {
        ...data, menu: { singleEntry: true, groups: [], panelUses: [use] },
      } }) };
    }
    expect(pathname).toBe("/platform/applications/registered-entry");
    return { text: JSON.stringify({ success: true, data }) };
  });
  const executorKey = "executor-key";
  const scopeHeader = "X-Ontomato-Retrieval-Caller-Id";
  mocks.executor.mockResolvedValue({
    executionUserId: "executor", retrievalScopeId: runId,
    credentials: { apiKey: executorKey, locale: "en", headers: { [scopeHeader]: runId } },
  });
  const now = new Date("2026-11-24T00:00:00Z");
  const active = { name: "Fixture", description: "", visibility: "domain", revision: 1, createdAt: now, updatedAt: now };
  const projectionId = "callback-projection";
  const node = { className: "org", primaryKey: "o1" };
  const metricId = "metric";
  const cardKey = "board/card";
  const savedParameters = { region: "APAC" };
  const modelValues = { className: "Item" };
  const modelForm = { fields: [], values: modelValues, errors: [],
    save: { method: "POST", path: "/ontology/model/object-type/update", bodySchema: { type: "object" } },
  };
  const projection = isRecord ? {
    componentId: "@ontomato/sdk:ObjectSummary",
    data: { result: { source: { object: { literal: node } }, read: "record", params: {} } },
  } : isRelationship ? {
    componentId: "@ontomato/sdk:ObjectRelations",
    data: { result: { source: { type: { kind: "Relationship", id: "staff" } }, read: "neighbors", params: { node: { literal: node } } } },
  } : cardRead ? {
    componentId: cardRead === "form" ? "@ontomato/sdk:ObjectForm"
      : cardRead === "metricSource" ? "@ontomato/sdk:ObjectSummary" : "@ontomato/sdk:DataTable",
    data: { result: { source: { object: { literal: { className: DASHBOARD_CARD, primaryKey: cardKey } } }, read: cardRead, params: {} } },
  } : isModel ? {
    componentId: "@ontomato/sdk:ObjectForm",
    data: { result: { source: { object: { literal: { className: OBJECT_TYPE, primaryKey: "Order" } } },
      read: "form", params: { values: { literal: modelValues } } } },
  } : isAttributeList ? {
    componentId: "@ontomato/sdk:ObjectList",
    data: { result: { source: { type: { kind: "PlatformObjectType", id: ATTRIBUTE } }, read: "list", params: {} } },
    operations: { delete: { operation: { kind: "PlatformOperation", id: DELETE_ATTRIBUTE }, target: { row: true } } },
  } : {
    componentId: "@ontomato/sdk:DataTable",
    data: { result: { source: { object: { literal: { className: METRIC_VIEW, primaryKey: metricId } } }, read: "result", params: {} } },
  };
  mocks.query.mockImplementation(async (sql: string, args: string[]) => {
    if (sql.includes("dashboards")) {
      expect(args).toEqual(["executor", "board", "domain-a"]);
      return { rows: [{
        id: "board", name: "Board", owner_id: "executor", created_at: 1, updated_at: 1,
        groups: [{ id: "group", title: "Group", charts: [], metrics: [{
          id: "card", name: "Total", valueField: "total", query: { kind: "metric", metricId, parameters: savedParameters },
        }] }],
      }] };
    }
    const [domainId, id] = args;
    return { rows: [{
    ...active, id, domainId, ownerId: "author",
    definition: id === use.panelId ? {
      ...active, content: { html: "<div></div>" },
      manifest: { state: {}, members: { metric: { target: { projectionId } } } },
    } : {
      ...active, ...projection, config: {}, inputs: {}, outputs: {},
    },
    }] };
  });
  const columns = [{ key: "total", label: "Total", type: null }];
  const output = { columns, rows: [{ total: 2 }], truncation: null };
  const placementChecks: string[] = [];
  const ownerPaths: string[] = [];
  let denied: string | undefined;
  let ownerRefused = false;
  let relationshipError: string | undefined;
  mocks.post.mockImplementation(async (_endpoint, url: string, body, options) => {
    const pathname = new URL(url, "http://data-engine.test").pathname;
    const headers = new Headers(options.headers);
    const principal = headers.get("tk") ?? headers.get("X-API-Key")!;
    if (pathname === "/authorization/objects/decide-batch") {
      return { text: JSON.stringify(objectDecisions(body, request => {
        if ("target" in request && request.target.id === projectionId) {
          placementChecks.push(principal);
          return principal !== denied;
        }
        return true;
      })) };
    }
    ownerPaths.push(pathname);
    expect(headers.get("tk")).toBeNull();
    expect(headers.get("X-API-Key")).toBe(executorKey);
    expect(pathname).toBe("/internal/workbench-panel-reads");
    const executionViewer = { domainId: "domain-a", userId: "executor" };
    if (body.kind === "locate") {
      expect(headers.get(scopeHeader)).toBeNull();
      expect(headers.get("X-Ontomato-Agent-Execution")).toBeNull();
      return { text: JSON.stringify({ viewer: executionViewer, entries: body.entries.map(() => ({ kind: "ready", entry: {
        applicationId: source.applicationId, framePanelId: root,
        use: { id: source.useId, names: { en: String(source.useId) }, pageKey: "list", panelId: "panel-content", path: "/ontology/list" },
      } })) }) };
    }
    const key = { name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true };
    const attributeFacts = {
      views: [{ ...key, className: "org" }, { ...key, className: "org", name: "note", primaryKey: false }],
      fieldLabels: {}, classLabels: { org: "Organization" },
      relationshipFacts: relationshipError ? { error: relationshipError } : { views: [] },
    };
    // The rows' delete facts are the executor's own, read directly without the caller's scope.
    if (body.reads[0].source.kind === "direct") {
      expect(headers.get(scopeHeader)).toBeNull();
      expect(body.reads).toEqual([{ source: { kind: "direct" },
        call: { type: ATTRIBUTE, name: "list", parameters: { className: "org", includeDeleteFacts: true } } }]);
      return { text: JSON.stringify({ viewer: body.viewer, results: [{ status: "ready", payload: attributeFacts }] }) };
    }
    expect(headers.get(scopeHeader)).toBe(runId);
    const name = cardRead === "form" ? "parameterForm" : cardRead === "metricSource" ? "describe" : "result";
    const parameters = name === "describe" ? { primaryKey: metricId }
      : { primaryKey: metricId, parameters: cardRead ? savedParameters : {} };
    const call = isRecord ? { type: "customer:ObjectType", name: "record", parameters: node }
      : isRelationship ? { type: "customer:Relationship", name: "neighbors", parameters: { relationshipId: "staff", node, limit: 50, offset: 0 } }
      : isModel ? { type: OBJECT_TYPE, name: "form", parameters: { primaryKey: "Order", values: modelValues } }
      : isAttributeList ? { type: ATTRIBUTE, name: "list", parameters: { includeDeleteFacts: true } }
      : { type: METRIC_VIEW, name, parameters };
    expect(body.reads.map(({ call }: { call: unknown }) => call)).toEqual([call]);
    expect(body.viewer).toEqual({ domainId: "domain-a", userId: "executor" });
    if (ownerRefused) return { text: JSON.stringify({ viewer: body.viewer, results: [
      { status: "forbidden", error: "Execution exceeds the caller class scope" },
    ] }) };
    const anchor = { attributes: [{ ...key, className: "org" }], answer: { success: true, data: { data: {} } } };
    const payload = isModel ? modelForm : isAttributeList ? attributeFacts : isRecord ? anchor : isRelationship ? {
      anchor,
      label: "Staff", typeLabels: {}, targetAttributes: { person: [{ ...key, className: "person" }] },
      directions: [{ targetClass: "person", direction: "incoming", status: "ok", rows: [{ id: "p1" }] }],
    } : name === "describe" ? { status: "available", metric: {
      id: metricId, revision: "rev", status: "PUBLISHED", name: "Metric", parameterDefs: [], outputColumns: columns,
    } } : name === "parameterForm" ? { revision: "rev", fields: [], values: {}, readOnly: [] } : output;
    return { text: JSON.stringify({ viewer: body.viewer, results: [{ status: "ready", payload }] }) };
  });

  const postCallback = () => new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const req = {
      method: "POST", url: `/${runId}/panels/read`, headers: {},
      header: (name: string) => name === scopeHeader ? "untrusted-caller" : undefined,
      userId: "reader", token: "reader-token", locale: "en",
      body: { source: { ...source, kind: "registered" }, memberPath: [{ member: "metric" }], dataName: "result", inputs: {} },
    } as unknown as Request;
    const res = {
      locals: { runtimeCallback: { runId } },
      status(code: number) { status = code; return this; },
      json(body: unknown) { resolve({ status, body }); },
    } as unknown as Response;
    assistantExecutionRouter(req, res, failure => reject(failure ?? new Error("No matching route")));
  });

  const expected = isModel ? modelForm : isAttributeList ? expect.arrayContaining([expect.objectContaining({ primaryKey: '["org","note"]' })])
    : isRecord ? { ...node, label: "o1" }
    : isRelationship ? { node, neighbors: [{ className: "person", primaryKey: "p1" }] }
    : cardRead === "form" ? { revision: "rev", fields: [] }
    : cardRead === "metricSource" ? { fields: { metric: { primaryKey: metricId, label: "Metric" } } } : output;
  expect(await postCallback()).toMatchObject({ status: 200, body: { status: "ready", value: expected } });
  expect(mocks.get).toHaveBeenCalledWith("resolve-panel-entry", expect.stringContaining("/platform/applications/resolve-entry?"), expect.anything());
  expect(mocks.executor).toHaveBeenCalledWith({ userId: "reader", domainId: "domain-a" }, runId, expect.objectContaining({ token: "reader-token" }), sessionId);
  expect(placementChecks.splice(0)).toEqual(["reader-token"]);
  expect(ownerPaths.splice(0)).toEqual(["/internal/workbench-panel-reads", "/internal/workbench-panel-reads"]);

  if (isAttributeList) {
    for (const reason of ["Relationship read denied", "The owner read failed"]) {
      relationshipError = reason;
      expect(await postCallback()).toMatchObject({ status: 200, body: { status: "ready", value: expected, rowOperations: {
        [`${ATTRIBUTE}:["org","id"]`]: { delete: { available: false, unavailable: { reason: "A primary key attribute cannot be deleted." } } },
        [`${ATTRIBUTE}:["org","note"]`]: { delete: { available: false, unavailable: { reason } } },
      } } });
      expect(placementChecks.splice(0)).toEqual(["reader-token"]);
      expect(ownerPaths.splice(0)).toEqual(["/internal/workbench-panel-reads", "/internal/workbench-panel-reads"]);
    }
  }

  if (isRecord || (!isRelationship && cardRead !== "form")) {
    ownerRefused = true;
    expect(await postCallback()).toEqual({ status: 200, body: { status: "forbidden", reason: "Execution exceeds the caller class scope" } });
    expect(placementChecks.splice(0)).toEqual(["reader-token"]);
    expect(ownerPaths.splice(0)).toEqual(["/internal/workbench-panel-reads", "/internal/workbench-panel-reads"]);
  }

  denied = "reader-token";
  expect((await postCallback()).status).toBe(403);
  expect(placementChecks.splice(0)).toEqual(["reader-token"]);
  denied = undefined;
  ownerRefused = true;
  expect(await postCallback()).toMatchObject({ status: 200, body: { status: "forbidden" } });
  expect(placementChecks.splice(0)).toEqual(["reader-token"]);
  expect(ownerPaths.splice(0)).toEqual(["/internal/workbench-panel-reads", "/internal/workbench-panel-reads"]);
});
