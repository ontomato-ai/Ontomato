import {
  ACTION, AGENT_DEFINITION, APPLICATION, ATTRIBUTE, METRIC_VIEW, OBJECT_TYPE, RELATIONSHIP, SDK_COMPONENT, TRIGGER,
  WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
import { applicationPanelUseSchema, productProjectionSchema } from "@ontomato/contracts/product-panels";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const mocks = vi.hoisted(() => ({
  resolveMember: vi.fn(),
  resolveRoot: vi.fn(),
  locate: vi.fn(),
  read: vi.fn(),
  query: vi.fn(),
  components: vi.fn(),
  countAgents: vi.fn(),
}));

vi.mock("../member-path", async importOriginal => ({
  ...await importOriginal<typeof import("../member-path")>(),
  requireRegisteredPanelRoot: mocks.resolveRoot,
  resolvePanelMemberPath: mocks.resolveMember,
}));
vi.mock("../java-panel-reads", async importOriginal => ({
  ...await importOriginal<typeof import("../java-panel-reads")>(),
  locateViaJava: mocks.locate,
  readViaJava: mocks.read,
}));
vi.mock("../component-catalogue", async importOriginal => ({
  ...await importOriginal<typeof import("../component-catalogue")>(),
  countSdkComponentsInRange: mocks.components,
}));
vi.mock("../../assistant/store", async importOriginal => {
  const actual = await importOriginal<typeof import("../../assistant/store")>();
  return {
    ...actual,
    assistantStore: { ...actual.assistantStore, countVisibleAgentDefinitions: mocks.countAgents },
  };
});
vi.mock("../../../infrastructure/postgres", async importOriginal => ({
  ...await importOriginal<typeof import("../../../infrastructure/postgres")>(),
  getPostgresPool: () => ({ query: mocks.query }),
}));

let readPanelData: typeof import("../registered-read-plan").readPanelData;

const owner = { domainId: "tenant", userId: "reader" };
const viewer = {
  token: "reader-token", locale: "en",
  headers: { "X-Ontomato-Retrieval-Caller-Id": "caller-scope" },
};
const source = { kind: "frame", applicationId: "ontology", useId: "objects" } as const;
const entry = {
  applicationId: source.applicationId,
  framePanelId: "ontology-frame",
  use: { id: source.useId, names: { en: "Objects" }, pageKey: "objects", panelId: "objects-panel", path: "/objects" },
};

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

function projectionFor(typeId: string, read: string, params: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return productProjectionSchema.parse({
    id: `builtin-product-count-${typeId.replaceAll(/[^a-z0-9]+/giu, "-")}`, domainId: null, ownerId: null, editable: false,
    name: "Count", description: "", visibility: "platform", revision: 1,
    createdAt: "2026-11-24T00:00:00.000Z", updatedAt: "2026-11-24T00:00:00.000Z",
    componentId: "@ontomato/sdk:ObjectCount", inputs: {}, outputs: {}, config: {},
    ...extra,
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: typeId } }, read, params } },
  });
}

function readType(typeId: string, read = "count", params: Record<string, unknown> = {}, inputs: Record<string, RuntimeJsonValue> = {}, registered = false) {
  const projection = projectionFor(typeId, read, params);
  mocks.resolveMember.mockResolvedValue({ kind: "projection", member: {}, projection, trail: [] });
  return readPanelData(owner, viewer, {
    source: registered ? { ...source, kind: "registered" } : source,
    memberPath: [{ member: "count" }], dataName: "rows", inputs,
  });
}

function readyCounts(total: number) {
  return (_owner: unknown, reads: readonly unknown[]) => Promise.resolve({
    viewer: owner,
    results: reads.map(() => ({ status: "ready", payload: { rows: [], total } })),
  });
}

