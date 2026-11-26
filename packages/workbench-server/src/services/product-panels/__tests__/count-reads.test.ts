import {
  ACTION, AGENT_DEFINITION, APPLICATION, ATTRIBUTE, METRIC_VIEW, OBJECT_TYPE, RELATIONSHIP, SDK_COMPONENT, TRIGGER,
  WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
import { applicationPanelUseSchema, productProjectionSchema } from "@ontomato/contracts/product-panels";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { RETRIEVAL_AGENT_ID } from "@ontomato/contracts/product-governance";
import { readProductPanelData } from "../data-reads";

const mocks = vi.hoisted(() => ({
  resolveMember: vi.fn(),
  resolveRoot: vi.fn(),
  assertPermission: vi.fn(),
  query: vi.fn(),
  listVisibleDomainComponents: vi.fn(),
}));

vi.mock("../member-path", () => ({
  requireRegisteredPanelRoot: mocks.resolveRoot,
  resolvePanelMemberPath: mocks.resolveMember,
}));
vi.mock("../../../config/application", async importOriginal => {
  const { config } = await importOriginal<typeof import("../../../config/application")>();
  return { config: { ...config, dataQuery: { ...config.dataQuery, baseUrl: "http://owner.test" } } };
});
vi.mock("../../../identity/installed", async importOriginal => ({
  ...await importOriginal<typeof import("../../../identity/installed")>(),
  assertPermission: mocks.assertPermission,
}));
vi.mock("../../../infrastructure/postgres", async importOriginal => ({
  ...await importOriginal<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ query: mocks.query }),
}));
vi.mock("../../app-builder/sdk", () => ({
  readCurrentAppSdkComponents: async () => ({
    version: "1.0.0",
    digest: "a".repeat(64),
    catalogue: {
      version: "1.0.0",
      components: [{
        componentId: "ObjectCount", module: "@ontomato/sdk/base", exportName: "ObjectCount",
        role: "presentation", meaning: "Shows a count.", ports: { props: [], slots: [], events: [] },
      }],
    },
  }),
}));
vi.mock("../../component-packages/store", () => ({
  listComponentPackages: async () => [{
    name: "@acme/widgets",
    components: [{ componentId: "@ontomato/sdk:ObjectCount" }, { componentId: "@acme/widgets:Indicator" }],
  }],
}));
vi.mock("../../domain-components/store", () => ({
  listVisibleDomainComponents: mocks.listVisibleDomainComponents,
}));

const owner = { domainId: "tenant", userId: "reader" };
const viewer = { token: "reader-token", locale: "en", headers: { "x-scope": "reader-scope" } };

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

function readCount(typeId: string, read = "count") {
  const projection = productProjectionSchema.parse({
    id: "builtin-product-test-count", domainId: null, ownerId: null, editable: false,
    name: "Count", description: "", visibility: "platform", revision: 1,
    createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z",
    componentId: "@ontomato/sdk:ObjectCount", inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: typeId } }, read, params: {} } },
  });
  mocks.resolveMember.mockResolvedValue({ kind: "projection", member: {}, projection });
  return readProductPanelData(owner, viewer, {
    source: { kind: "frame", applicationId: "ontology", useId: "objects" },
    memberPath: [{ member: "count" }], dataName: "rows", inputs: {},
  });
}

