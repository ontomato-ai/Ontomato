import {
  ACTION, AGENT_DEFINITION, ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP, SDK_COMPONENT, WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
import { applicationPanelUseSchema, productProjectionSchema } from "@ontomato/contracts/product-panels";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { readProductPanelData } from "../data-reads";

const mocks = vi.hoisted(() => ({
  resolveMember: vi.fn(),
  resolveRoot: vi.fn(),
  assertPermission: vi.fn(),
  query: vi.fn(),
  listVisibleDomainComponents: vi.fn(),
}));

vi.mock("../../app-builder/access", () => ({
  assertAppBuilderAccess: async () => { throw new HttpError(403, "App builder denied"); },
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

function readCount(typeId: string) {
  const projection = productProjectionSchema.parse({
    id: "builtin-product-test-count", domainId: null, ownerId: null, editable: false,
    name: "Count", description: "", visibility: "platform", revision: 1,
    createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z",
    componentId: "@ontomato/sdk:ObjectCount", inputs: {}, outputs: {}, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: typeId } }, read: "count", params: {} } },
  });
  mocks.resolveMember.mockResolvedValue({ kind: "projection", member: {}, projection });
  return readProductPanelData(owner, viewer, {
    source: { kind: "frame", applicationId: "ontology", useId: "objects" },
    memberPath: [{ member: "count" }], dataName: "rows", inputs: {},
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
    { type: ACTION, path: "/action/queryList", rows: [{ id: "a", name: "Approve" }], post: true },
    { type: WORKFLOW, path: "/workflow/query", rows: [{ id: "w", name: "Restock" }], post: true },
  ])("$type counts only the records returned to the current viewer", async ({ type, path, rows, post }) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      expect(new URL(url).pathname).toBe(path);
      expect(init.method).toBe(post ? "POST" : "GET");
      if (post) expect(init.body).toBe("{}");
      const headers = new Headers(init.headers);
      expect(headers.get("tk")).toBe(viewer.token);
      expect(headers.get("x-scope")).toBe(viewer.headers["x-scope"]);
      return Response.json(post ? { success: true, data: rows } : rows);
    }));
    await expect(readCount(type)).resolves.toEqual({ status: "ready", value: { rows: [], total: rows.length } });
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
      id: "attributes", pageKey: "attributes", panelId: "model", path: "/attributes", access: { kind: "domain-member" },
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
    expect(mocks.listVisibleDomainComponents).toHaveBeenCalledWith(owner.domainId, owner.userId);
  });

  it("counts stored agent definitions within the admitted domain", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ success: false, message: "System config denied" }, { status: 403 }));
    mocks.query.mockImplementation(async sql => ({ rows: sql.includes("COUNT(") ? [{ total: 12 }] : [] }));
    await expect(readCount(AGENT_DEFINITION)).resolves.toEqual({ status: "ready", value: { rows: [], total: 13 } });
    expect(mocks.assertPermission).toHaveBeenCalledWith(viewer, ["analysis-agent"]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringMatching(
      /SELECT COUNT\(\*\).*WHERE domain_id=\$1 AND kind<>'app-builder' AND kind NOT LIKE 'app-builder:%'/i,
    ), [owner.domainId]);
  });

  it("keeps a successful zero total ready", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ success: false, message: "System config denied" }, { status: 403 }));
    mocks.assertPermission.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new HttpError(403, "Diagnosis denied"));
    mocks.query.mockResolvedValue({ rows: [{ total: 0 }] });
    await expect(readCount(AGENT_DEFINITION)).resolves.toEqual({ status: "ready", value: { rows: [], total: 0 } });
  });

  it("returns forbidden when Java denies the viewer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 })));
    await expect(readCount(OBJECT_TYPE)).resolves.toEqual({ status: "forbidden" });
  });

  it("denies the agent count before querying storage without admission", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ success: false, message: "System config denied" }, { status: 403 }));
    mocks.assertPermission.mockRejectedValue(new HttpError(403, "Permission denied"));
    await expect(readCount(AGENT_DEFINITION)).resolves.toEqual({ status: "forbidden" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns an error when the workflow owner cannot read the count", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, message: "Database unavailable" })));
    await expect(readCount(WORKFLOW)).resolves.toMatchObject({ status: "error" });
  });
});