beforeAll(async () => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], knowledgeRoot: process.cwd(), runtimeResources: [] });
  ({ readPanelData } = await import("../registered-read-plan"));
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveRoot.mockResolvedValue({});
  mocks.locate.mockResolvedValue({ viewer: owner, entries: [{ kind: "ready", entry }] });
  mocks.read.mockImplementation(readyCounts(2));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("platform count reads", () => {
  it.each([
    OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP, ACTION, TRIGGER, METRIC_VIEW, APPLICATION, WORKFLOW,
  ])("forwards the %s count selection as one admitted Java read", async type => {
    await expect(readType(type)).resolves.toEqual({ status: "ready", value: { rows: [], total: 2 } });

    expect(mocks.locate).toHaveBeenCalledWith([
      { applicationId: source.applicationId, useId: source.useId, kind: "frame" },
    ], viewer);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    const [readViewer, reads, credentials] = mocks.read.mock.lastCall!;
    expect(readViewer).toEqual(owner);
    expect(credentials).toBe(viewer);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({
      source,
      registration: { framePanelId: entry.framePanelId, panelId: entry.use.panelId },
      call: { type, name: "count", parameters: {} },
    });
    expect(credentials.headers).toMatchObject({ "X-Ontomato-Retrieval-Caller-Id": "caller-scope" });
  });

  it("keeps a one-row application catalogue query a row query", async () => {
    mocks.read.mockImplementation(async () => ({ viewer: owner, results: [{ status: "ready", payload: {
      rows: [{
        id: "app-1", names: { en: "App" }, descriptions: { en: "" }, icon: "app-window",
        source: "builtin", canMaintain: false, canEditEntries: false, entryCount: 0,
      }],
      total: 1,
    } }] }));

    const result = await readType(APPLICATION, "query", { size: { literal: 1 } });
    expect(result).toMatchObject({ status: "ready", value: { total: 1, rows: [{ primaryKey: "app-1" }] } });
    expect(mocks.read.mock.lastCall![1][0].call).toEqual({
      type: APPLICATION, name: "query", parameters: { size: 1 },
    });
  });

  it("projects a fixed object state key before reading the selected class's attributes", async () => {
    const attribute = {
      className: "Device", name: "id", showName: "ID", type: "varchar",
      attrDesc: "", enable: true, businessKey: false, primaryKey: true,
    };
    const projection = projectionFor(ATTRIBUTE, "list", { className: { input: "className" } }, {
      componentId: "@ontomato/sdk:ObjectList",
      inputs: { className: { kind: "scalar", type: "string" } },
    });
    mocks.resolveRoot.mockResolvedValue({ entry: applicationPanelUseSchema.parse({
      id: "attributes", names: { en: "attributes" }, pageKey: "attributes", panelId: "model", path: "/attributes",
      inputs: { selectedNode: { literal: { className: OBJECT_TYPE, primaryKey: "Device" } } },
    }) });
    mocks.resolveMember.mockResolvedValue({
      kind: "projection", projection, trail: [],
      member: { inputs: { className: { state: "selectedNode", field: "primaryKey" } } },
    });
    mocks.read.mockImplementation(async () => ({ viewer: owner, results: [{ status: "ready", payload: {
      views: [attribute], fieldLabels: {}, classLabels: { Device: "Device" },
    } }] }));

    await expect(readPanelData(owner, viewer, {
      source: { ...source, kind: "registered" },
      memberPath: [{ member: "attributes" }], dataName: "rows", inputs: { className: "Site" },
    })).resolves.toMatchObject({ status: "ready" });
    expect(mocks.read.mock.lastCall![1][0].call).toEqual({
      type: ATTRIBUTE, name: "list", parameters: { className: "Device" },
    });
  });

  it("counts Node-owned components only through the Java visibility range", async () => {
    const range = { fixed: false, all: false, objectIds: ["domain-component:registered"], authorId: null };
    mocks.read.mockImplementation(async () => ({ viewer: owner, results: [
      { status: "ready", visibility: { COMPONENT: { USE: range } } },
    ] }));
    mocks.components.mockResolvedValue({ rows: [], total: 3 });

    await expect(readType(SDK_COMPONENT)).resolves.toEqual({ status: "ready", value: { rows: [], total: 3 } });
    const item = mocks.read.mock.lastCall![1][0];
    expect(item).not.toHaveProperty("call");
    expect(item.visibleKinds).toEqual([{ kind: "COMPONENT", verbs: ["USE"] }]);
    expect(mocks.components).toHaveBeenCalledWith(owner.domainId, range);
  });

  it.each([0, 1])("counts visible agent definitions and the retriever fact %i in one batch", async retrievers => {
    const range = { fixed: false, all: false, authorId: null, objectIds: ["visible-agent"] };
    mocks.read.mockImplementation(async () => ({ viewer: owner, results: [
      { status: "ready", payload: retrievers, visibility: { AGENT: { VIEW: range } } },
    ] }));
    mocks.countAgents.mockResolvedValue(2);

    await expect(readType(AGENT_DEFINITION)).resolves.toEqual({ status: "ready", value: { rows: [], total: 2 + retrievers } });
    expect(mocks.read.mock.lastCall![1][0]).toMatchObject({
      call: { type: AGENT_DEFINITION, name: "count", parameters: {} },
      visibleKinds: [{ kind: "AGENT", verbs: ["VIEW"] }],
    });
    expect(mocks.countAgents).toHaveBeenCalledWith(owner.domainId, range, { includeSystem: true });
  });

  it("returns forbidden when the Java owner denies the count", async () => {
    mocks.read.mockImplementation(async () => ({ viewer: owner, results: [
      { status: "forbidden", error: "Count denied" },
    ] }));
    await expect(readType(OBJECT_TYPE)).resolves.toEqual({ status: "forbidden", reason: "Count denied" });
  });

  it("maps a missing workflow count through the workflow registration", async () => {
    mocks.read.mockImplementation(async () => ({ viewer: owner, results: [
      { status: "error", code: "WORKFLOW_NOT_FOUND", error: "workflow missing" },
    ] }));
    await expect(readType(WORKFLOW)).resolves.toMatchObject({
      status: "error", code: "WORKFLOW_NOT_FOUND", message: "Workflow not found",
    });
  });

  it("counts graph agent definitions in the database from an explicit VIEW range without loading rows", async () => {
    const { countVisibleAgentDefinitions } = await import("../../assistant/definitions");
    const visible = "10000000-0000-4000-a000-000000000001";
    mocks.countAgents.mockResolvedValueOnce(1);
    const range = { fixed: false, authorId: null, all: false, objectIds: [visible] };

    await expect(countVisibleAgentDefinitions(owner, viewer, range)).resolves.toBe(1);
    expect(mocks.countAgents).toHaveBeenCalledWith(owner.domainId, range, { includeSystem: false });
  });
});