/** A normal catalogue query, including its one-row page, must keep returning rows. */
function readQuery(typeId: string, params: Record<string, unknown>) {
  const projection = productProjectionSchema.parse({
    id: "builtin-product-test-query", domainId: null, ownerId: null, editable: false,
    name: "Query", description: "", visibility: "platform", revision: 1,
    createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z",
    componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: typeId } }, read: "query", params } },
  });
  mocks.resolveMember.mockResolvedValue({ kind: "projection", member: {}, projection });
  return readProductPanelData(owner, viewer, {
    source: { kind: "frame", applicationId: "ontology", useId: "objects" },
    memberPath: [{ member: "rows" }], dataName: "rows", inputs: {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveRoot.mockResolvedValue({});
});
beforeAll(() => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("platform count reads", () => {
  const objectType = {
    className: "Device", showName: "Device", classDesc: "", attributeCount: 7,
    businessKeyCount: 0, relationshipCount: 4, primaryKey: { status: "ok", count: 1, name: "id", showName: "id" },
  };
  const attribute = {
    className: "Device", name: "id", showName: "", type: "varchar",
    attrDesc: "", enable: true, businessKey: false, primaryKey: true,
  };
  const relationship = {
    relationship: "owns", fromclass: "Device", toclass: "Site", desc: "", fromField: "site", toField: "id",
  };

  it.each([
    { type: OBJECT_TYPE, path: "/ontology/model/object-types", rows: [objectType, { ...objectType, className: "Site" }] },
    { type: ATTRIBUTE, path: "/ontology/model/attributes", rows: [attribute] },
    { type: RELATIONSHIP, path: "/ontology/model/relationships", rows: [relationship] },
  ])("$type counts only the records returned to the current viewer", async ({ type, path, rows }) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(new URL(url).pathname).toBe(path);
      expect(init.method).toBe("GET");
      const headers = new Headers(init.headers);
      expect(headers.get("tk")).toBe(viewer.token);
      expect(headers.get("x-scope")).toBe(viewer.headers["x-scope"]);
      return Response.json(rows);
    }));
    await expect(readCount(type)).resolves.toEqual({ status: "ready", value: { rows: [], total: rows.length } });
  });

  it("counts actions through the same list URL without reading the list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(new URL(url).pathname).toBe("/action/queryList");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ countOnly: true }));
      return Response.json({ success: true, data: { total: 4 } });
    }));
    await expect(readCount(ACTION)).resolves.toEqual({ status: "ready", value: { rows: [], total: 4 } });
  });

  it("counts triggers without loading the list", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(new URL(url).pathname).toBe("/trigger/queryList");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ countOnly: true }));
      return Response.json({ success: true, data: { total: 3 } });
    }));
    await expect(readCount(TRIGGER)).resolves.toEqual({ status: "ready", value: { rows: [], total: 3 } });
  });

  it("counts metric views through the count read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(new URL(url).pathname).toBe("/metricView/queryList");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ countOnly: true }));
      return Response.json({ success: true, data: { total: 2 } });
    }));
    await expect(readCount(METRIC_VIEW)).resolves.toEqual({ status: "ready", value: { rows: [], total: 2 } });
  });

  it("counts applications through the count read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      const request = new URL(url);
      expect(request.pathname).toBe("/platform/applications/catalogue");
      expect(request.searchParams.get("countOnly")).toBe("true");
      expect(init.method).toBe("GET");
      return Response.json({ success: true, data: { total: 5 } });
    }));
    await expect(readCount(APPLICATION)).resolves.toEqual({ status: "ready", value: { rows: [], total: 5 } });
  });

  it("keeps a one-row application catalogue query a row query", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      const request = new URL(url);
      expect(request.pathname).toBe("/platform/applications/catalogue");
      expect(request.searchParams.get("countOnly")).toBeNull();
      expect(request.searchParams.get("size")).toBe("1");
      expect(init.method).toBe("GET");
      return Response.json({
        success: true,
        data: {
          rows: [{
            id: "app-1", names: { en: "App" }, descriptions: { en: "" }, icon: "app-window",
            source: "builtin", canMaintain: false, canEditEntries: false, canGrant: false, entryCount: 0,
          }],
          total: 1,
        },
      });
    }));
    const result = await readQuery(APPLICATION, { size: { literal: 1 } });
    expect(result).toMatchObject({ status: "ready", value: { total: 1, rows: [{ primaryKey: "app-1" }] } });
  });

  it("projects a fixed object state key before reading the selected class's attributes", async () => {
    const projection = productProjectionSchema.parse({
      id: "builtin-product-test-attributes", domainId: null, ownerId: null, editable: false,
      name: "Attributes", description: "", visibility: "platform", revision: 1,
      createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z",
      componentId: "@ontomato/sdk:ObjectList", inputs: { className: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: ATTRIBUTE } }, read: "list", params: { className: { input: "className" } } } },
    });
    mocks.resolveRoot.mockResolvedValue({ entry: applicationPanelUseSchema.parse({
      id: "attributes", pageKey: "attributes", panelId: "model", path: "/attributes",
      inputs: { selectedNode: { literal: { className: OBJECT_TYPE, primaryKey: "Device" } } },
    }) });
    mocks.resolveMember.mockResolvedValue({
      kind: "projection", projection, trail: [],
      member: { inputs: { className: { state: "selectedNode", field: "primaryKey" } } },
    });
    const classNames: (string | null)[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url);
      switch (path.pathname) {
        case "/ontology/model/attributes":
          classNames.push(path.searchParams.get("className"));
          return Response.json([attribute]);
        case "/ontology/model/object-types": return Response.json([objectType]);
        case "/ontology/model/field-labels": return Response.json({ attribute: {}, objectType: {}, relationship: {} });
        default: throw new Error(`Unexpected owner read: ${path.pathname}`);
      }
    });

    await expect(readProductPanelData(owner, viewer, {
      source: { kind: "registered", applicationId: "ontology", useId: "attributes" },
      memberPath: [{ member: "attributes" }], dataName: "rows", inputs: { className: "Site" },
    })).resolves.toMatchObject({ status: "ready" });
    expect(classNames).toEqual(["Device"]);
  });

  it("counts distinct SDK entries including visible domain registrations", async () => {
    mocks.listVisibleDomainComponents.mockResolvedValue([
      { declaration: { componentId: "domain:registered" }, name: "Registered" },
    ]);
    await expect(readCount(SDK_COMPONENT)).resolves.toEqual({ status: "ready", value: { rows: [], total: 3 } });
    expect(mocks.listVisibleDomainComponents).toHaveBeenCalledWith(owner.domainId, viewer, false);
  });

  it("counts only definitions with view, including visible system agents", async () => {
    const rows = [
      { id: "visible", kind: "regular", domain_id: owner.domainId, owner_id: "author" },
      { id: "hidden", kind: "analysis", domain_id: owner.domainId, owner_id: "another-author" },
      { id: "builder", kind: "app-builder", domain_id: owner.domainId, owner_id: null },
    ];
    mocks.query.mockResolvedValue({ rows });
    vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "count-test-token");
    vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      const path = new URL(url).pathname;
      const headers = new Headers(init.headers);
      expect(headers.get("tk")).toBe(viewer.token);
      expect(headers.get("x-scope")).toBe(viewer.headers["x-scope"]);
      if (path === `/ontology/ai/agent-models/${RETRIEVAL_AGENT_ID}`) {
        expect(init.method).toBe("GET");
        return Response.json({ success: true, data: {
          id: RETRIEVAL_AGENT_ID, kind: "retrieval", name: "Data retrieval", modelSelection: { modelId: null }, editable: false,
        } });
      }
      expect(path).toBe("/authorization/objects/decide-batch");
      expect(init.method).toBe("POST");
      expect(headers.get("X-Ontomato-Query-Service-Token")).toBe("count-test-token");
      expect(JSON.parse(String(init.body))).toEqual({ requests: rows.map(row => ({
        target: { domainId: owner.domainId, kind: "AGENT", id: row.id },
        ownerFacts: { ownerId: row.owner_id, state: "PUBLISHED" }, verb: "VIEW",
      })) });
      return Response.json({ decisions: [
        { allowed: true, code: null, reason: null },
        { allowed: false, code: "OBJECT_FORBIDDEN", reason: "View permission required" },
        { allowed: true, code: null, reason: null },
      ] });
    });
    await expect(readCount(AGENT_DEFINITION)).resolves.toEqual({ status: "ready", value: { rows: [], total: 3 } });
    expect(mocks.assertPermission).not.toHaveBeenCalled();
  });

  it("returns zero when the viewer has no agent view grants", async () => {
    vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "count-test-token");
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      if (path === `/ontology/ai/agent-models/${RETRIEVAL_AGENT_ID}`) {
        return Response.json({ success: false, code: 403 }, { status: 403 });
      }
      expect(path).toBe("/authorization/objects/decide-batch");
      return Response.json({ decisions: [{ allowed: false, code: "OBJECT_FORBIDDEN", reason: "View permission required" }] });
    });
    mocks.query.mockResolvedValue({ rows: [
      { id: "private-agent", kind: "custom", domain_id: owner.domainId, owner_id: "author" },
    ] });
    await expect(readCount(AGENT_DEFINITION)).resolves.toEqual({ status: "ready", value: { rows: [], total: 0 } });
  });

  it("returns forbidden when Java denies the viewer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 })));
    await expect(readCount(OBJECT_TYPE)).resolves.toEqual({ status: "forbidden", reason: expect.stringMatching(/\S/u) });
  });

  it("counts graph agent definitions in the database after deciding VIEW from access facts", async () => {
    const { countVisibleAgentDefinitions } = await import("../../assistant/definitions");
    const visible = "10000000-0000-4000-a000-000000000001";
    const hidden = "10000000-0000-4000-a000-000000000002";
    mocks.query.mockResolvedValueOnce({ rows: [
      { id: visible, domain_id: owner.domainId, owner_id: "author" },
      { id: hidden, domain_id: owner.domainId, owner_id: "another-author" },
    ] }).mockResolvedValueOnce({ rows: [{ total: 1 }] });
    vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "count-test-token");
    const decide = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(new URL(url).pathname).toBe("/authorization/objects/decide-batch");
      expect(JSON.parse(String(init.body)).requests).toMatchObject([
        { target: { id: visible }, verb: "VIEW" }, { target: { id: hidden }, verb: "VIEW" },
      ]);
      return Response.json({ decisions: [
        { allowed: true }, { allowed: false, code: "FORBIDDEN", reason: "View permission required" },
      ] });
    });
    vi.stubGlobal("fetch", decide);
    await expect(countVisibleAgentDefinitions(owner, viewer)).resolves.toBe(1);
    expect(mocks.query).toHaveBeenNthCalledWith(1, expect.stringMatching(/^SELECT id, domain_id, owner_id FROM/), [owner.domainId]);
    expect(mocks.query).toHaveBeenNthCalledWith(2, expect.stringMatching(/^SELECT COUNT\(\*\)/), [owner.domainId, [visible]]);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("counts workflows through the owner without loading the list", async () => {
    const ownerRead = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(new URL(url).pathname).toBe("/workflow/query");
      expect(JSON.parse(String(init.body))).toEqual({ countOnly: true });
      expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
      return Response.json({ success: true, data: { total: 3 } });
    });
    vi.stubGlobal("fetch", ownerRead);
    await expect(readCount(WORKFLOW)).resolves.toEqual({ status: "ready", value: { rows: [], total: 3 } });
    expect(ownerRead).toHaveBeenCalledTimes(1);
  });

  it("returns an error when the workflow owner cannot read the count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, message: "Database unavailable" })));
    await expect(readCount(WORKFLOW)).resolves.toMatchObject({ status: "error" });
  });
});
