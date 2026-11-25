import { objectDecisions } from "../../../__tests__/fixtures/agent-object-decisions";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { tmpdir } from "node:os";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import type { ProductPanelReadRequest } from "@ontomato/contracts/panel-host";
import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { HttpError } from "../../../utils/errors";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { buildTestAccess } from "../../build-test-access";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), query: vi.fn(), list: vi.fn(),
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
vi.mock("../../../services/ontology-model/model-reads", () => ({
  createOntologyModelReadAdapter: () => ({ list: mocks.list }),
}));

const root = "ontology-frame";
const projectionIds = Array.from({ length: 19 }, (_, i) => `projection-${i}`);
const source = { kind: "frame", applicationId: "ontology", useId: "use-list" } as const;
const record = { primaryKey: "sample", label: "Sample", fields: {} };
const reads: ProductPanelReadRequest[] = projectionIds.map((_, i) => ({
  source, memberPath: [{ member: `item${i}` }], dataName: "rows", inputs: {},
}));
let productPanelsRouter: typeof import("../product-panels").productPanelsRouter;

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
  installContentLayout({ runtimeRoot: tmpdir(), publicSkillsRoot: tmpdir(), prompts: [], runtimeResources: [] });
  ({ productPanelsRouter } = await import("../product-panels"));
});

function postBatch(body: unknown, previewHeader?: string) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const req = {
      method: "POST", url: "/read-batch", path: "/product-panels/read-batch", body,
      userId: "reader", token: "reader-token", locale: "en", headers: {},
      header: (name: string) => name === BUILD_TEST_HEADER ? previewHeader : undefined,
    } as unknown as Request;
    const res = {
      status(code: number) { status = code; return this; },
      json(body: unknown) { resolve({ status, body }); },
    } as Response;
    buildTestAccess(req, res, error => {
      if (error) reject(error);
      else productPanelsRouter(req, res, failure => reject(failure ?? new Error("No matching route")));
    });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockImplementation(async (_endpoint, url: string) => {
    const useId = new URL(url, "http://data-engine.test").searchParams.get("useId");
    if (useId === "denied-entry") throw new HttpError(403, "Denied");
    return { text: JSON.stringify({ success: true, data: {
      applicationId: source.applicationId, framePanelId: root,
      use: { id: useId, pageKey: "list", panelId: "panel-content", path: "/ontology/list", access: { kind: "domain-member" } },
    } }) };
  });
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "fixture");
  mocks.post.mockImplementation(async (_endpoint, url: string, body) => {
    if (url.endsWith("/authorization/objects/decide-batch"))
      return { text: JSON.stringify(objectDecisions(body, request => "target" in request && request.target.id !== projectionIds[2])) };
    throw new Error(`Unexpected backend POST: ${url}`);
  });
  const time = new Date("2026-11-24T00:00:00Z");
  const base = { name: "Fixture", description: "", visibility: "domain", revision: 1, createdAt: time, updatedAt: time };
  mocks.query.mockImplementation(async (_sql, [domainId, ids]: [string, string[]]) => {
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

afterEach(() => { vi.unstubAllEnvs(); });

const useRequest = (kind: string, id: string) => ({
  target: { kind, id, domainId: "domain-a" }, ownerFacts: { ownerId: "author", state: "PUBLISHED" }, verb: "USE",
});

it("reads a 19-member frame with one entry lookup, two grant calls and isolated results", async () => {
  const response = await postBatch({ reads }, JSON.stringify({ kind: "build-test", contextId: null }));
  expect(response).toEqual({ status: 200, body: { results: [
    { status: "ready", value: [record] },
    { status: "empty" },
    { status: "forbidden", reason: expect.stringMatching(/\S/u) },
    { status: "error", message: "Could not read relationships" },
    ...Array.from({ length: projectionIds.length - 4 }, () => ({ status: "ready", value: [record] })),
  ] } });
  expect(mocks.get).toHaveBeenCalledTimes(1);
  expect(mocks.get).toHaveBeenCalledWith(
    "registered-panel-entry", expect.stringContaining("/platform/applications/registered-entry?"),
    expect.objectContaining({ headers: expect.objectContaining({ tk: "reader-token", [BUILD_TEST_HEADER]: expect.any(String) }) }),
  );
  expect(mocks.post.mock.calls.map(([, url, body]) => [new URL(url, "http://data-engine.test").pathname, body])).toEqual([
    ["/authorization/objects/decide-batch", { requests: [useRequest("PANEL", root)] }],
    ["/authorization/objects/decide-batch", { requests: projectionIds.map(id => useRequest("PROJECTION", id)) }],
  ]);
  expect(mocks.query.mock.calls.map(([, ids]) => ids)).toEqual([
    ["domain-a", [root]],
    ["domain-a", projectionIds],
  ]);
  // Identical authorized reads within one batch (16x OBJECT_TYPE + 1x ATTRIBUTE + 1x RELATIONSHIP) deduplicate to 3 calls.
  expect(mocks.list).toHaveBeenCalledTimes(3);
});

it("does not carry cached entries or grants across batches or inspect a denied root's members", async () => {
  const sample = [reads[0], { ...reads[0], source: { ...source, useId: "denied-entry" } }];
  expect((await postBatch({ reads: sample })).body).toEqual({
    results: [{ status: "ready", value: [record] }, { status: "forbidden", reason: expect.stringMatching(/\S/u) }],
  });
  mocks.query.mockClear();
  mocks.post.mockImplementation(async (_endpoint, _url, body) => ({ text: JSON.stringify(objectDecisions(body, () => false)) }));
  expect((await postBatch({ reads: sample })).body).toEqual({
    results: [{ status: "forbidden", reason: expect.stringMatching(/\S/u) }, { status: "forbidden", reason: expect.stringMatching(/\S/u) }],
  });
  expect(mocks.get).toHaveBeenCalledTimes(4);
  expect(mocks.post).toHaveBeenLastCalledWith(
    "object-authorization-decide-batch", expect.stringContaining("/authorization/objects/decide-batch"),
    { requests: [useRequest("PANEL", root)] }, expect.anything(),
  );
  expect(mocks.query.mock.calls.map(([, args]) => args)).toEqual([["domain-a", [root]]]);
});

it("rejects invalid envelopes before entry or grant lookup", async () => {
  for (const body of [{ reads: [] }, { reads: [...reads, {}] }, { reads, extra: true }, { reads: Array(51).fill(reads[0]) }]) {
    expect((await postBatch(body)).status).toBe(400);
  }
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});

it("rejects an incomplete grant response before reading member data", async () => {
  mocks.post.mockResolvedValueOnce({ text: JSON.stringify({ decisions: [{ allowed: true }] }) })
    .mockResolvedValueOnce({ text: JSON.stringify({ decisions: [{ allowed: true }] }) });
  const result = await postBatch({ reads: reads.slice(0, 2) });
  expect(result).toEqual({ status: 200, body: { results: [
    { status: "error", message: expect.stringMatching(/decisions|grant/i) },
    { status: "error", message: expect.stringMatching(/decisions|grant/i) },
  ] } });
  expect(mocks.query).toHaveBeenCalledTimes(2);
  expect(mocks.list).not.toHaveBeenCalled();
});
