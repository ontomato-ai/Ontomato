import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  ACTION, ACTIVATE_WORKFLOW, ADD_ROLE_MEMBERS, ADD_ROLE_POLICIES, AGENT_DEFINITION, AGENT_SESSION, APPLICATION, APPLICATION_DELETE_DRAFT, APPROVE_KNOWLEDGE, ATTRIBUTE, AUDIT_LOG, AUTOTEST_CASE_ARTIFACT, AUTOTEST_CASE_SET,
  APPLICATION_RESTORE_SOURCE_COMMIT, APPLICATION_ROLLBACK_BUILDER_RELEASE, APPLICATION_SYNC_BUILDER_SOURCE,
  AUTOTEST_RUN, BUSINESS_KNOWLEDGE, CLEAR_OBJECT_DETAIL_PANEL, DASHBOARD, DASHBOARD_CARD, DATA_ADAPTER_CONFIG, DEACTIVATE_WORKFLOW,
  DELETE_ACTION, DELETE_AGENT, DELETE_ATTRIBUTE, DELETE_AUTOTEST_RUN, DELETE_FUNCTION, DELETE_METRIC_VIEW, DELETE_ORG_UNIT,
  DELETE_ORG_POSITION, DELETE_PERMISSION_POLICY, DELETE_ROLE, DELETE_SKILL, DELETE_WORKFLOW, DOWNLOAD_AUTOTEST_CASE_ARTIFACT, EXPORT_SKILL, DOWNLOAD_TURN_EVIDENCE, DSL_QUERY,
  EXTERNAL_MCP_SERVICE, FAVORITE, FEEDBACK_RECORD, FUNCTION, GENERAL_SETTINGS, GENERATE_USER_API_KEY, KEEP_AUTOTEST_RUN,
  KEEP_TURN_EVIDENCE, METRIC_VIEW, MODEL_CONNECTION, MODEL_ENTRY, MODEL_OPTION, MODEL_USAGE, OBJECT_TYPE,
  ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, OPS_KNOWLEDGE, ORG_MEMBERSHIP, ORG_POSITION, ORG_UNIT,
  PERMISSION_POLICY, PRODUCT_PANEL, PRODUCT_PROJECTION, PUBLISHED_MCP_SERVICE, RECENT_VISIT, REGENERATE_USER_API_KEY,
  RELATIONSHIP, REMOVE_ORG_MEMBERSHIP, REMOVE_ROLE_MEMBERS, REMOVE_ROLE_POLICIES, REMOVE_USER, RESET_USER_PASSWORD, REVOKE_USER_API_KEY, ROLE, SDK_COMPONENT, SET_ACTION_STATUS,
  SET_PRIMARY_KEY, SKILL, TRIGGER, TURN_EVIDENCE, UNKEEP_AUTOTEST_RUN, UNKEEP_TURN_EVIDENCE, USER, WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
import { dashboardCardPrimaryKey } from "@ontomato/contracts/dashboard";
import { panelAddress, productPanelReadRequestSchema } from "@ontomato/contracts/panel-host";
import { RETRIEVAL_AGENT_ID } from "@ontomato/contracts/product-governance";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { z } from "zod";
import { installContentLayout } from "../../../content/layout";
import { configureI18n, tForLocale } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import type { ObjectVisibilityRange } from "../../product-governance/authorization";
import { triggerFixture } from "../../scheduling/__tests__/fixtures";
import type { JavaPanelRead, JavaPanelReadResult } from "../java-panel-reads";
import type { RegisteredDataRead } from "../registered-read-plan";
import { withReadDirective } from "../read-directive";

const mocks = vi.hoisted(() => ({
  locate: vi.fn(), read: vi.fn(), resolve: vi.fn(), prepare: vi.fn(), components: vi.fn(), skills: vi.fn(),
  dashboards: vi.fn(), dashboard: vi.fn(), favoriteKeys: vi.fn(), favoriteState: vi.fn(), isFavorite: vi.fn(), pinnedObjects: vi.fn(),
  sessions: vi.fn(), session: vi.fn(), agents: vi.fn(), knowledgeTree: vi.fn(), knowledgeFile: vi.fn(), getActiveRun: vi.fn(),
  detailMapping: vi.fn(), detailPanel: vi.fn(), currentProduct: vi.fn(), currentProducts: vi.fn(), policyCatalog: vi.fn(),
  policyObjectEntryUsage: vi.fn(),
}));
vi.mock("../java-panel-reads", async original => ({
  ...await original<typeof import("../java-panel-reads")>(), locateViaJava: mocks.locate, readViaJava: mocks.read,
}));
vi.mock("../../governance/policy-catalog", async original => ({
  ...await original<typeof import("../../governance/policy-catalog")>(), loadPolicyWorkbenchCatalog: mocks.policyCatalog,
}));
vi.mock("../../governance/policy-access", async original => ({
  ...await original<typeof import("../../governance/policy-access")>(),
  policyObjectEntryUsagePayload: mocks.policyObjectEntryUsage,
}));
vi.mock("../data-reads", async original => ({
  ...await original<typeof import("../data-reads")>(),
  resolveReadMember: mocks.resolve, prepareProjectionDataRead: mocks.prepare,
}));
vi.mock("../component-catalogue", async original => ({
  ...await original<typeof import("../component-catalogue")>(),
  countSdkComponentsInRange: mocks.components,
}));
vi.mock("../object-detail", async original => ({
  ...await original<typeof import("../object-detail")>(),
  findObjectDetailPanelId: mocks.detailMapping, findDetailPanel: mocks.detailPanel,
}));
vi.mock("../../../infrastructure/product-current", async original => ({
  ...await original<typeof import("../../../infrastructure/product-current")>(),
  findCurrentProduct: mocks.currentProduct, findCurrentProducts: mocks.currentProducts,
}));
vi.mock("../../skills/view", async original => ({
  ...await original<typeof import("../../skills/view")>(), readSkillView: mocks.skills,
}));
vi.mock("../../dashboard/store", async original => ({
  ...await original<typeof import("../../dashboard/store")>(),
  listDashboards: mocks.dashboards, getDashboard: mocks.dashboard,
}));
vi.mock("../../platform-home/service", async original => ({
  ...await original<typeof import("../../platform-home/service")>(),
  readFavoriteKeySet: mocks.favoriteKeys, readAllFavoriteState: mocks.favoriteState, isFavoriteTarget: mocks.isFavorite,
  readPinnedObjects: mocks.pinnedObjects,
}));
vi.mock("../../assistant/store", async original => {
  const { assistantStore, ...exports } = await original<typeof import("../../assistant/store")>();
  return { ...exports, assistantStore: { ...assistantStore, listUserSessions: mocks.sessions, session: mocks.session, agents: mocks.agents } };
});
vi.mock("../../../platform/diagnosis/observe/agent/knowledge-store", async original => ({
  ...await original<typeof import("../../../platform/diagnosis/observe/agent/knowledge-store")>(),
  listKnowledgeTree: mocks.knowledgeTree, readKnowledgeMarkdown: mocks.knowledgeFile,
}));

vi.mock("../../../platform/diagnosis/autotest/runner/run-controller", async original => ({
  ...await original<typeof import("../../../platform/diagnosis/autotest/runner/run-controller")>(),
  getActiveRun: mocks.getActiveRun,
}));

const localizedWorkflowNotFound = "Workflow not found in the selected locale";

let prepareRegisteredDataReads: typeof import("../registered-read-plan").prepareRegisteredDataReads;
let runPreparedDataReads: typeof import("../registered-read-plan").runPreparedDataReads;
beforeAll(async () => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] });
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: {
      en: { ...enLocaleMeta, messages: en },
      fr: { ...enLocaleMeta, messages: { "panels.workflow.notFound": localizedWorkflowNotFound } },
    },
  });
  ({ prepareRegisteredDataReads, runPreparedDataReads } = await import("../registered-read-plan"));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function generatedSkillEntry(skill: RuntimeSkillRef, description = "Generated skill") {
  return {
    skill,
    manifest: { name: skill.name, description },
    source: { kind: "generated" as const },
    provide: async () => ({ skill, files: [{ path: "SKILL.md", content: `---\nname: ${skill.name}\ndescription: ${description}\n---\n` }] }),
  };
}

const credentials = { token: "reader-token", locale: "en" };
const viewer = { domainId: "tenant", userId: "reader" };
const source = { kind: "registered", applicationId: "app-test", useId: "objects" } as const;
const request: RegisteredDataRead = { source, memberPath: [{ member: "catalog" }], inputs: {}, dataName: "rows" };
const entryRef = { applicationId: source.applicationId, useId: source.useId };
const entry = {
  applicationId: source.applicationId, framePanelId: "builtin-product-frame", use: {
    id: source.useId, names: { en: String(source.useId) }, pageKey: "objects", path: "/applications/app-test/objects", panelId: "objects-panel",
    inputs: { search: { literal: "registered input" } },
  },
};

it("does not prepare a placement until the identity owner has accepted the request", async () => {
  mocks.locate.mockRejectedValueOnce(new Error("Invalid credential"));
  await expect(prepareRegisteredDataReads(credentials, [request])).rejects.toThrow("Invalid credential");
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});

it("uses one authenticated registration lookup and one batch, without reading a refused entry", async () => {
  const unavailable = { ...request, source: { ...source, useId: "not-found" } };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [
    { kind: "ready", entry }, { kind: "error", status: 404, error: "Entry not found" },
  ] });
  mocks.resolve.mockImplementationOnce(async (owner, _credentials, req, cache, collectUse) => {
    expect(owner).toEqual(viewer);
    expect(await cache.entry(req.source)).toEqual({
      ...entry,
      registration: { panelId: entry.use.panelId, framePanelId: entry.framePanelId, inputs: entry.use.inputs },
    });
    collectUse("panel", { id: entry.use.panelId, domainId: viewer.domainId, ownerId: "author" });
    collectUse("projection", { id: "builtin-product-catalogue", domainId: null, ownerId: null });
    return { inputs: { search: "registered input" }, projection: {} };
  });
  mocks.prepare.mockImplementationOnce(async (_credentials, _placement, _datum, inputs) => ({
    declaration: { result: "panelRecordList" }, params: inputs, selection: { typeId: OBJECT_TYPE, method: "list" },
  }));
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "forbidden", error: "Owner denied read" }] });
  const prepared = await prepareRegisteredDataReads(credentials, [request, unavailable]);
  expect(mocks.locate).toHaveBeenLastCalledWith([entryRef, { ...entryRef, useId: "not-found" }], credentials);
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([
    { status: "forbidden", reason: "Owner denied read" }, { status: "error", message: "Entry not found" },
  ]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read).toHaveBeenCalledWith(viewer, [{
    source, registration: { panelId: entry.use.panelId, framePanelId: entry.framePanelId, inputs: entry.use.inputs },
    uses: [{ target: { kind: "PANEL", id: entry.use.panelId, domainId: viewer.domainId }, ownerFacts: { ownerId: "author", state: "PUBLISHED" } }],
    call: { type: OBJECT_TYPE, name: "list", parameters: { search: "registered input" } },
  }], credentials);
});

it("plans both policy picker candidate reads with their field, draft and keyword", async () => {
  const { prepareProjectionDataRead } = await vi.importActual<typeof import("../data-reads")>("../data-reads");
  const catalog = { panels: [{ id: "p-new", label: "North panel" }], projections: [], components: [], agents: [] };
  const objectValues = { panelGrants: { "p-granted": "use" } };
  const dataValues = { dataPermissions: { Order: { fieldPermissions: { id: 1 }, rowPermission: "" } } };
  const fixtures = [
    { name: "objectGrantCandidates", id: "p-object", field: "panelGrants", values: objectValues, keyword: "north" },
    { name: "dataClassCandidates", id: "p-data", values: dataValues, keyword: "customer" },
    { name: "dataClassCandidates", id: "p-denied", values: dataValues, keyword: "customer" },
  ];
  const requests = fixtures.map(({ id, field, values, keyword }): RegisteredDataRead => ({
    ...request, dataName: "options", inputs: { selected: { className: PERMISSION_POLICY, primaryKey: id }, values, ...(field && { field }) },
    runtimeParams: { keyword },
  }));
  const payloads = [
    { options: [{ primaryKey: "p-new", value: "p-new", label: "North panel" }], total: 1 },
    { options: [{ primaryKey: "Customer", value: "Customer", label: "Customer", description: "Customer" }], total: 1 },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.policyCatalog.mockResolvedValueOnce(catalog);
  for (const { name, field } of fixtures) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, read, _cache, collectUse) => {
      collectUse("projection", { id: name, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: read.inputs, member: {}, projection: {
        componentId: "@ontomato/sdk:PickerDialog",
        inputs: {
          selected: { kind: "object", objectType: PERMISSION_POLICY },
          values: { kind: "json" },
          ...(field && { field: { kind: "scalar", type: "string" } }),
        },
        data: { options: {
          source: { object: { input: "selected" } }, read: name,
          params: { values: { input: "values" }, ...(field && { field: { input: "field" } }) },
        } },
      }, component: { data: { options: { runtimeParams: ["keyword"] } } } };
    });
    mocks.prepare.mockImplementationOnce(prepareProjectionDataRead);
  }
  mocks.read.mockImplementationOnce(async (_actor, reads: JavaPanelRead[]) => {
    expect(reads.map(({ call }) => call)).toEqual(fixtures.map(({ name, id, field, values, keyword }) => ({
      type: PERMISSION_POLICY, name,
      parameters: { primaryKey: id, values, keyword, ...(field && { field, workbenchCatalog: catalog }) },
    })));
    return { viewer, results: [
      ...payloads.map(payload => ({ status: "ready", payload })),
      { status: "forbidden", error: "Policy read denied" },
    ] };
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const plan = await prepareRegisteredDataReads(credentials, requests);
  expect(await runPreparedDataReads(credentials, plan)).toEqual([
    ...payloads.map(value => ({ status: "ready", value })),
    { status: "forbidden", reason: "Policy read denied" },
  ]);
  expect(mocks.policyCatalog).toHaveBeenCalledTimes(1);
  expect(mocks.policyCatalog).toHaveBeenCalledWith(viewer.domainId, credentials.locale);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("plans member and role effective-access reads with a catalog only for object categories or an unfiltered list", async () => {
  const { prepareProjectionDataRead } = await vi.importActual<typeof import("../data-reads")>("../data-reads");
  const catalog = { panels: [{ id: "local-panel", label: "Named panel" }], projections: [], components: [], agents: [] };
  const access = "effectiveAccess";
  const counts = "effectiveAccessCounts";
  const fixtures = [
    { type: USER, method: access, primaryKey: "u1", category: undefined, needsCatalog: true },
    { type: USER, method: access, primaryKey: "u1", category: "entry", needsCatalog: false },
    { type: USER, method: access, primaryKey: "u1", category: "productObject", needsCatalog: true },
    { type: ROLE, method: access, primaryKey: "r1", category: "capabilityObject", needsCatalog: true },
    { type: ROLE, method: access, primaryKey: "r1", category: "workflowStep", needsCatalog: false },
    { type: USER, method: counts, primaryKey: "u1", category: undefined, needsCatalog: false },
    { type: ROLE, method: counts, primaryKey: "r1", category: undefined, needsCatalog: false },
    { type: USER, method: counts, primaryKey: "u-denied", category: undefined, needsCatalog: false },
  ];
  const requests = fixtures.map(({ type, method, primaryKey, category }): RegisteredDataRead => ({
    ...request,
    memberPath: [{ member: method }],
    dataName: method === counts ? "record" : "rows",
    inputs: { selected: { className: type, primaryKey }, ...(category && { category }) },
  }));
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.policyCatalog.mockResolvedValue(catalog);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  for (const { type, method } of fixtures) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, read, _cache, collectUse) => {
      collectUse("projection", { id: method, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: read.inputs, member: {}, projection: {
        componentId: method === counts ? "@ontomato/sdk:RecordTemplate" : "@ontomato/sdk:ObjectList",
        inputs: {
          selected: { kind: "object", objectType: type },
          ...(method === access && { category: { kind: "scalar", type: "string" } }),
        },
        data: { [method === counts ? "record" : "rows"]: {
          source: { object: { input: "selected" } }, read: method,
          params: method === access ? { category: { input: "category" } } : {},
        } },
      } };
    });
    mocks.prepare.mockImplementationOnce(prepareProjectionDataRead);
  }

  const outputs = {
    entryCount: 1, systemInterfaceCount: 2, productObjectCount: 3, capabilityObjectCount: 4,
    businessDataCount: 5, workflowStepCount: 6, totalCount: 21,
  };
  const payloads = fixtures.slice(0, -1).map(({ type, method, primaryKey, category }) => method === counts
    ? { className: type, primaryKey, label: primaryKey === "u1" ? "Member name" : "Role name", fields: {}, outputs }
    : [{ primaryKey: category ?? "entry", label: "Permission name", fields: { category: category ?? "entry", sources: "Policy name" } }]);
  mocks.read.mockImplementationOnce(async (_viewer, reads: JavaPanelRead[]) => {
    expect(reads.map(({ call }) => call)).toEqual(fixtures.map(({ type, method, primaryKey, category, needsCatalog }) => ({
      type, name: method, parameters: { primaryKey, ...(category && { category }), ...(needsCatalog && { workbenchCatalog: catalog }) },
    })));
    expect(reads.every(read => read.registration.panelId === entry.use.panelId && read.uses.length === 1)).toBe(true);
    return { viewer, results: [
      ...payloads.map(payload => ({ status: "ready", payload })),
      { status: "forbidden", error: "Effective permissions read denied" },
    ] };
  });

  try {
    const prepared = await prepareRegisteredDataReads(credentials, requests);
    expect(await runPreparedDataReads(credentials, prepared)).toEqual([
      ...payloads.map(value => ({ status: "ready", value })),
      { status: "forbidden", reason: "Effective permissions read denied" },
    ]);
    expect(mocks.policyCatalog).toHaveBeenCalledTimes(3);
    expect(mocks.policyCatalog).toHaveBeenCalledWith(viewer.domainId, credentials.locale);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    mocks.policyCatalog.mockReset();
  }
});

it("sends the four Role assignment declarations to the registered owner and presents each result in order", async () => {
  const { prepareProjectionDataRead } = await vi.importActual<typeof import("../data-reads")>("../data-reads");
  const fixtures = [
    { member: "roleMembersList", method: "members", role: "r1", rowType: USER, ids: ["u-2", "u-1"] },
    { member: "rolePoliciesList", method: "policies", role: "r1", rowType: PERMISSION_POLICY, ids: ["p-2", "p-1"] },
    { member: "memberPicker", method: "memberCandidates", role: "r1", rowType: USER, ids: ["u-4", "u-3"] },
    { member: "policyPicker", method: "policyCandidates", role: "r1", rowType: PERMISSION_POLICY, ids: ["p-4", "p-3"] },
    { member: "memberPicker", method: "memberCandidates", role: "reserved", rowType: USER, ids: [] },
    { member: "policyPicker", method: "policyCandidates", role: "reserved", rowType: PERMISSION_POLICY, ids: [] },
    { member: "rolePoliciesList", method: "policies", role: "forbidden", rowType: PERMISSION_POLICY, ids: [] },
    { member: "roleMembersList", method: "members", role: "missing", rowType: USER, ids: [] },
  ];
  const requests = fixtures.map(({ member, role }): RegisteredDataRead => ({
    ...request, memberPath: [{ member }], inputs: { selected: { className: ROLE, primaryKey: role } },
  }));
  const rows = ({ ids, rowType }: typeof fixtures[number]) =>
    ids.map(primaryKey => ({ primaryKey, className: rowType, label: primaryKey, fields: {} }));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { member, method } of fixtures) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, read, _cache, collectUse) => {
      collectUse("projection", { id: member, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: read.inputs, member: {}, projection: {
        componentId: method.endsWith("Candidates") ? "@ontomato/sdk:PickerDialog" : "@ontomato/sdk:ObjectList",
        inputs: { selected: { kind: "object", objectType: ROLE } },
        data: { rows: { source: { object: { input: "selected" } }, read: method, params: {} } },
      } };
    });
    mocks.prepare.mockImplementationOnce(prepareProjectionDataRead);
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ...fixtures.slice(0, 6).map(fixture => ({ status: "ready", payload: rows(fixture) })),
    { status: "forbidden", error: "Role read refused" },
    { status: "error", code: "ROLE_NOT_FOUND", error: "Role not found" },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, requests);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([
    ...fixtures.slice(0, 4).map(fixture => ({ status: "ready", value: rows(fixture) })),
    { status: "empty" }, { status: "empty" },
    { status: "forbidden", reason: "Role read refused" },
    { status: "error", code: "ROLE_NOT_FOUND", message: "Role not found" },
  ]);
  expect(mocks.locate).toHaveBeenCalledWith([entryRef], credentials);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read).toHaveBeenCalledWith(viewer, fixtures.map(({ member, method, role }) => ({
    source, registration: { panelId: entry.use.panelId, framePanelId: entry.framePanelId, inputs: entry.use.inputs },
    uses: [{ target: { kind: "PROJECTION", id: member, domainId: viewer.domainId }, ownerFacts: { ownerId: "author", state: "PUBLISHED" } }],
    call: { type: ROLE, name: method, parameters: { primaryKey: role } },
  })), credentials);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not reveal a planning error from a definition denied by its owner", async () => {
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _req, _cache, collectUse) => {
    collectUse("panel", { id: entry.use.panelId, domainId: viewer.domainId, ownerId: "author" });
    throw new HttpError(400, "Private member shape");
  });
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "forbidden", error: "Owner denied definition" }] });
  const prepared = await prepareRegisteredDataReads(credentials, [request]);
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([{ status: "forbidden", reason: "Owner denied definition" }]);
  expect(mocks.read.mock.lastCall?.[1][0]).not.toHaveProperty("call");
});

it.each(["form", "createForm"] as const)("keeps the role %s draft key contract in the registered batch", async method => {
  const target = method === "form" ? { primaryKey: "role-1" } : {};
  const values = { roleName: "Analyst", userIds: ["u2"] };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const supplied of [values, { "/roleName": "Analyst" }]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelFormDescription" },
      selection: { typeId: ROLE, method, ...target },
      params: { values: supplied },
    });
  }
  const form = { submitOn: "manual", fields: [], values, errors: [],
    save: { method: "POST", path: "/panel/governance/roles/save", bodySchema: {} } };
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "ready", payload: form }, { status: "ready" }] });

  const prepared = await prepareRegisteredDataReads(credentials, [request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: form },
    { status: "error", code: "INVALID_REQUEST" },
  ]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  const batch = mocks.read.mock.lastCall![1];
  expect(batch[0].call).toEqual({ type: ROLE, name: method, parameters: { values, ...target } });
  expect(batch[1]).not.toHaveProperty("call");
});

it("reads declared ontology definitions locally and asks Java only for the selected type's count", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const reads = [
    { typeId: ONTOLOGY_TYPE, method: "list", result: "panelRecordList", params: {} },
    { typeId: ONTOLOGY_TYPE, method: "typeRelations", result: "panelRecordList", params: { type: ACTION } },
    { typeId: ONTOLOGY_RELATION_KIND, method: "record", primaryKey: "action.uses-function", result: "panelRecord", params: {} },
    { typeId: ONTOLOGY_TYPE, method: "record", primaryKey: OBJECT_TYPE, result: "panelRecord", params: {} },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { result, params, ...selection } of reads) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, selection, params });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ...reads.map(() => ({ status: "ready" })),
    { status: "ready", payload: { objectTypes: 2, attributes: 3, relationships: 4 } },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, reads.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: expect.arrayContaining([expect.objectContaining({ primaryKey: ACTION })]) },
    { status: "ready", value: expect.arrayContaining([expect.objectContaining({ primaryKey: "action.uses-function" })]) },
    { status: "ready", value: { primaryKey: "action.uses-function", fields: { fromObject: { primaryKey: ACTION } } } },
    { status: "ready", value: { primaryKey: OBJECT_TYPE, fields: { countStatus: "ok", count: 2 } } },
  ]);
  expect(mocks.read.mock.lastCall![1].map(({ call }: JavaPanelRead) => call)).toEqual([
    ...reads.map(() => undefined), { type: ONTOLOGY_TYPE, name: "metadataCounts", parameters: {} },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("sends the Workbench policy catalog only to edit forms and shares it within the batch", async () => {
  const values = { postName: "Draft" };
  const page = { number: 2, size: 20 };
  const choices = ["p2", "p1"];
  const catalog = { panels: [{ id: "panel-1", label: "Catalog panel" }], projections: [], components: [], agents: [] };
  const reads = [
    ["form", "p1", { values }], ["form", "p2", {}], ["createForm", undefined, { values }],
    ["query", undefined, { page }], ["record", "p1", {}], ["options", undefined, {}],
    ["resolve", undefined, { values: choices }], ["form", "p3", { values: { "/postName": "Invalid" } }],
  ] as const;
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.policyCatalog.mockResolvedValueOnce(catalog);
  for (const [method, primaryKey, params] of reads) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelFormDescription" }, selection: { typeId: PERMISSION_POLICY, method, primaryKey }, params,
    });
  }
  const form = { submitOn: "manual", fields: [], values, errors: [],
    save: { method: "POST", path: "/panel/governance/policies/save", bodySchema: {} } };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: form }, { status: "forbidden", error: "No policy access" },
    ...Array.from({ length: 5 }, () => ({ status: "empty" })), { status: "ready" },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, reads.map(() => request));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(results[0]).toEqual({ status: "ready", value: form });
  expect(results[1]).toEqual({ status: "forbidden", reason: "No policy access" });
  expect(results.at(-1)).toMatchObject({ status: "error", code: "INVALID_REQUEST" });
  expect(mocks.policyCatalog.mock.calls).toEqual([[viewer.domainId, credentials.locale]]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read.mock.lastCall![1].map((item: JavaPanelRead) => item.call)).toEqual([
    { type: PERMISSION_POLICY, name: "form", parameters: { primaryKey: "p1", values, workbenchCatalog: catalog } },
    { type: PERMISSION_POLICY, name: "form", parameters: { primaryKey: "p2", workbenchCatalog: catalog } },
    { type: PERMISSION_POLICY, name: "createForm", parameters: { values } },
    { type: PERMISSION_POLICY, name: "query", parameters: { page } },
    { type: PERMISSION_POLICY, name: "record", parameters: { primaryKey: "p1" } },
    { type: PERMISSION_POLICY, name: "options", parameters: {} },
    { type: PERMISSION_POLICY, name: "resolve", parameters: { values: choices } },
    undefined,
  ]);
});

it("includes object entry usage only in registered entry and object policy forms", async () => {
  const policyTypes = [1, 2, 3];
  const items = [{ kind: "PANEL", id: "orders-panel", entries: [{ id: "orders/main", label: "Orders" }] }];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.policyCatalog.mockResolvedValueOnce({ panels: [], projections: [], components: [], agents: [] });
  mocks.policyObjectEntryUsage.mockResolvedValueOnce({ policyId: "p3", items });
  for (const postType of policyTypes) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelFormDescription" },
      selection: { typeId: PERMISSION_POLICY, method: "form", primaryKey: `p${postType}` },
      params: {},
    });
  }
  mocks.read.mockResolvedValueOnce({
    viewer,
    results: policyTypes.map(postType => ({
      status: "ready",
      payload: {
        submitOn: "manual", fields: [], values: { postType }, errors: [],
        save: { method: "POST", path: "/panel/governance/policies/save", bodySchema: {} },
      },
    })),
  });

  const prepared = await prepareRegisteredDataReads(credentials, policyTypes.map(() => request));
  const [system, data, entryAndObject] = await runPreparedDataReads(credentials, prepared);
  expect(entryAndObject).toMatchObject({ status: "ready", value: { values: { postType: 3, entryUsage: items } } });
  expect(system).toMatchObject({ status: "ready", value: { values: { postType: 1 } } });
  expect(system).not.toHaveProperty("value.values.entryUsage");
  expect(data).toMatchObject({ status: "ready", value: { values: { postType: 2 } } });
  expect(data).not.toHaveProperty("value.values.entryUsage");
  expect(mocks.policyObjectEntryUsage).toHaveBeenCalledWith(credentials, viewer.domainId, "p3");
});

it("preserves browser error replies for missing owner records and metric execution refusals", async () => {
  const record = (typeId: string) => ({
    selection: { typeId, method: "record", primaryKey: "removed" }, params: {}, declaration: { result: "panelRecord" },
  });
  const metric = {
    selection: { typeId: METRIC_VIEW, method: "result", primaryKey: "metric" }, params: {}, declaration: { result: "metricOutput" },
  };
  const reads = [record(TRIGGER), record(METRIC_VIEW), record(FUNCTION), metric, metric, metric, metric, metric];
  const error = (code: string, message: string) => ({ status: "error", code, error: message });
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const read of reads) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce(read);
  }
  const output = {
    rows: [], columns: [{ key: "value", label: null, type: null }],
    truncation: { truncated: true, rowLimit: 1, truncationHint: "Narrow the year" }, sourceObjectTypes: [],
  };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready" }, error("TASK_NOT_FOUND", "Trigger or run not found"), { status: "ready" }, { status: "ready" },
    error("METRIC_VIEW_NOT_FOUND", "Metric not found"), error("FUNCTION_NOT_FOUND", "Function not found"),
    { status: "ready", payload: output },
    error("ONTOLOGY_QUERY_FAILED", "Missing parameter: region"),
    { status: "forbidden", error: "Field is outside the authorized scope" },
    error("METRIC_VIEW_NOT_EXECUTABLE", "Executable read metric not found"),
    error("PANEL_READ_TIMEOUT", "The panel read deadline expired"),
  ] });
  const prepared = await prepareRegisteredDataReads(credentials, reads.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([
    { status: "error", message: "Trigger or run not found" },
    { status: "error", message: "Metric not found" },
    { status: "error", message: "Function not found" },
    { status: "ready", value: output },
    { status: "error", message: "Missing parameter: region" },
    { status: "forbidden", reason: "Field is outside the authorized scope" },
    { status: "error", message: "Executable read metric not found" },
    { status: "error", code: "PANEL_READ_TIMEOUT", message: "The panel read deadline expired" },
  ]);
});

it("presents both Action explanation reads from the registered record fact", async () => {
  const primaryKey = "approve-order";
  const definition = {
    version: 1, source: "DERIVED", verified: false, name: "Approve order", description: null, codeHash: "a".repeat(64),
    explanationVersion: 3, effects: [{ kind: "UPDATE_OBJECT", kindLabel: "Update object", className: "Order" }], affects: ["Order"],
  };
  const code = "# ontomato-python:2";
  const codeSegments = [
    { id: "s1", kind: "UPDATE_OBJECT", kindLabel: "Update object", title: "Approve", codeRange: { start: 1, end: 4 } },
  ];
  const { codeHash, explanationVersion } = definition;
  const raw = {
    status: "ready",
    payload: { id: primaryKey, name: definition.name, definition, codeHash, explanationVersion, function: { code }, codeSegments },
  };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const [method, result] of [["definition", "actionDefinition"], ["explanation", "actionExplanation"]]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ selection: { typeId: ACTION, method, primaryKey }, params: {}, declaration: { result } });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [raw, raw] });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const prepared = await prepareRegisteredDataReads(credentials, [request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([
    { status: "ready", value: definition },
    { status: "ready", value: { code, codeHash, explanationVersion, codeSegments } },
  ]);
  const call = { type: ACTION, name: "record", parameters: { primaryKey } };
  expect((mocks.read.mock.lastCall![1] as JavaPanelRead[]).map(read => read.call)).toEqual([call, call]);
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps chart input and metric output errors on their own items after placement authorization", async () => {
  const malformedCard = {
    declaration: { result: "chartTemplate" }, params: {},
    selection: { typeId: DASHBOARD_CARD, method: "chartTemplate", primaryKey: "%/card" },
  };
  const metric = {
    declaration: { result: "metricOutput" }, params: {},
    selection: { typeId: METRIC_VIEW, method: "result", primaryKey: "metric" },
  };
  const output = { rows: [{ value: 1 }], columns: [{ key: "value", label: "Value", type: null }], truncation: null };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const prepared of [malformedCard, malformedCard, metric, metric]) {
    mocks.resolve.mockImplementationOnce(async (_viewer, _credentials, _request, _cache, collectUse) => {
      collectUse("projection", { id: "chart", domainId: viewer.domainId, ownerId: "author" });
      return { inputs: {}, projection: {} };
    });
    mocks.prepare.mockResolvedValueOnce(prepared);
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "forbidden", error: "Owner denied definition" },
    { status: "ready" },
    { status: "ready", payload: { ...output, rows: "invalid" } },
    { status: "ready", payload: output },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [request, request, request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "forbidden", reason: "Owner denied definition" },
    { status: "error", code: "PANEL_READ_INPUT_INVALID" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    { status: "ready", value: output },
  ]);
  const [denied, malformed, executed] = mocks.read.mock.lastCall![1];
  expect(denied).not.toHaveProperty("call");
  expect(malformed).not.toHaveProperty("call");
  expect(executed.call).toMatchObject({ type: METRIC_VIEW, name: "result" });
});

it("locates favorite card placements without data calls and reads each preview from its card owner", async () => {
  const board = {
    id: "followed", ownerId: viewer.userId, name: "Dashboard",
    groups: [{
      metrics: [{ id: "kpi", name: "KPI", query: { metricId: "scalar", parameters: {} }, valueField: "total" }],
      charts: [{ id: "trend", name: "Trend", query: { metricId: "timeseries", parameters: {} }, chartFile: {
        name: "trend.chart.json", content: {
          dataset: [{ id: "metric", dimensions: ["day", "total"], source: [] }],
          series: [{ id: "plot", type: "line", datasetId: "metric", encode: { x: "day", y: "total" } }],
          ontomato: {},
        },
      } }],
    }],
  };
  const placement = async (_owner: unknown, _credentials: unknown, _request: unknown, _cache: unknown,
    collectUse: Parameters<typeof import("../data-reads").resolveReadMember>[4]) => {
    collectUse!("projection", {
      id: "home-card", domainId: viewer.domainId, ownerId: viewer.userId,
      definition: {}, revision: 1, createdAt: new Date(0), updatedAt: new Date(0),
    });
    return { inputs: {}, projection: {} };
  };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockImplementationOnce(placement);
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordList" }, params: { targetGroup: "dashboardCards" },
    selection: { typeId: FAVORITE, method: "list" },
  });
  mocks.favoriteState.mockResolvedValueOnce({
    dashboardIds: [board.id], dashboardCards: {}, pinnedObjects: [], pinnedSessions: [], favorites: [],
  });
  mocks.dashboard.mockResolvedValueOnce(board);
  mocks.read.mockImplementationOnce(async () => {
    expect(mocks.favoriteState).not.toHaveBeenCalled();
    return { viewer, results: [{ status: "ready" }] };
  });

  const list = await prepareRegisteredDataReads(credentials, [request]);
  const key = (cardId: string) => dashboardCardPrimaryKey({ dashboardId: board.id, cardId });
  expect(await runPreparedDataReads(credentials, list)).toMatchObject([{ status: "ready", value: [
    { primaryKey: key("kpi"), fields: { kind: "metric" } },
    { primaryKey: key("trend"), fields: { kind: "chart" } },
  ] }]);
  const [metadataRead] = mocks.read.mock.lastCall![1];
  expect(metadataRead).not.toHaveProperty("call");
  expect(metadataRead.uses).toMatchObject([{ target: { kind: "PROJECTION", id: "home-card" } }]);
  expect(mocks.dashboard).toHaveBeenCalledWith(viewer.userId, viewer.domainId, board.id, undefined);
  expect(mocks.dashboards).not.toHaveBeenCalled();

  const output = { rows: [{ total: 7 }], columns: [{ key: "total", label: "Total", type: null }], truncation: null };
  const previews = [
    { method: "chartTemplate", card: "trend", result: "chartTemplate" },
    { method: "result", card: "trend", result: "metricOutput" },
    { method: "result", card: "kpi", result: "metricOutput" },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { method, card, result } of previews) {
    mocks.resolve.mockImplementationOnce(placement);
    mocks.dashboard.mockResolvedValueOnce(board);
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result }, params: {},
      selection: { typeId: DASHBOARD_CARD, method, primaryKey: key(card) },
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready" },
    { status: "error", code: "METRIC_UNAVAILABLE", error: "Trend metric unavailable" },
    { status: "ready", payload: output },
  ] });

  const previewPlan = await prepareRegisteredDataReads(credentials, previews.map(() => request));
  expect(await runPreparedDataReads(credentials, previewPlan)).toMatchObject([
    { status: "ready", value: { chartFile: { name: "trend.chart.json" } } },
    { status: "error", code: "METRIC_UNAVAILABLE" },
    { status: "ready", value: output },
  ]);
  expect(mocks.read.mock.lastCall![1].map(({ call }: { call?: unknown }) => call)).toEqual([
    undefined,
    { type: METRIC_VIEW, name: "result", parameters: { primaryKey: "timeseries", parameters: {} } },
    { type: METRIC_VIEW, name: "result", parameters: { primaryKey: "scalar", parameters: {} } },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("uses only the admitted personal owner and directory facts for the workspace reads", async () => {
  const { assistantStore } = await import("../../assistant/store");
  const { platformHomeStore } = await import("../../platform-home/store");
  const { personalWorkspaceStore } = await import("../../personal-workspace/store");
  const current = await import("../../../infrastructure/product-current");
  const id = "11111111-1111-4111-8111-111111111111";
  const hiddenId = "22222222-2222-4222-8222-222222222222";
  const panelId = "hidden-home";
  const channelAgents = vi.spyOn(assistantStore, "channelAgents").mockResolvedValue([id, hiddenId].map(agentId => ({
    id: agentId, domain_id: viewer.domainId, owner_id: "other", kind: "custom", name: "Directory agent",
    description: "", enabled: true, icon: null,
  } as Awaited<ReturnType<typeof assistantStore.channelAgents>>[number])));
  const ownedSessions = vi.spyOn(assistantStore, "ownedSessionsByIds").mockResolvedValue(new Map());
  const homePanelId = vi.spyOn(platformHomeStore, "homePanelId").mockResolvedValue(panelId);
  const currentPanel = vi.spyOn(current, "findCurrentProduct").mockResolvedValue({
    id: panelId, domainId: viewer.domainId, ownerId: "other",
  } as Awaited<ReturnType<typeof current.findCurrentProduct>>);
  const recent = vi.spyOn(personalWorkspaceStore, "recent").mockResolvedValue(["app-visible", "app-hidden"].map(appId => ({
    appId, title: appId, path: `/applications/${appId}`, visitedAt: "2026-11-26T00:00:00Z",
  })));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const favorites = {
    favorites: [{ kind: "application", id: "app-visible" }, { kind: "agent", id }, { kind: "agent", id: hiddenId }],
    dashboardIds: ["stale-board"], dashboardCards: {}, pinnedSessions: ["stale-session"], pinnedObjects: [],
  };
  mocks.favoriteState.mockResolvedValueOnce(favorites).mockResolvedValueOnce(favorites).mockResolvedValueOnce(favorites);
  mocks.dashboards.mockResolvedValueOnce([]);
  const emptyRange = { fixed: false, all: false, objectIds: [], authorId: null };
  const catalog = [{ id: "app-visible", kind: "native", names: { en: "Visible app" }, descriptions: {},
    rail: "apps", category: "business", sort: 0, icon: "app-window", entry: { path: "/work" },
    scheduleAdapter: null, releaseId: null }];
  const cases = [
    { typeId: FAVORITE, method: "list", params: { targetGroup: "apps" }, response: {
      status: "ready", payload: catalog, visibility: { AGENT: { USE: { ...emptyRange, objectIds: [id] } } },
    } },
    { typeId: FAVORITE, method: "list", params: { targetGroup: "dashboards" }, response: { status: "ready" } },
    { typeId: FAVORITE, method: "list", params: { targetGroup: "sessions" }, response: { status: "ready" } },
    { typeId: RECENT_VISIT, method: "list", params: { limit: 8 }, response: { status: "ready", payload: catalog } },
    { typeId: PRODUCT_PANEL, method: "homePanel", params: {}, response: { status: "ready", visibility: { PANEL: { USE: emptyRange } } } },
    { typeId: PRODUCT_PANEL, method: "homePanel", params: {}, response: { status: "forbidden", error: "Placement denied" } },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { typeId, method, params } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result: typeId === PRODUCT_PANEL ? "panelRecord" : "panelRecordList" },
      params, selection: { typeId, method } });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(mocks.favoriteState).not.toHaveBeenCalled();
    expect(homePanelId).not.toHaveBeenCalled();
    return { viewer, results: cases.map(item => item.response) };
  });

  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
      { status: "ready", value: [
        { primaryKey: "app-visible", label: "Visible app" },
        { primaryKey: id, label: "Directory agent" },
        { primaryKey: hiddenId, outputs: { unavailable: true, openPath: "" } },
      ] },
      { status: "ready", value: [{ primaryKey: "stale-board", outputs: { unavailable: true, openPath: "" } }] },
      { status: "ready", value: [{ primaryKey: "stale-session", outputs: { unavailable: true, openPath: "" } }] },
      { status: "ready", value: [{ primaryKey: "/applications/app-visible", fields: { appName: "Visible app" } }] },
      { status: "ready", value: {
        primaryKey: panelId, fields: { unavailableReason: "You cannot use this panel." },
        outputs: { unavailable: true, isCustomHome: true },
      } },
      { status: "forbidden", reason: "Placement denied" },
    ]);
    expect(mocks.locate).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledOnce();
    const navigation = { type: APPLICATION, name: "navigation", parameters: {} };
    const items = mocks.read.mock.lastCall![1];
    expect(items.map((item: { call?: unknown }) => item.call)).toEqual([navigation, undefined, undefined, navigation, undefined, undefined]);
    expect(items.map((item: { visibleKinds?: unknown }) => item.visibleKinds)).toEqual([
      [{ kind: "AGENT", verbs: ["USE"] }], undefined, undefined, undefined,
      [{ kind: "PANEL", verbs: ["USE"] }], [{ kind: "PANEL", verbs: ["USE"] }],
    ]);
    expect(channelAgents).toHaveBeenCalledWith(viewer.domainId);
    expect(ownedSessions).toHaveBeenCalledWith(viewer, ["stale-session"]);
    expect(recent).toHaveBeenCalledWith(viewer);
    expect(homePanelId).toHaveBeenCalledOnce();
    expect(homePanelId).toHaveBeenCalledWith(viewer);
    expect(currentPanel).toHaveBeenCalledWith(viewer.domainId, "panel", panelId);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    channelAgents.mockRestore();
    ownedSessions.mockRestore();
    homePanelId.mockRestore();
    currentPanel.mockRestore();
    recent.mockRestore();
  }
});

it("reads registered gallery sources by category and preserves favorites ordering and failures", async () => {
  const { assistantStore } = await import("../../assistant/store");
  const { platformHomeStore } = await import("../../platform-home/store");
  const prefs = vi.spyOn(platformHomeStore, "preferences");
  const allowed = "11111111-1111-4111-8111-111111111111";
  const denied = "22222222-2222-4222-8222-222222222222";
  const disabled = "33333333-3333-4333-8333-333333333333";
  const foreign = "44444444-4444-4444-8444-444444444444";
  const channelAgents = vi.spyOn(assistantStore, "channelAgents").mockResolvedValue(
    [allowed, denied, disabled, foreign].map(id => ({
      id, domain_id: id === foreign ? "elsewhere" : viewer.domainId, owner_id: "author",
      kind: "test-agent", name: "Visible analyst", description: "", enabled: id !== disabled, icon: null,
    } as Awaited<ReturnType<typeof assistantStore.channelAgents>>[number])),
  );
  const app = (id: string, rail: string, category: string, name: string) => ({
    id, kind: "native", names: { en: name }, descriptions: { en: "Metric tools" }, icon: "app-window", rail, category, sort: 0,
    entry: { path: "/" + id }, scheduleAdapter: null, releaseId: null,
  });
  const catalog = [
    app("settings", "bottom", "admin", "Settings"),
    app("dashboards", "apps", "business", "Dashboards"),
    app("warehouse", "top", "business", "Warehouse"),
    app("home", "top", "business", "Personal workbench"),
  ];
  const range = { all: false, fixed: false, authorId: null, objectIds: [allowed, disabled, foreign] };
  const agentFacts = { AGENT: { USE: range } };
  const data = {
    dashboardIds: [],
    favorites: [
      { kind: "agent" as const, id: allowed },
      { kind: "application" as const, id: "dashboards" },
      { kind: "agent" as const, id: denied },
    ],
  };
  const storageError = new Error("Gallery preferences unavailable");
  prefs.mockResolvedValueOnce(data).mockResolvedValueOnce(data).mockResolvedValueOnce(data).mockRejectedValueOnce(storageError);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const run = async (cases: { params: Record<string, unknown>; reply: Record<string, unknown> }[]) => {
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
    for (const { params } of cases) {
      mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
      mocks.prepare.mockResolvedValueOnce({
        declaration: { result: "panelRecordQuery" }, params, selection: { typeId: APPLICATION, method: "available" },
      });
    }
    mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(({ reply }) => reply) });
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    return runPreparedDataReads(credentials, prepared);
  };

  try {
    const results = await run([
      { params: {}, reply: { status: "ready", payload: catalog, visibility: agentFacts } },
      { params: { category: "agents", search: "analyst" }, reply: { status: "ready", visibility: agentFacts } },
      { params: { favoritesOnly: true }, reply: { status: "ready", payload: catalog, visibility: agentFacts } },
      { params: { category: "admin", search: "metric" }, reply: { status: "ready", payload: catalog } },
      { params: {}, reply: { status: "forbidden", error: "Placement denied" } },
    ]);
    const analyst = { primaryKey: allowed, className: AGENT_DEFINITION, label: "Visible analyst", fields: { favorite: true } };
    expect(results).toMatchObject([
      { status: "ready", value: { rows: [
        { primaryKey: "warehouse" },
        { primaryKey: "dashboards", label: "Dashboards", fields: { favorite: true }, outputs: { openPath: "/dashboards" } },
        { primaryKey: "settings" }, analyst,
      ], total: 4 } },
      { status: "ready", value: { rows: [analyst], total: 1 } },
      { status: "ready", value: { rows: [analyst, { primaryKey: "dashboards" }], total: 2 } },
      { status: "ready", value: { rows: [{ primaryKey: "settings" }], total: 1, diagnostics: [en["panels.favorite.loadUnavailable"]] } },
      { status: "forbidden", reason: "Placement denied" },
    ]);
    expect(results[3]).not.toHaveProperty("value.rows.0.fields.favorite");
    const navigation = { type: APPLICATION, name: "navigation", parameters: {} };
    const scope = [{ kind: "AGENT", verbs: ["USE"] }];
    expect(mocks.read.mock.lastCall![1].map(({ call, visibleKinds }: { call?: unknown; visibleKinds?: unknown }) =>
      [call, visibleKinds])).toEqual([
      [navigation, scope], [undefined, scope], [navigation, scope], [navigation, undefined], [navigation, scope],
    ]);
    expect(channelAgents.mock.calls).toEqual(Array.from({ length: 3 }, () => [viewer.domainId]));
    prefs.mockRejectedValueOnce(storageError);
    await expect(run([{ params: { category: "business", favoritesOnly: true }, reply: { status: "ready", payload: catalog } }]))
      .rejects.toBe(storageError);
    expect(prefs.mock.calls).toEqual(Array.from({ length: 5 }, () => [viewer]));
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    prefs.mockRestore();
    channelAgents.mockRestore();
  }
});

it("keeps agent directory scopes and exact record grants in the registered batch", async () => {
  const { assistantStore } = await import("../../assistant/store");
  const [editableId, readOnlyId, deniedId, missingId] = [1, 2, 3, 4].map(value => `10000000-0000-4000-8000-00000000000${value}`);
  const agent = (id: string) => ({
    id, domain_id: viewer.domainId, owner_id: `author-${id.at(-1)}`, kind: "custom", name: "Directory agent",
    description: "", enabled: true, icon: null,
  });
  const stored = vi.spyOn(assistantStore, "agent").mockImplementation(async id => {
    if (id === missingId) throw new HttpError(404, "Agent not found", "NOT_FOUND");
    return agent(id) as Awaited<ReturnType<typeof assistantStore.agent>>;
  });
  const summaries = vi.spyOn(assistantStore, "agentDefinitionSummaries").mockResolvedValue([
    { ...agent(readOnlyId), sort_order: 0, editable: false },
  ]);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const range = (...objectIds: string[]) => ({ fixed: false, all: false, authorId: null, objectIds });
  const AGENT = { VIEW: range(readOnlyId), EDIT: range() };
  const cases = [
    { method: "list", result: "panelRecordList" },
    ...[editableId, readOnlyId, deniedId, missingId, RETRIEVAL_AGENT_ID].map(primaryKey =>
      ({ method: "record", result: "panelRecord", primaryKey })),
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { result, ...selection } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params: {}, selection: { ...selection, typeId: AGENT_DEFINITION } });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(summaries).not.toHaveBeenCalled();
    return { viewer, results: [
      { status: "ready", payload: { retriever: null }, visibility: { AGENT } },
      { status: "ready", payload: { editable: true, shared: true } },
      { status: "ready", payload: { editable: false } },
      { status: "forbidden", error: "Agent VIEW required" },
      { status: "ready" },
      { status: "ready", payload: { retriever: {
        id: RETRIEVAL_AGENT_ID, kind: "retrieval", name: "Retriever", modelSelection: { modelId: "chat" }, editable: true,
      }, shared: false } },
    ] };
  });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: [{ primaryKey: readOnlyId }] },
      { status: "ready", value: { primaryKey: editableId, outputs: { canEdit: true, domainShared: true } } },
      { status: "ready", value: { primaryKey: readOnlyId, outputs: { canEdit: false } } },
      { status: "forbidden", reason: "Agent VIEW required" },
      { status: "error", code: "NOT_FOUND", message: "Agent not found" },
      { status: "ready", value: { primaryKey: RETRIEVAL_AGENT_ID, label: "Data retrieval", outputs: { canEdit: true, domainShared: false } } },
    ]);
    expect(results[2]).not.toHaveProperty("value.outputs.domainShared");
    const items: JavaPanelRead[] = mocks.read.mock.lastCall![1];
    expect(items[0].visibleKinds).toEqual([{ kind: "AGENT", verbs: ["VIEW", "EDIT"] }]);
    expect(items.map(item => item.call)).toEqual([
      { type: AGENT_DEFINITION, name: "list", parameters: {} },
      ...[editableId, readOnlyId, deniedId].map(primaryKey => ({ type: AGENT_DEFINITION,
        name: "record", parameters: { primaryKey, ownerId: agent(primaryKey).owner_id } })),
      undefined,
      { type: AGENT_DEFINITION, name: "record", parameters: { primaryKey: RETRIEVAL_AGENT_ID } },
    ]);
    expect(stored.mock.calls).toEqual([editableId, readOnlyId, deniedId, missingId].map(id => [id, viewer]));
    expect(summaries).toHaveBeenCalledWith(viewer.domainId, AGENT.VIEW, { includeSystem: true, editRange: AGENT.EDIT });
    expect(mocks.locate).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    stored.mockRestore();
    summaries.mockRestore();
  }
});

it("describes agent deletion with the admitted EDIT decision and the existing system and preset restrictions", async () => {
  const { APP_BUILDER_KIND } = await import("../../app-builder/definition");
  const { OPS_DIAGNOSIS_KIND } = await import("../../ops-diagnosis/definition");
  const { assistantStore } = await import("../../assistant/store");
  const [builder, diagnosis, preset, readOnlyPreset, editable, missing, failed, invalid] =
    Array.from({ length: 8 }, (_, index) => "30000000-0000-4000-8000-00000000000" + index);
  const ids = [RETRIEVAL_AGENT_ID, builder, diagnosis, preset, readOnlyPreset, editable, missing, failed, invalid];
  const kinds = new Map([[builder, APP_BUILDER_KIND], [diagnosis, OPS_DIAGNOSIS_KIND], [preset, "regular"], [readOnlyPreset, "regular"]]);
  const fetched = vi.fn();
  vi.stubGlobal("fetch", fetched);
  const stored = vi.spyOn(assistantStore, "findAgent").mockImplementation(async id => id === missing ? undefined : ({
    id, domain_id: viewer.domainId, owner_id: "stored-author", kind: kinds.get(id) ?? "custom",
  } as NonNullable<Awaited<ReturnType<typeof assistantStore.findAgent>>>));
  const opRequest: RegisteredDataRead = { source, memberPath: [{ member: "remove" }], operations: true, inputs: {} };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const primaryKey of ids) {
    mocks.resolve.mockResolvedValueOnce({
      panel: { manifest: { state: {}, members: {} } },
      member: { inputs: { agent: { literal: { className: AGENT_DEFINITION, primaryKey } } } },
      projection: {
        inputs: { agent: { kind: "object", objectType: AGENT_DEFINITION } },
        operations: { remove: { operation: { kind: "PlatformOperation", id: DELETE_AGENT }, target: { input: "agent" } } },
      },
      inputs: {},
    });
  }
  mocks.read.mockImplementationOnce(async (_viewer, reads: JavaPanelRead[]) => ({
    viewer,
    results: reads.map(({ call }) => {
      if (!call) return { status: "ready" };
      const { primaryKey } = call.parameters;
      if (primaryKey === failed) return { status: "error", code: "PANEL_READ_ERROR", error: "Owner read failed" };
      return { status: "ready", payload: primaryKey === invalid ? "yes" : primaryKey !== readOnlyPreset };
    }),
  }));
  const unavailable = (reason: string) => ({ status: "ready", value: { remove: { unavailable: { reason } } } });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, ids.map(() => opRequest));
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      ...Array.from({ length: 3 }, () => unavailable(en["panels.agentDefinition.systemCannotDelete"])),
      unavailable(en["panels.agentDefinition.presetCannotDelete"]),
      unavailable(en["panels.agentForm.editReadOnly"]),
      { status: "ready", value: { remove: { handlerRef: DELETE_AGENT } } },
      { status: "error", code: "NOT_FOUND", message: "Agent not found" },
      { status: "error", code: "PANEL_READ_ERROR", message: "Owner read failed" },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    ]);
    expect(results[5]).not.toHaveProperty("value.remove.unavailable");
    const reads: JavaPanelRead[] = mocks.read.mock.lastCall![1];
    expect(reads.map(({ call }) => call)).toEqual(ids.map(primaryKey =>
      [preset, readOnlyPreset, editable, failed, invalid].includes(primaryKey)
        ? { type: AGENT_DEFINITION, name: "deleteAvailability", parameters: { primaryKey, ownerId: "stored-author" } }
        : undefined));
    expect(stored.mock.calls.every(([id, domain]) => id !== RETRIEVAL_AGENT_ID && domain === viewer.domainId)).toBe(true);
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(fetched).not.toHaveBeenCalled();
  } finally {
    stored.mockRestore();
  }
});

it("reads AgentDefinition form and createForm from one admitted second batch", async () => {
  const { assistantStore } = await import("../../assistant/store");
  const visible = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" } as const;
  const analystEntry = generatedSkillEntry(visible);
  mocks.skills.mockResolvedValue({ registry: { getSkills: () => [analystEntry] } });
  const hidden = { namespace: { kind: "domain", domainId: viewer.domainId }, name: "removed-skill" } as const;
  const primaryKey = "20000000-0000-4000-8000-000000000009";
  const stored = vi.spyOn(assistantStore, "agent").mockResolvedValue({
    id: primaryKey, domain_id: viewer.domainId, owner_id: "stored-owner",
    kind: "custom", name: "Inventory analyst", description: "", icon: null, enabled: false, engine: "pi",
    model_selection: { modelId: null }, execution_user_id: null, system_prompt: "", sort_order: 0,
    skills: [visible, hidden], class_names: [], enabled_mcp_service_ids: [],
  } as Awaited<ReturnType<typeof assistantStore.agent>>);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const local = { typeId: AGENT_DEFINITION, method: "form", primaryKey };
  const retriever = { ...local, primaryKey: RETRIEVAL_AGENT_ID };
  const create = { typeId: AGENT_DEFINITION, method: "createForm" };
  const selections = [local, retriever, create, local, create, create];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const [index, selection] of selections.entries()) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    const params = index === 5 ? { values: {
      name: "New analyst", description: "", icon: null, enabled: true, systemPrompt: "",
      skills: [], enabledMcpServiceIds: [], executionUserId: "member",
    }, changedField: null } : {};
    mocks.prepare.mockResolvedValueOnce({ declaration: { result: "panelFormDescription" }, selection, params });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: { editable: false, canSetExecutionUser: false } },
    { status: "ready", payload: { retriever: {
      id: RETRIEVAL_AGENT_ID, kind: "retrieval", name: "retriever", modelSelection: { modelId: null }, editable: false,
    } } },
    { status: "ready", payload: { canSetExecutionUser: true } },
    { status: "forbidden", error: "View revoked" },
    { status: "forbidden", error: "Create revoked" },
    { status: "ready", payload: { canSetExecutionUser: true } },
  ] });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, selections.map(() => request));
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: { values: { name: "Inventory analyst", enabled: false, skills: [visible] } } },
      { status: "ready", value: { values: { modelSelection: { modelId: null } } } },
      { status: "ready", value: { values: { name: "", publicationAccess: { kind: "private" } } } },
      { status: "forbidden", reason: "View revoked" },
      { status: "forbidden", reason: "Create revoked" },
      { status: "ready", value: { values: { name: "New analyst", executionUserId: "member" }, errors: [] } },
    ]);
    const form = results[0];
    if (form.status !== "ready") throw new Error("Expected the admitted edit form");
    expect(form.value).toMatchObject({ fields: expect.arrayContaining([
      { path: "/name", readOnly: true, readOnlyReason: expect.any(String) },
      { path: "/executionUserId", readOnly: true, readOnlyReason: expect.any(String) },
    ].map(field => expect.objectContaining(field))) });
    expect(mocks.read.mock.lastCall?.[1].map(({ call }: JavaPanelRead) => call)).toEqual([
      { type: AGENT_DEFINITION, name: "form", parameters: { primaryKey, ownerId: "stored-owner" } },
      { type: AGENT_DEFINITION, name: "form", parameters: { primaryKey: RETRIEVAL_AGENT_ID } },
      { type: AGENT_DEFINITION, name: "createForm", parameters: {} },
      { type: AGENT_DEFINITION, name: "form", parameters: { primaryKey, ownerId: "stored-owner" } },
      { type: AGENT_DEFINITION, name: "createForm", parameters: {} },
      { type: AGENT_DEFINITION, name: "createForm", parameters: {
        validation: { oldExecutionUserId: null, executionUserId: "member", modelId: null },
      } },
    ]);
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    mocks.skills.mockReset();
    stored.mockRestore();
  }
});

it("presents agent grant rows from the admitted agent-access batch without a separate request", async () => {
  const { assistantStore } = await import("../../assistant/store");
  const [custom, denied, invalid] = [1, 2, 3].map(index => "20000000-0000-4000-8000-00000000000" + index);
  const stored = vi.spyOn(assistantStore, "agent").mockImplementation(async id => ({
    id, domain_id: viewer.domainId, owner_id: "stored-owner",
  } as Awaited<ReturnType<typeof assistantStore.agent>>));
  const agents = [custom, RETRIEVAL_AGENT_ID, denied, invalid];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const primaryKey of agents) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecordList" }, params: {},
      selection: { typeId: AGENT_DEFINITION, method: "grantRows", primaryKey },
    });
  }
  const view = { policyId: "support", name: "Support", level: "VIEW" };
  const edit = { policyId: "editors", name: "Editors", level: "EDIT" };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: { shared: true, grants: [view] } },
    { status: "ready", payload: { shared: false, grants: [edit] } },
    { status: "forbidden", error: "Agent EDIT required" },
    { status: "ready", payload: { shared: true } },
  ] });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, agents.map(() => request));
    expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
      { status: "ready", value: [
        { primaryKey: view.policyId, fields: { policyId: view.policyId, level: "view", revocable: true } },
        { primaryKey: "domain", fields: { level: "use", revocable: false } },
      ] },
      { status: "ready", value: [
        { primaryKey: edit.policyId, fields: { policyId: edit.policyId, level: "edit", revocable: true } },
      ] },
      { status: "forbidden", reason: "Agent EDIT required" },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    ]);
    const reads: JavaPanelRead[] = mocks.read.mock.lastCall![1];
    expect(reads.map(read => read.call)).toEqual(agents.map(primaryKey => ({
      type: AGENT_DEFINITION, name: "grantRows",
      parameters: { primaryKey, ...(primaryKey !== RETRIEVAL_AGENT_ID && { ownerId: "stored-owner" }) },
    })));
    expect(stored.mock.calls).toEqual([custom, denied, invalid].map(id => [id, viewer]));
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    stored.mockRestore();
  }
});

it.each([0, 1])("adds the retriever count %i to the visible Workbench definitions in the same batch", async retrievers => {
  const { assistantStore } = await import("../../assistant/store");
  const localCount = vi.spyOn(assistantStore, "countVisibleAgentDefinitions").mockResolvedValue(2);
  const view = { fixed: false, all: false, authorId: null, objectIds: ["visible-agent"] };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockResolvedValueOnce({ declaration: { result: "panelRecordQuery" }, params: {},
    selection: { typeId: AGENT_DEFINITION, method: "count" } });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: retrievers, visibility: { AGENT: { VIEW: view } } },
  ] });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, [request]);
    expect(localCount).not.toHaveBeenCalled();
    expect(await runPreparedDataReads(credentials, prepared)).toEqual([
      { status: "ready", value: { rows: [], total: 2 + retrievers } },
    ]);
    expect(mocks.read.mock.lastCall?.[1]).toMatchObject([{
      call: { type: AGENT_DEFINITION, name: "count", parameters: {} },
      visibleKinds: [{ kind: "AGENT", verbs: ["VIEW"] }],
    }]);
    expect(localCount).toHaveBeenCalledWith(viewer.domainId, view, { includeSystem: true });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    localCount.mockRestore();
  }
});

it("counts Node-owned components only using the second call's visibility range", async () => {
  const range = { fixed: false, all: false, objectIds: ["domain-component-one"], authorId: null };
  const ready = { status: "ready" as const, value: { rows: [], total: 2 } };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockResolvedValueOnce({ declaration: { result: "panelRecordQuery" }, params: {}, selection: { typeId: SDK_COMPONENT, method: "count" } });
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "ready", visibility: { COMPONENT: { USE: range } } }] });
  mocks.components.mockResolvedValueOnce(ready.value);
  const prepared = await prepareRegisteredDataReads(credentials, [request]);
  expect(mocks.components).not.toHaveBeenCalled();
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([ready]);
  expect(mocks.read.mock.lastCall?.[1][0]).toMatchObject({ visibleKinds: [{ kind: "COMPONENT", verbs: ["USE"] }] });
  expect(mocks.read.mock.lastCall?.[1][0]).not.toHaveProperty("call");
  expect(mocks.components).toHaveBeenCalledWith(viewer.domainId, range);
});

it("counts the P1 skill library behind the Java read gate without locating sources", async () => {
  const value = { rows: [], total: 2 };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockResolvedValueOnce({ declaration: { result: "panelRecordQuery" }, params: {}, selection: { typeId: SKILL, method: "count" } });
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "ready", payload: true }] });
  mocks.skills.mockResolvedValueOnce({ registry: { getSkills: () => [{}, {}] } });
  const prepared = await prepareRegisteredDataReads(credentials, [request]);
  expect(mocks.skills).not.toHaveBeenCalled();
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([{ status: "ready", value }]);
  expect(mocks.read.mock.lastCall?.[1][0]).toMatchObject({ call: { type: SKILL, name: "count", parameters: {} } });
  expect(mocks.skills).toHaveBeenCalledWith(viewer.domainId, credentials);
});

it("separately admits the content and frame skill library reads without opening a refused directory", async () => {
  const frame = { ...request, source: { ...source, kind: "frame" as const } };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }, { kind: "ready", entry }] });
  for (const read of [request, frame]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecordQuery" }, params: {}, selection: { typeId: SKILL, method: "query" },
    });
  }
  mocks.skills.mockResolvedValueOnce({ registry: { getSkills: () => [] } });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: true }, { status: "forbidden", error: "Skill library denied" },
  ] });
  const prepared = await prepareRegisteredDataReads(credentials, [request, frame]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: { rows: [], total: 0 } }, { status: "forbidden", reason: "Skill library denied" },
  ]);
  expect(mocks.locate).toHaveBeenLastCalledWith([entryRef, { ...entryRef, kind: "frame" }], credentials);
  expect(mocks.read.mock.lastCall?.[1].map((item: { call?: unknown }) => item.call)).toEqual([
    { type: SKILL, name: "count", parameters: {} }, { type: SKILL, name: "count", parameters: {} },
  ]);
  expect(mocks.skills).toHaveBeenCalledTimes(1);
});

it("uses the P1 skill editor decision for a draft and the stored agent before reading the picker", async () => {
  const agentId = "11111111-1111-4111-8111-111111111111";
  const agent = vi.spyOn(await import("../../assistant/definitions"), "readAgentDefinitionRow").mockResolvedValue({
    id: agentId, domain_id: viewer.domainId, owner_id: "stored-agent-author",
  } as Awaited<ReturnType<typeof import("../../assistant/definitions").readAgentDefinitionRow>>);
  const selected = { namespace: { kind: "domain" as const, domainId: viewer.domainId }, name: "stored-skill" };
  const unavailable = { namespace: { kind: "provider" as const, provider: "product-panels" }, name: "retired-page" };
  const catalog = vi.spyOn(await import("../../assistant/skills"), "assistantSkillCatalog")
    .mockResolvedValue({ skills: [{ skill: selected, title: "Stored skill", description: "Library entry" }] });
  try {
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
    for (const [method, agentTarget] of [["options", "draft"], ["options", agentId], ["resolve", agentId]]) {
      mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
      mocks.prepare.mockResolvedValueOnce({
        declaration: { result: "panelOptionList" }, selection: { typeId: SKILL, method },
        params: { agentTarget, values: [unavailable, selected], ownerFacts: { ownerId: "browser" } },
      });
    }
    mocks.read.mockResolvedValueOnce({ viewer, results: [
      { status: "ready", payload: { allowed: true } },
      { status: "ready", payload: { allowed: false, code: "OBJECT_FORBIDDEN", reason: "Agent edit denied" } },
      { status: "ready", payload: { allowed: true } },
    ] });
    const plan = await prepareRegisteredDataReads(credentials, [request, request, request]);
    expect(catalog).not.toHaveBeenCalled();
    expect(await runPreparedDataReads(credentials, plan)).toMatchObject([
      { status: "ready", value: { options: [{ value: selected }] } },
      { status: "forbidden", reason: "Agent edit denied" },
      { status: "ready", value: { options: [{ value: unavailable, unavailable: expect.anything() }, { value: selected }] } },
    ]);
    const stored = {
      agentTarget: agentId, target: { kind: "AGENT", id: agentId, domainId: viewer.domainId },
      ownerFacts: { ownerId: "stored-agent-author", state: "PUBLISHED" },
    };
    expect(mocks.read.mock.lastCall?.[1].map(({ call }: JavaPanelRead) => call)).toEqual(
      [{ agentTarget: "draft" }, stored, stored].map(parameters => ({ type: SKILL, name: "editorAccess", parameters })),
    );
    expect(agent).toHaveBeenCalledWith(agentId, viewer);
    expect(catalog).toHaveBeenCalledTimes(2);
  } finally {
    agent.mockRestore();
    catalog.mockRestore();
  }
});

it("keeps four skill library reads and describes fixed and row deletion from the same library facts", async () => {
  const fixed: RegisteredDataRead = { source, memberPath: [{ member: "remove" }], operations: true, inputs: {} };
  const remove = { operation: { kind: "PlatformOperation", id: DELETE_SKILL } };
  const exportOperation = { operation: { kind: "PlatformOperation", id: EXPORT_SKILL } };
  const fixedProjection = { inputs: {}, data: {}, operations: {
    remove: { ...remove, target: { literal: { className: SKILL, primaryKey: "knowledge-governance" } } },
    export: { ...exportOperation, target: { literal: { className: SKILL, primaryKey: "knowledge-governance" } } },
  } };
  const queryProjection = { inputs: {}, data: { rows: { source: { type: { kind: "PlatformObjectType", id: SKILL } }, read: "query" } }, operations: {
    remove: { ...remove, target: { row: true } },
    export: { ...exportOperation, target: { row: true } },
  } };
  const readonlySkill = {
    skill: { name: "knowledge-governance", namespace: { kind: "provider", provider: "ontology" } },
    source: { kind: "generated" }, manifest: { description: "Generated package" },
  };
  const domainSkill = {
    skill: { name: "local", namespace: { kind: "domain", domainId: viewer.domainId } },
    source: { kind: "domain", path: "/fixture/local" }, manifest: { description: "Domain package" },
    provide: vi.fn().mockResolvedValue({ files: [{ path: "SKILL.md", content: "Skill instructions" }] }),
  };
  const catalogue = {
    registry: {
      getSkills: () => [readonlySkill, domainSkill],
      getSkillById: (id: string) => id === "knowledge-governance" ? readonlySkill : domainSkill,
    },
    requireSkillById: () => domainSkill,
  };
  const revoked = { allowed: false, code: "MANAGEMENT_FORBIDDEN", reason: "CHANGE required" };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const method of ["query", "record", "files", "file", "query"]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: method === "query" ? queryProjection : {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: method === "query" ? "panelRecordQuery" : method === "files" ? "panelRecordList" : "panelRecord" },
      params: method === "file" ? { path: "SKILL.md" } : {}, inputs: {}, selection: { typeId: SKILL, method, primaryKey: "local" },
    });
  }
  for (let index = 0; index < 2; index++)
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, member: {}, projection: fixedProjection });
  mocks.skills.mockResolvedValue(catalogue);
  // Each library read passes the library gate; delete's change decision joins the batch once per page.
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: true }, { status: "ready", payload: { allowed: true } },
    { status: "ready", payload: true },
    { status: "ready", payload: true },
    { status: "ready", payload: true },
    { status: "ready", payload: true }, { status: "ready", payload: revoked },
    { status: "ready", payload: { allowed: true } },
    { status: "ready", payload: revoked },
  ] });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, [request, request, request, request, request, fixed, fixed]);
    expect(mocks.skills).not.toHaveBeenCalled();
    const output = await runPreparedDataReads(credentials, prepared);
    const readOnly = tForLocale("en", "panels.skill.readOnlyPublic");
    const noExport = tForLocale("en", "panels.skill.generatedExportUnavailable");
    const key = (id: string) => `${SKILL}:${id}`;
    expect(output).toMatchObject([
      { status: "ready", value: { total: 2 }, rowOperations: {
        [key("knowledge-governance")]: {
          export: { available: false, unavailable: { reason: noExport } },
          remove: { available: false, unavailable: { reason: readOnly } },
        },
        [key("local")]: { export: { available: true }, remove: { available: true } },
      } },
      { status: "ready", value: { primaryKey: "local" } },
      { status: "ready", value: [{ primaryKey: "SKILL.md" }] },
      { status: "ready", value: { fields: { content: "Skill instructions" } } },
      { status: "ready", value: { total: 2 }, rowOperations: {
        [key("knowledge-governance")]: { export: { available: false, unavailable: { reason: noExport } } },
        [key("local")]: { export: { available: true }, remove: { available: false, unavailable: { reason: "CHANGE required" } } },
      } },
      { status: "ready", value: {
        export: { unavailable: { reason: noExport } },
        remove: { unavailable: { reason: readOnly } },
      } },
      { status: "ready", value: { remove: { unavailable: { reason: "CHANGE required" } } } },
    ]);
    expect(mocks.read.mock.lastCall?.[1].map(({ call }: JavaPanelRead) => call?.name)).toEqual([
      "count", "deleteAccess", "count", "count", "count", "count", "deleteAccess", "deleteAccess", "deleteAccess",
    ]);
    // The library view is read for presenting and, when the change is allowed, for each delete's write restriction.
    expect(mocks.skills).toHaveBeenCalledTimes(7);
  } finally {
    mocks.skills.mockReset();
  }
});

it("reads personal dashboards only after each placement passes and isolates missing records", async () => {
  const summary = { id: "board", name: "My board", createdAt: 0, updatedAt: 0 };
  const detail = {
    ...summary, ownerId: viewer.userId,
    groups: [{ id: "results", title: "Results", charts: [], metrics: [
      { id: "sales", name: "Sales", valueField: "value", query: { metricId: "metric", parameters: {} } },
    ] }],
  };
  mocks.dashboards.mockResolvedValueOnce([summary]);
  mocks.dashboard.mockImplementation(async (_userId, _domainId, id) => {
    if (id === "board") return detail;
    if (id === "blank") return { ...detail, id, groups: [] };
    return null;
  });
  mocks.favoriteKeys.mockResolvedValue(new Set([
    JSON.stringify([DASHBOARD, "board"]), JSON.stringify([DASHBOARD_CARD, "board/sales"]),
  ]));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const cases = [
    { selection: { typeId: DASHBOARD, method: "list" }, result: "panelRecordList" },
    { selection: { typeId: DASHBOARD, method: "record", primaryKey: "missing" }, result: "panelRecord" },
    { selection: { typeId: DASHBOARD_CARD, method: "record", primaryKey: "denied/sales" }, result: "panelRecord" },
    { selection: { typeId: DASHBOARD, method: "cards", primaryKey: "blank" }, result: "panelRecordList" },
    { selection: { typeId: DASHBOARD_CARD, method: "record", primaryKey: "board/missing" }, result: "panelRecord" },
    { selection: { typeId: DASHBOARD, method: "cards", primaryKey: "board" }, result: "panelRecordList" },
    { selection: { typeId: DASHBOARD_CARD, method: "record", primaryKey: "board/sales" }, result: "panelRecord" },
    { selection: { typeId: DASHBOARD, method: "record", primaryKey: "board" }, result: "panelRecord" },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { selection, result } of cases) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
      collectUse("panel", { id: entry.use.panelId, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: {}, projection: {} };
    });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params: {}, selection });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(mocks.dashboards).not.toHaveBeenCalled();
    expect(mocks.dashboard).not.toHaveBeenCalled();
    expect(mocks.favoriteKeys).not.toHaveBeenCalled();
    return { viewer, results: cases.map((_, index) => index === 2
      ? { status: "forbidden", error: "Owner denied placement" } : { status: "ready" }) };
  });

  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
  const card = {
    primaryKey: "board/sales", className: DASHBOARD_CARD, label: "Sales",
    outputs: { favorited: true, openPath: "/dashboards?dashboardId=board&cardId=sales" },
  };
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: [{ primaryKey: "board", fieldLabels: { name: "Dashboard name" }, outputs: { favorited: true } }] },
    { status: "error", message: "Dashboard not found" },
    { status: "forbidden", reason: "Owner denied placement" },
    { status: "empty" },
    { status: "error", message: "Dashboard card not found", code: "NOT_FOUND" },
    { status: "ready", value: [card] },
    { status: "ready", value: card },
    { status: "ready", value: { primaryKey: "board", outputs: { groupCount: 1, cardCount: 1, favorited: true } } },
  ]);

  const placedRead = {
    source, registration: { panelId: entry.use.panelId, framePanelId: entry.framePanelId, inputs: entry.use.inputs },
    uses: [{ target: { kind: "PANEL", id: entry.use.panelId, domainId: viewer.domainId }, ownerFacts: { ownerId: "author", state: "PUBLISHED" } }],
  };
  expect(mocks.read).toHaveBeenLastCalledWith(viewer, cases.map(() => placedRead), credentials);
  expect(mocks.dashboards).toHaveBeenCalledWith(viewer.userId, viewer.domainId);
  expect(mocks.dashboard).toHaveBeenCalledWith(viewer.userId, viewer.domainId, "board", undefined);
  expect(mocks.dashboard).not.toHaveBeenCalledWith(viewer.userId, viewer.domainId, "denied", undefined);
  expect(mocks.favoriteKeys).toHaveBeenCalledWith(viewer);
  expect(fetch).not.toHaveBeenCalled();
});

it("presents an owned card's saved metric facts in one batch and keeps refusal distinct from unavailability", async () => {
  const detail = {
    id: "board", ownerId: viewer.userId,
    groups: [{ charts: [], metrics: [
      { id: "sales", name: "Sales", query: { metricId: "stored-metric", parameters: { region: "APAC" } } },
    ] }],
  };
  const selected = { typeId: DASHBOARD_CARD, primaryKey: "board/sales" };
  const form = {
    declaration: { result: "panelFormDescription" },
    params: { values: { region: "EMEA", tenant: "typed", metricId: "submitted-metric" }, changedField: "/region" },
    selection: { ...selected, method: "form" },
  };
  const metricSource = { declaration: { result: "panelRecord" }, params: {}, selection: { ...selected, method: "metricSource" } };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  const inputs = [form, metricSource, metricSource, metricSource,
    { ...metricSource, selection: { ...metricSource.selection, primaryKey: "other/sales" } }];
  for (const [index, prepared] of inputs.entries()) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
      collectUse("panel", { id: entry.use.panelId, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: {}, projection: {} };
    });
    mocks.prepare.mockResolvedValueOnce(prepared);
    mocks.dashboard.mockResolvedValueOnce(index === inputs.length - 1
      ? { ...detail, id: "other", ownerId: "another-owner" } : detail);
  }

  const textField = { type: "text", required: false, help: null, defaultValue: null, multiline: false, placeholder: null, maxLength: 50 };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: {
      revision: "revision-7",
      fields: [{ ...textField, key: "region", label: "Region" }, { ...textField, key: "tenant", label: "Tenant" }],
      values: { region: "APAC", tenant: "saved" }, readOnly: ["tenant"],
    } },
    { status: "ready", payload: { status: "available", metric: {
      id: "stored-metric", revision: "revision-7", name: "Sales total", status: "PUBLISHED", parameterDefs: [], outputColumns: [],
    } } },
    { status: "ready", payload: { status: "unavailable" } },
    { status: "forbidden", error: "Query access denied" },
    { status: "forbidden", error: "Placement denied" },
  ] });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const prepared = await prepareRegisteredDataReads(credentials, inputs.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: {
      fields: [{ path: "/region", readOnly: false }, { path: "/tenant", readOnly: true }],
      values: { region: "EMEA", tenant: "saved" }, revision: "revision-7", errors: [],
      save: { method: "POST", path: "/api/dashboards/save-card-parameters" },
    } },
    { status: "ready", value: {
      fields: { metric: { className: METRIC_VIEW, primaryKey: "stored-metric", label: "Sales total" }, parameters: { value: { region: "APAC" } } },
      tones: { status: "success" },
    } },
    { status: "ready", value: { fields: { metric: { label: "stored-metric" } }, tones: { status: "danger" } } },
    { status: "forbidden", reason: "Query access denied" },
    { status: "forbidden", reason: "Placement denied" },
  ]);
  expect(mocks.dashboard).toHaveBeenCalledWith(viewer.userId, viewer.domainId, "board", undefined);
  expect(mocks.dashboard).toHaveBeenLastCalledWith(viewer.userId, viewer.domainId, "other", undefined);
  const calls = mocks.read.mock.lastCall![1].map(({ call }: { call?: unknown }) => call);
  const describe = { type: METRIC_VIEW, name: "describe", parameters: { primaryKey: "stored-metric" } };
  expect(calls).toEqual([
    { type: METRIC_VIEW, name: "parameterForm", parameters: { primaryKey: "stored-metric", parameters: { region: "APAC" } } },
    describe, describe, describe, undefined,
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("presents registered model settings from masked owner facts while keeping drafts in Node", async () => {
  const connection = { provider: "openai", apiKey: "******1234" };
  const settings = {
    connections: { primary: connection },
    models: { chat: { connection: "primary", model: "upstream-chat", type: "chat" } },
    defaultModel: "chat", embeddingModel: null,
  };
  const connectionTarget = { typeId: MODEL_CONNECTION, primaryKey: "primary" };
  const modelTarget = { typeId: MODEL_ENTRY, primaryKey: "chat" };
  const inputs = [
    { selection: { typeId: MODEL_CONNECTION, method: "list" }, result: "panelRecordList" },
    { selection: { ...connectionTarget, method: "record" }, result: "panelRecord" },
    { selection: { ...connectionTarget, method: "form" }, result: "panelFormDescription", values: { name: "renamed" } },
    { selection: { typeId: MODEL_CONNECTION, method: "createForm" }, result: "panelFormDescription", values: { provider: "azure" } },
    { selection: { ...connectionTarget, method: "createModelForm" }, result: "panelFormDescription", values: { type: "embedding" } },
    { selection: { ...connectionTarget, method: "models" }, result: "panelRecordList" },
    { selection: { ...modelTarget, method: "record" }, result: "panelRecord" },
    { selection: { ...modelTarget, method: "form" }, result: "panelFormDescription", values: { model: "draft-upstream" } },
    { selection: { ...modelTarget, method: "record", primaryKey: "missing" }, result: "panelRecord" },
    { selection: { ...connectionTarget, method: "form" }, result: "panelFormDescription" },
    { selection: { ...connectionTarget, method: "form" }, result: "panelFormDescription" },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { selection, result, values } of inputs) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
      collectUse("panel", { id: entry.use.panelId, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: {}, projection: {} };
    });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, selection, params: values ? { values } : {} });
  }
  const ready = { status: "ready", payload: settings };
  const unmasked = "synthetic-unmasked-key";
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ...inputs.slice(0, 9).map(() => ready),
    { status: "forbidden", error: "Model settings read denied" },
    { status: "ready", payload: { ...settings, connections: { primary: { ...connection, apiKey: unmasked } } } },
  ] });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const prepared = await prepareRegisteredDataReads(credentials, inputs.map(() => request));
  const outcomes = await runPreparedDataReads(credentials, prepared);
  expect(outcomes).toMatchObject([
    { status: "ready", value: [{ primaryKey: "primary", fields: { status: "ready" } }] },
    { status: "ready", value: { primaryKey: "primary", outputs: { modelCount: 1 } } },
    { status: "ready", value: { values: { name: "primary", apiKey: "" },
      fields: expect.arrayContaining([expect.objectContaining({ path: "/name", readOnly: true })]) } },
    { status: "ready", value: { values: { provider: "azure" },
      errors: expect.arrayContaining([expect.objectContaining({ field: "/apiBase", code: "required" })]) } },
    { status: "ready", value: { values: { type: "embedding" } } },
    { status: "ready", value: [{ primaryKey: "chat", fields: { nameParts: ["chat", "upstream-chat", "Default chat"] } }] },
    { status: "ready", value: { primaryKey: "chat", fields: { connection: "primary", upstreamModel: "upstream-chat" } } },
    { status: "ready", value: { values: { name: "chat", model: "draft-upstream" } } },
    { status: "error", code: "NOT_FOUND" },
    { status: "forbidden", reason: "Model settings read denied" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
  ]);
  expect(JSON.stringify(outcomes)).not.toContain(connection.apiKey);
  expect(JSON.stringify(outcomes)).not.toContain(unmasked);
  expect(mocks.read.mock.lastCall![1]).toMatchObject(inputs.map(() => ({
    uses: [{ target: { id: entry.use.panelId } }],
    call: { type: MODEL_CONNECTION, name: "settings", parameters: {} },
  })));
  for (const read of mocks.read.mock.lastCall![1]) expect(read.call.parameters).toEqual({});
  expect(fetch).not.toHaveBeenCalled();
});

it("presents model usages and the usage draft from both authorized settings facts", async () => {
  const apiKey = "******1234";
  const agentId = "a723a336-5953-44c9-aace-6c1d81e50812";
  const settings = {
    connections: { primary: { provider: "openai", apiKey } },
    models: {
      chat: { connection: "primary", model: "upstream-chat", type: "chat" },
      embed: { connection: "primary", model: "upstream-embed", type: "embedding", dimensions: 1024 },
    },
    defaultModel: "chat", embeddingModel: "embed",
  };
  const facts = { settings, agentModels: { agents: [
    { id: agentId, kind: "quality", name: "Quality", modelSelection: { modelId: "chat" } },
  ] } };
  const usages = { typeId: MODEL_CONNECTION, method: "usages", primaryKey: "primary" };
  const form = { typeId: MODEL_USAGE, method: "form", primaryKey: "domain" };
  const values = { defaultModel: "@none", taskModels: { quality: "@default" } };
  const inputs = [
    { selection: usages, result: "panelRecordList" },
    { selection: form, result: "panelFormDescription", params: { values } },
    { selection: { ...usages, primaryKey: "missing" }, result: "panelRecordList" },
    { selection: { ...form, primaryKey: "wrong-domain-key" }, result: "panelFormDescription" },
    { selection: form, result: "panelFormDescription" },
    { selection: usages, result: "panelRecordList" },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { selection, result, params } of inputs) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
      collectUse("panel", { id: entry.use.panelId, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: {}, projection: {} };
    });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, selection, params: params ?? {} });
  }
  const ready = { status: "ready", payload: facts };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ready, ready, ready, { status: "ready" },
    { status: "forbidden", error: "Agent model selections denied" },
    { status: "ready", payload: { settings } },
  ] });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const prepared = await prepareRegisteredDataReads(credentials, inputs.map(() => request));
  const outcomes = await runPreparedDataReads(credentials, prepared);
  expect(outcomes).toMatchObject([
    { status: "ready", value: [
      { primaryKey: "default:chat", fields: { model: "chat" } },
      { primaryKey: "embedding:embed", fields: { model: "embed" } },
      { primaryKey: `agent:${agentId}`, fields: { model: "chat" } },
    ] },
    { status: "ready", value: {
      values, errors: [],
      fields: expect.arrayContaining([expect.objectContaining({ path: "/taskModels/quality" })]),
    } },
    { status: "error", code: "NOT_FOUND" },
    { status: "error", code: "NOT_FOUND" },
    { status: "forbidden", reason: "Agent model selections denied" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
  ]);
  expect(JSON.stringify(outcomes)).not.toContain(apiKey);
  const calls = mocks.read.mock.lastCall![1].map(({ call }: { call?: unknown }) => call);
  const combined = { type: MODEL_USAGE, name: "settingsAndAgents", parameters: {} };
  expect(calls).toEqual([combined, combined, combined, undefined, combined, combined]);
  expect(fetch).not.toHaveBeenCalled();
});

it("reads vector status in the second batch and shares the existing rebuild flags", async () => {
  const payload = { configured: true, state: "RUNNING", total: 8, done: 3, error: null };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const status = {
    fields: { progress: "3 / 8" },
    outputs: { state: "RUNNING", alive: true, canPause: true, canRebuild: false, canResume: false },
  };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecord" }, params: {},
    selection: { typeId: MODEL_USAGE, method: "vectorRebuild", primaryKey: "domain" },
  });
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "ready", payload }] });

  const prepared = await prepareRegisteredDataReads(credentials, [request]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([{ status: "ready", value: status }]);
  expect(mocks.read.mock.lastCall?.[1]).toEqual([
    expect.objectContaining({ call: { type: MODEL_USAGE, name: "vectorRebuild", parameters: {} } }),
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("reads favorites and sessions with compiled parameters and only contacts Runtime for session status", async () => {
  const sessionId = "71c64809-51c3-4976-9877-5713b57b4372";
  const agentId = "a723a316-5953-44c9-aace-6c1d81e50812";
  const runId = "df964cc3-ce53-4d07-b554-acba37452f21";
  const updatedAt = "2026-11-26T00:00:00.000Z";
  mocks.favoriteState.mockResolvedValue({ dashboardIds: ["followed"], dashboardCards: { followed: ["sales"] }, pinnedObjects: [] });
  mocks.dashboard.mockResolvedValueOnce({
    id: "followed", ownerId: viewer.userId, name: "My board",
    groups: [{ charts: [], metrics: [{ id: "sales", name: "Sales" }] }],
  });
  mocks.isFavorite.mockResolvedValue(true);
  mocks.favoriteKeys.mockResolvedValue(new Set([JSON.stringify([AGENT_SESSION, sessionId])]));
  mocks.sessions.mockResolvedValueOnce([{ sessionId, agentId, agentName: "Planner", title: "Plan", updatedAt }]);
  mocks.session.mockResolvedValueOnce({ id: sessionId, agent_id: agentId, title: "Plan", updated_at: new Date(updatedAt) });

  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "fixture-runtime-token");
  vi.stubEnv("AGENT_RUNTIME_URL", "http://runtime.test");
  const fetch = vi.fn(async (url: string, request: NonNullable<Parameters<typeof globalThis.fetch>[1]>) => {
    expect(url).toBe("http://runtime.test/v1/sessions/status");
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      "x-domain-id": viewer.domainId, "x-ontomato-user-id": viewer.userId, "x-workspace-owner-id": viewer.userId,
    });
    expect(JSON.parse(request.body as string)).toEqual({ sessionIds: [sessionId] });
    return Response.json({ sessions: [{
      session: { id: sessionId, domainId: viewer.domainId, activeRunId: runId, latestRunId: runId, createdAt: updatedAt, updatedAt },
      latestRun: { id: runId, status: "running", stopReason: null },
    }] });
  });
  vi.stubGlobal("fetch", fetch);

  const sessionParams = { search: "Plan", limit: 1, agentKind: "analysis", agentId };
  const cases = [
    { typeId: FAVORITE, method: "status", params: { object: { className: DASHBOARD, primaryKey: "followed" } }, result: "panelRecord" },
    { typeId: FAVORITE, method: "dashboardCardsStatus", params: {}, result: "panelRecord" },
    { typeId: FAVORITE, method: "status", params: {}, result: "panelRecord" },
    { typeId: AGENT_SESSION, method: "list", params: sessionParams, result: "panelRecordList" },
    { typeId: AGENT_SESSION, method: "record", primaryKey: sessionId, params: {}, result: "panelRecord" },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { params, result, ...selection } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(() => ({ status: "ready" })) });

  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: { outputs: { favorited: true, className: DASHBOARD, primaryKey: "followed" } } },
    { status: "ready", value: { outputs: { metricCount: 1, chartCount: 0, missingCount: 0 } } },
    { status: "error", code: "INVALID_REQUEST" },
    { status: "ready", value: [{ primaryKey: sessionId, fields: { running: true, favorite: true } }] },
    { status: "ready", value: { primaryKey: sessionId, fields: { running: true, favorite: true } } },
  ]);
  for (const read of mocks.read.mock.lastCall![1]) {
    expect(read).not.toHaveProperty("call");
    expect(read).not.toHaveProperty("visibleKinds");
  }
  expect(mocks.favoriteState).toHaveBeenCalledWith(viewer);
  expect(mocks.isFavorite).toHaveBeenCalledWith(viewer, DASHBOARD, "followed");
  expect(mocks.sessions).toHaveBeenCalledWith(viewer, sessionParams);
  expect(mocks.session).toHaveBeenCalledWith(sessionId, viewer);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("reads OpsKnowledge files only with the second batch item's management approval", async () => {
  const { KnowledgeNotFoundError, KnowledgePathError } = await import("../../../platform/diagnosis/observe/agent/knowledge-store");
  const file = { path: "guide.md", title: "Guide", content: "# Guide", updatedAt: "2026-11-26T00:00:00.000Z" };
  mocks.knowledgeTree.mockReturnValue({ type: "directory", children: [{ type: "file", path: file.path, name: "guide.md" }] });
  mocks.knowledgeFile.mockImplementation(path => {
    if (path === "missing.md") throw new KnowledgeNotFoundError("Knowledge file not found");
    if (path === "../guide.md") throw new KnowledgePathError("Path is outside knowledge root");
    return file;
  });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const allowed = { status: "ready", payload: workbenchManagement.opsKnowledgeRead.id };
  const cases = [
    { method: "files", params: {}, result: "panelRecordList", response: { status: "forbidden", error: "Permission denied" } },
    { method: "record", params: { path: "unapproved.md" }, result: "panelRecord", response: { status: "ready" } },
    { method: "record", params: { path: "missing.md" }, result: "panelRecord", response: allowed },
    { method: "record", params: { path: "../guide.md" }, result: "panelRecord", response: allowed },
    { method: "files", params: {}, result: "panelRecordList", response: allowed },
    { method: "record", params: { path: file.path }, result: "panelRecord", response: allowed },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { method, params, result } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection: { typeId: OPS_KNOWLEDGE, method } });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(mocks.knowledgeTree).not.toHaveBeenCalled();
    expect(mocks.knowledgeFile).not.toHaveBeenCalled();
    return { viewer, results: cases.map(({ response }) => response) };
  });

  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "forbidden", reason: "Permission denied" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    { status: "error", message: "Knowledge file not found" },
    { status: "error", message: "Path is outside knowledge root" },
    { status: "ready", value: [{ primaryKey: file.path, fieldLabels: { path: "Path" } }] },
    { status: "ready", value: { primaryKey: file.path, fields: { content: "# Guide" } } },
  ]);
  expect(mocks.read.mock.lastCall?.[1].map((read: { call: unknown }) => read.call)).toEqual(
    cases.map(({ method, params }) => ({ type: OPS_KNOWLEDGE, name: method, parameters: params })),
  );
  expect(mocks.knowledgeTree).toHaveBeenCalledTimes(1);
  expect(mocks.knowledgeFile).not.toHaveBeenCalledWith("unapproved.md");
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps feedback reads within the verified domain and requires the feedback batch approval", async () => {
  const postgres = await import("../../../infrastructure/postgres");
  const { RuntimeClient } = await import("../../../infrastructure/agent-runtime/client");
  const feedbackId = "11111111-1111-4111-8111-111111111111";
  const missingId = "22222222-2222-4222-8222-222222222222";
  const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const targetId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const updatedAt = "2026-11-26T00:00:00.000Z";
  const input = `Line one
   ${"a".repeat(90)}`;
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    expect(sql).toContain("WHERE s.domain_id=$1");
    expect(values[0]).toBe(viewer.domainId);
    if (sql.includes(" GROUP BY ")) return { rows: [{ key: "qa", count: "2" }] };
    if (values[8] === missingId) return { rows: [] };
    return { rows: [{
      id: feedbackId, session_id: sessionId, run_id: runId, target_id: targetId,
      rating: "like", text: "Helpful", updated_at: updatedAt, owner_id: "author",
      domain_id: viewer.domainId, kind: "regular", request_seq: 4, total: 3,
    }] };
  });
  const pool = vi.spyOn(postgres, "getPostgresPool")
    .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);
  const runtime = vi.spyOn(RuntimeClient.prototype, "run").mockImplementation(async function (this: InstanceType<typeof RuntimeClient>) {
    expect(this.domainId).toBe(viewer.domainId);
    return { messages: [
      { id: "input", message: { role: "user", content: input } },
      { id: targetId, message: { role: "assistant", content: "Answer" } },
    ] } as Awaited<ReturnType<typeof RuntimeClient.prototype.run>>;
  });
  const fetch = vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
    expect(JSON.parse(String(init?.body))).toEqual({ kind: "member", ids: ["author"] });
    return new Response(JSON.stringify({ options: [{ id: "author", name: "Author Name", kind: "member" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);

  const approval = { status: "ready", payload: workbenchManagement.feedbackRead.id };
  const cases = [
    {
      method: "query", params: {}, result: "panelRecordQuery",
      response: { status: "forbidden", error: "Feedback read denied" },
    },
    {
      method: "counts", params: { by: "rating" }, result: "panelGroupCounts",
      response: { status: "ready", payload: workbenchManagement.feedbackExport.id },
    },
    { method: "record", primaryKey: "invalid", params: {}, result: "panelRecord", response: approval },
    { method: "record", primaryKey: missingId, params: {}, result: "panelRecord", response: approval },
    {
      method: "query", params: { search: "Helpful", page: { number: 2, size: 1 }, sourceType: "qa", rating: "like" },
      result: "panelRecordQuery", response: approval,
    },
    {
      method: "counts", params: { by: "sourceType", sourceType: "analysis_task", rating: "like" },
      result: "panelGroupCounts", response: approval,
    },
    { method: "record", primaryKey: feedbackId, params: {}, result: "panelRecord", response: approval },
  ];
  try {
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
    for (const { params, result, response: _response, ...selection } of cases) {
      mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
      mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection: { typeId: FEEDBACK_RECORD, ...selection } });
    }
    mocks.read.mockImplementationOnce(async () => {
      expect(query).not.toHaveBeenCalled();
      expect(runtime).not.toHaveBeenCalled();
      return { viewer, results: cases.map(({ response }) => response) };
    });

    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    const replies = await runPreparedDataReads(credentials, prepared);
    expect(replies).toMatchObject([
      { status: "forbidden", reason: "Feedback read denied" },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID", message: "Invalid feedback read approval" },
      { status: "error", code: "INVALID_REQUEST" },
      { status: "error", code: "NOT_FOUND", message: "Feedback record not found" },
      { status: "ready", value: { rows: [{ primaryKey: feedbackId, fields: {
        userId: "Author Name", userInput: input, userInputPreview: `Line one ${"a".repeat(71)}…`,
      } }], nextCursor: "2", total: 3 } },
      { status: "ready", value: [{ key: "all", count: 2 }, { key: "qa", count: 2 }, { key: "analysis_task", count: 0 }] },
      { status: "ready", value: { primaryKey: feedbackId, fields: { userId: "Author Name", assistantOutput: "Answer" } } },
    ]);
    expect(query.mock.calls.map(([, parameters]) => parameters)).toEqual([
      [viewer.domainId, null, null, null, null, null, null, null, missingId],
      [viewer.domainId, null, "like", null, "Helpful", "qa", null, null, null, 1, 1],
      [viewer.domainId, null, "like", null, null, null, null, null, null],
      [viewer.domainId, null, null, null, null, null, null, null, feedbackId],
    ]);
    expect(runtime.mock.calls).toEqual([[runId], [runId]]);
    expect(mocks.read.mock.lastCall?.[1].map((read: { call: unknown }) => read.call)).toEqual(
      cases.map(({ method, primaryKey, params }) => ({
        type: FEEDBACK_RECORD, name: method, parameters: { ...params, ...(primaryKey !== undefined && { primaryKey }) },
      })),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    pool.mockRestore();
    runtime.mockRestore();
  }
});

it("uses the matching batch management approval for ops reads and preserves file errors and active refresh", async () => {
  const runtimeRoot = mkdtempSync(join(tmpdir(), "registered-ops-read-"));
  const layout = { publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] };
  const writeFixture = (relativePath: string, content: unknown) => {
    const file = join(runtimeRoot, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(content));
  };
  const turnKey = "turn.ops-thread.1";
  const runId = "run-101";
  const caseSetId = "cs1";
  const date = "2026-11-26T00:00:00.000Z";
  const run = {
    runId, domainId: viewer.domainId, caseSetId, caseSetName: "Smoke suite", status: "running",
    createdAt: date, updatedAt: date, summary: { total: 1, correct: 0, wrong: 0, abnormal: 0 },
  };
  installContentLayout({ ...layout, runtimeRoot });
  try {
    vi.stubEnv("OBSERVE_TRACE_WORKSPACE_ROOT", join(runtimeRoot, "turns"));
    vi.stubEnv("DIAGNOSIS_RETENTION_FILE", join(runtimeRoot, "retention.json"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    writeFixture("retention.json", { version: 1, kept: [] });
    writeFixture(`turns/${turnKey}/manifest.json`, { workspaceId: turnKey, turnKey, domainId: viewer.domainId, status: "ready" });
    writeFixture(`data/autotest/case-sets/${caseSetId}.json`, {
      id: caseSetId, domainId: viewer.domainId, name: "Smoke suite", createdAt: date, updatedAt: date, cases: [],
    });
    writeFixture(`data/autotest/runs/${runId}/run.json`, run);
    writeFixture(`data/autotest/runs/${runId}/results.json`, []);
    writeFixture(`data/autotest/runs/${runId}/c1/manifest.json`, { workspaceId: "c1", status: "ready" });
    writeFixture(`data/autotest/runs/${runId}/c1/trace.json`, { ok: true });
    mocks.getActiveRun.mockReturnValue(run);

    const { opsCaseSetsRead, opsTurnEvidenceRead, opsRunsRead } = workbenchManagement;
    const approved = (operation: { id: string }) => ({ status: "ready", payload: operation.id });
    const cases = [
      {
        typeId: AUTOTEST_CASE_SET, method: "record", primaryKey: caseSetId, params: {}, result: "panelRecord",
        response: { status: "forbidden", error: "You do not have permission for this management operation." },
      },
      {
        typeId: TURN_EVIDENCE, method: "record", primaryKey: turnKey, params: {},
        result: "panelRecord", response: approved(opsRunsRead),
      },
      {
        typeId: TURN_EVIDENCE, method: "file", primaryKey: turnKey, params: { path: "../trace.json" },
        result: "panelRecord", response: approved(opsTurnEvidenceRead),
      },
      {
        typeId: TURN_EVIDENCE, method: "file", primaryKey: turnKey, params: { path: "missing.json" },
        result: "panelRecord", response: approved(opsTurnEvidenceRead),
      },
      {
        typeId: AUTOTEST_CASE_SET, method: "form", primaryKey: caseSetId, params: { editMode: "json", values: { name: "Draft suite" } },
        result: "panelFormDescription", response: approved(opsCaseSetsRead),
      },
      {
        typeId: AUTOTEST_RUN, method: "results", primaryKey: runId, params: { verdict: "wrong" },
        result: "panelRecordList", response: approved(opsRunsRead),
      },
      {
        typeId: AUTOTEST_CASE_ARTIFACT, method: "file", primaryKey: `${runId}::c1`, params: { path: "trace.json" },
        result: "panelRecord", response: approved(opsRunsRead),
      },
    ];
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
    for (const { params, result, response: _response, ...selection } of cases) {
      mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
      mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection });
    }
    mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(({ response }) => response) });

    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
      { status: "forbidden", reason: "You do not have permission for this management operation." },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
      { status: "error", message: "Invalid file path" },
      { status: "error", message: "Artifact file not found" },
      { status: "ready", value: {
        values: { name: "Draft suite" }, fields: expect.arrayContaining([
          expect.objectContaining({ path: "/cases", control: expect.objectContaining({ kind: "code", language: "json" }) }),
        ]),
      } },
      { status: "ready", value: [], rereadAfterMs: 5000 },
      { status: "ready", value: { primaryKey: "trace.json", fields: { content: '{\n  "ok": true\n}' } } },
    ]);
    expect(mocks.read.mock.lastCall?.[1].map((read: { call: unknown }) => read.call)).toEqual(
      cases.map(({ typeId, method, primaryKey, params }) => ({ type: typeId, name: method, parameters: { ...params, primaryKey } })),
    );
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    mocks.getActiveRun.mockReset();
    installContentLayout({ ...layout, runtimeRoot: process.cwd() });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

it("renders the registered ops DSL draft only after its read approval, keeping the draft in Node", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const form = { ...request, dataName: "form" };
  const draft = '{"problem":"current draft"}';
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const values of [undefined, undefined, { dsl: draft }]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelFormDescription" }, params: { values, changedField: "/dsl" },
      selection: { typeId: DSL_QUERY, method: "form" },
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "forbidden", error: "DSL read denied" },
    { status: "ready", payload: workbenchManagement.opsDslExecute.id },
    { status: "ready", payload: workbenchManagement.opsDslRead.id },
  ] });
  const prepared = await prepareRegisteredDataReads(credentials, [form, form, form]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "forbidden", reason: "DSL read denied" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    { status: "ready", value: {
      values: { dsl: draft }, fields: [{ path: "/dsl", control: { kind: "code", language: "json" } }],
      save: { method: "POST", path: "/panel-operations/read" },
    } },
  ]);
  expect(mocks.read.mock.lastCall?.[1].map(({ call }: { call: unknown }) => call)).toEqual(
    Array.from({ length: 3 }, () => ({ type: DSL_QUERY, name: "form", parameters: {} })),
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("describes registered ops evidence buttons from the read gate and local evidence without writing retention", async () => {
  const runtimeRoot = mkdtempSync(join(tmpdir(), "registered-ops-buttons-"));
  const layout = { publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] };
  const retentionFile = join(runtimeRoot, "retention.json");
  const turn = "turn.current.1";
  const foreign = "turn.foreign.1";
  const run = "run-101";
  const busyRun = "run-102";
  const foreignRun = "run-103";
  const write = (relativePath: string, value: unknown) => {
    const file = join(runtimeRoot, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  const binding = (id: string) => ({ kind: "PlatformOperation", id });
  const selected = (type: string, primaryKey: string, operations: Record<string, string>) => {
    const port = { kind: "object", objectType: type };
    return {
      inputs: { selected: { className: type, primaryKey } },
      panel: { manifest: { state: { selected: { type: port } } } },
      member: { inputs: { selected: { state: "selected" } } },
      projection: { inputs: { selected: port }, operations: Object.fromEntries(Object.entries(operations).map(([name, id]) => [
        name, { operation: binding(id), target: { input: "selected" } },
      ])) },
    };
  };
  const turnButtons = { keep: KEEP_TURN_EVIDENCE, unkeep: UNKEEP_TURN_EVIDENCE, download: DOWNLOAD_TURN_EVIDENCE };
  const runButtons = { keep: KEEP_AUTOTEST_RUN, unkeep: UNKEEP_AUTOTEST_RUN, delete: DELETE_AUTOTEST_RUN };
  const caseButton = { download: DOWNLOAD_AUTOTEST_CASE_ARTIFACT };
  const opRequest: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("OBSERVE_TRACE_WORKSPACE_ROOT", join(runtimeRoot, "turns"));
  vi.stubEnv("DIAGNOSIS_RETENTION_FILE", retentionFile);
  installContentLayout({ ...layout, runtimeRoot });
  try {
    write(`turns/${turn}/manifest.json`, { workspaceId: turn, domainId: viewer.domainId, status: "ready" });
    write(`turns/${foreign}/manifest.json`, { workspaceId: foreign, domainId: "foreign-domain", evidence: {} });
    const runFile = (runId: string) => `data/autotest/runs/${runId}/run.json`;
    write(runFile(run), { runId: run, domainId: viewer.domainId, status: "completed", summary: {} });
    write(runFile(busyRun), { runId: busyRun, domainId: viewer.domainId, status: "running", summary: {} });
    write(runFile(foreignRun), { runId: foreignRun, domainId: "foreign-domain", status: "completed", summary: {} });
    write("retention.json", { version: 1, kept: [run, foreignRun].map(artifactId => ({ artifactId, artifactType: "autotest-run" })) });
    const retentionBefore = readFileSync(retentionFile, "utf-8");
    const busyBefore = readFileSync(join(runtimeRoot, runFile(busyRun)), "utf-8");
    write(`data/autotest/runs/${run}/ready/manifest.json`, { evidence: {} });
    const approval = (operation: { id: string }) => ({ status: "ready", payload: operation.id });
    const cases = [
      { placement: selected(TURN_EVIDENCE, turn, turnButtons), reply: approval(workbenchManagement.opsTurnEvidenceRead) },
      { placement: selected(TURN_EVIDENCE, foreign, turnButtons), reply: approval(workbenchManagement.opsTurnEvidenceRead) },
      { placement: selected(TURN_EVIDENCE, turn, turnButtons), reply: { status: "forbidden", error: "Evidence read denied" } },
      { placement: selected(AUTOTEST_CASE_ARTIFACT, `${run}::ready`, caseButton), reply: approval(workbenchManagement.opsRunsRead) },
      { placement: selected(AUTOTEST_CASE_ARTIFACT, `${run}::missing`, caseButton), reply: approval(workbenchManagement.opsRunsRead) },
      { placement: selected(AUTOTEST_CASE_ARTIFACT, `${run}::ready`, caseButton), reply: approval(workbenchManagement.opsTurnEvidenceRead) },
      { placement: selected(AUTOTEST_RUN, run, runButtons), reply: approval(workbenchManagement.opsRunsRead) },
      { placement: selected(AUTOTEST_RUN, busyRun, runButtons), reply: approval(workbenchManagement.opsRunsRead) },
      { placement: selected(AUTOTEST_RUN, foreignRun, runButtons), reply: approval(workbenchManagement.opsRunsRead) },
      { placement: selected(AUTOTEST_RUN, "run-missing", runButtons), reply: approval(workbenchManagement.opsRunsRead) },
      { placement: selected(AUTOTEST_RUN, run, runButtons), reply: { status: "forbidden", error: "Run read denied" } },
    ];
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
    for (const { placement } of cases) {
      mocks.resolve.mockImplementationOnce(async (_viewer, _credentials, _request, _cache, collectUse) => {
        collectUse("projection", { id: "evidence-button", domainId: viewer.domainId, ownerId: "author" });
        return placement;
      });
    }
    mocks.resolve.mockResolvedValueOnce({
      inputs: {}, projection: { data: { rows: { source: { type: binding(TURN_EVIDENCE) }, read: "list" } }, operations: {
        keep: { operation: binding(KEEP_TURN_EVIDENCE), target: { row: true } },
        unkeep: { operation: binding(UNKEEP_TURN_EVIDENCE), target: { row: true } },
      } },
    });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecordList" }, params: {}, inputs: {},
      selection: { typeId: TURN_EVIDENCE, method: "list" },
    });
    // Every operation of a button reads its own management gate; the batch reader sends identical items once.
    const gates = cases.map(({ placement }) => Object.keys(placement.projection.operations).length);
    mocks.read.mockResolvedValueOnce({ viewer, results: [
      ...cases.flatMap(({ reply }, index) => Array(gates[index]).fill(reply)),
      ...Array(3).fill(approval(workbenchManagement.opsTurnEvidenceRead)),
    ] });
    const prepared = await prepareRegisteredDataReads(credentials, [...cases.map(() => opRequest), request]);
    const results = await runPreparedDataReads(credentials, prepared);
    const noEvidence = { reason: tForLocale(credentials.locale, "panels.ops.errors.noEvidenceToDownload") };
    const notKept = { reason: tForLocale(credentials.locale, "panels.ops.notKept") };
    const alreadyKept = { reason: tForLocale(credentials.locale, "panels.ops.alreadyKept") };
    const runBusy = { reason: tForLocale(credentials.locale, "panels.ops.errors.runBusy") };
    const runNotFound = tForLocale(credentials.locale, "panels.ops.errors.runNotFound");
    expect(results).toMatchObject([
      { status: "ready", value: {
        keep: { handlerRef: KEEP_TURN_EVIDENCE }, unkeep: { unavailable: notKept }, download: { unavailable: noEvidence },
      } },
      { status: "ready", value: {
        keep: { unavailable: { reason: "Turn workspace not found" } }, download: { unavailable: { reason: "Turn workspace not found" } },
      } },
      { status: "forbidden", reason: "Evidence read denied" },
      { status: "ready", value: { download: { handlerRef: DOWNLOAD_AUTOTEST_CASE_ARTIFACT } } },
      { status: "ready", value: { download: { unavailable: noEvidence } } },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
      { status: "ready", value: {
        keep: { unavailable: alreadyKept }, unkeep: { handlerRef: UNKEEP_AUTOTEST_RUN }, delete: { handlerRef: DELETE_AUTOTEST_RUN },
      } },
      { status: "ready", value: { keep: { handlerRef: KEEP_AUTOTEST_RUN }, unkeep: { unavailable: notKept }, delete: { unavailable: runBusy } } },
      { status: "forbidden", reason: runNotFound },
      { status: "forbidden", reason: runNotFound },
      { status: "forbidden", reason: "Run read denied" },
      { status: "ready", value: [{ primaryKey: turn }], rowOperations: {
        [`${TURN_EVIDENCE}:${turn}`]: { keep: { available: true }, unkeep: { available: false, unavailable: notKept } },
      } },
    ]);
    expect(results[0]).not.toHaveProperty("value.keep.unavailable");
    expect(results[3]).not.toHaveProperty("value.download.unavailable");
    expect(results[6]).not.toHaveProperty("value.delete.unavailable");
    expect(results[6]).not.toHaveProperty("value.unkeep.unavailable");
    expect(results[7]).not.toHaveProperty("value.keep.unavailable");
    expect(readFileSync(retentionFile, "utf-8")).toBe(retentionBefore);
    expect(readFileSync(join(runtimeRoot, runFile(busyRun)), "utf-8")).toBe(busyBefore);
    const reads = mocks.read.mock.lastCall?.[1];
    expect(reads.map(({ call }: { call: unknown }) => call)).toEqual([
      ...cases.flatMap(({ placement }, index) => Array(gates[index]).fill({
        type: placement.inputs.selected.className, name: "record", parameters: {},
      })),
      { type: TURN_EVIDENCE, name: "list", parameters: {} },
      ...Array(2).fill({ type: TURN_EVIDENCE, name: "record", parameters: {} }),
    ]);
    expect(reads[0].uses).toMatchObject([{ target: { kind: "PROJECTION", id: "evidence-button" } }]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    installContentLayout({ ...layout, runtimeRoot: process.cwd() });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

it("presents registered autotest list operations only for admitted rows, including active artifact writes", async () => {
  const { withRunArtifactWrite } = await import("../../../platform/diagnosis/autotest/results/store");
  const runtimeRoot = mkdtempSync(join(tmpdir(), "registered-autotest-list-"));
  const layout = { publicSkillsRoot: process.cwd(), prompts: [], runtimeResources: [] };
  const retentionFile = join(runtimeRoot, "retention.json");
  const date = "2026-11-27T00:00:00Z";
  const writeRun = (runId: string, status: string, domainId = viewer.domainId) => {
    const dir = join(runtimeRoot, "data/autotest/runs", runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify({
      runId, domainId, status, createdAt: date, updatedAt: date,
      summary: { total: 0, correct: 0, wrong: 0, abnormal: 0 },
    }));
  };
  const operations = Object.fromEntries(Object.entries({
    keep: KEEP_AUTOTEST_RUN, unkeep: UNKEEP_AUTOTEST_RUN, delete: DELETE_AUTOTEST_RUN,
  }).map(([name, id]) => [name, { operation: { kind: "PlatformOperation", id }, target: { row: true } }]));
  const approval = { status: "ready", payload: workbenchManagement.opsRunsRead.id };
  const denied = { status: "forbidden", error: "Run list read denied" };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("DIAGNOSIS_RETENTION_FILE", retentionFile);
  installContentLayout({ ...layout, runtimeRoot });
  try {
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
    const requests = [request, request];
    for (const _ of requests) {
      mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {
        data: { rows: { source: { type: { kind: "PlatformObjectType", id: AUTOTEST_RUN } }, read: "list" } }, operations,
      } });
      mocks.prepare.mockResolvedValueOnce({
        declaration: { result: "panelRecordList" }, params: {}, inputs: {},
        selection: { typeId: AUTOTEST_RUN, method: "list" },
      });
    }
    const prepared = await prepareRegisteredDataReads(credentials, requests);
    // Each list read, then each row operation's run management gate in the same batch.
    const batch = [approval, approval, approval, approval, denied, denied, denied, denied];
    mocks.read.mockResolvedValueOnce({ viewer, results: batch });
    expect(await runPreparedDataReads(credentials, prepared)).toEqual([
      { status: "empty" }, { status: "forbidden", reason: denied.error },
    ]);

    writeRun("run-kept", "completed");
    writeRun("run-active", "running");
    writeRun("run-writing", "completed");
    writeRun("run-foreign", "completed", "foreign-domain");
    writeFileSync(retentionFile, JSON.stringify({
      version: 1, kept: ["run-kept", "run-foreign"].map(artifactId => ({ artifactId, artifactType: "autotest-run" })),
    }));
    mocks.getActiveRun.mockReturnValue({ runId: "run-active" });
    mocks.read.mockResolvedValueOnce({ viewer, results: batch });
    const [list, refused] = await withRunArtifactWrite("run-writing", () => runPreparedDataReads(credentials, prepared));
    const unavailable = (messageKey: string) => ({
      available: false, unavailable: { reason: tForLocale(credentials.locale, messageKey) },
    });
    const available = { available: true };
    const busy = unavailable("panels.ops.errors.runBusy");
    expect(list).toMatchObject({
      status: "ready", rereadAfterMs: 5000, value: expect.arrayContaining([
        { primaryKey: "run-kept", fields: { kept: true } },
        { primaryKey: "run-active", fields: { kept: false, active: true } },
        { primaryKey: "run-writing", fields: { kept: false, active: false } },
      ].map(row => expect.objectContaining({ ...row, fields: expect.objectContaining(row.fields) }))),
    });
    expect(list).toHaveProperty("value.length", 3);
    expect(list).toHaveProperty("rowOperations", {
      [`${AUTOTEST_RUN}:run-kept`]: { keep: unavailable("panels.ops.alreadyKept"), unkeep: available, delete: available },
      [`${AUTOTEST_RUN}:run-active`]: { keep: available, unkeep: unavailable("panels.ops.notKept"), delete: busy },
      [`${AUTOTEST_RUN}:run-writing`]: { keep: available, unkeep: unavailable("panels.ops.notKept"), delete: busy },
    });
    expect(refused).toEqual({ status: "forbidden", reason: denied.error });
    const listRead = [{ type: AUTOTEST_RUN, name: "list", parameters: {} }, ...Array(3).fill({ type: AUTOTEST_RUN, name: "record", parameters: {} })];
    expect(mocks.read.mock.lastCall?.[1].map(({ call }: { call: unknown }) => call)).toEqual([...listRead, ...listRead]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    mocks.getActiveRun.mockReset();
    installContentLayout({ ...layout, runtimeRoot: process.cwd() });
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

it("presents registered audit and settings facts without extra owner requests", async () => {
  const audit = {
    id: "audit-1", bussiness: "BKNOWLEDGE", operation: "ADD", description: "Updated knowledge",
    paramter: '{"source":"detail"}', userName: "Alice", operateTime: 0,
  };
  const settings = {
    knowledgeMaxResult: 10, dslCookerTimeout: 90000, lang: "en", languages: ["en", "ja"],
    fields: {
      knowledgeMaxResult: { label: "Knowledge limit", help: "Maximum recalled records" },
      dslCookerTimeoutSeconds: { label: "Query deadline", help: "Seconds before timeout" },
      lang: { label: "Backend language", help: "Messages from the data engine" },
    },
  };
  const page = { number: 99, size: 20 };
  const cases = [
    {
      typeId: AUDIT_LOG, method: "query", params: { page, business: "BKNOWLEDGE", operation: "ADD" },
      result: "panelRecordQuery", response: { status: "ready", payload: { data: [audit], totalRows: 21, totalPages: 2, pageNum: 2 } },
    },
    {
      typeId: AUDIT_LOG, method: "record", primaryKey: audit.id, params: {},
      result: "panelRecord", response: { status: "ready", payload: audit },
    },
    {
      typeId: AUDIT_LOG, method: "record", primaryKey: "missing", params: {},
      result: "panelRecord", response: { status: "error", code: "NOT_FOUND", error: "Audit log not found" },
    },
    {
      typeId: GENERAL_SETTINGS, method: "list", params: {},
      result: "panelRecordList", response: { status: "ready", payload: settings },
    },
    {
      typeId: GENERAL_SETTINGS, method: "record", primaryKey: "general", params: {},
      result: "panelRecord", response: { status: "ready", payload: settings },
    },
    {
      typeId: GENERAL_SETTINGS, method: "form", primaryKey: "general", params: { values: { lang: "de" } },
      result: "panelFormDescription", response: { status: "ready", payload: settings },
    },
    {
      typeId: GENERAL_SETTINGS, method: "form", primaryKey: "general", params: { values: { "/lang": "en" } },
      result: "panelFormDescription", response: { status: "ready" },
    },
  ];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { params, result, response: _response, ...selection } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(({ response }) => response) });

  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
  const replies = await runPreparedDataReads(credentials, prepared);
  const generalRecord = { primaryKey: "general", fields: { dslCookerTimeoutSeconds: "90", lang: "English" } };
  expect(replies).toMatchObject([
    { status: "ready", value: { rows: [{ primaryKey: audit.id, fields: { userName: "Alice" } }], total: 21 } },
    { status: "ready", value: { primaryKey: audit.id, fields: { parameters: audit.paramter } } },
    { status: "error", code: "NOT_FOUND", message: "Audit log not found" },
    { status: "ready", value: [generalRecord] },
    { status: "ready", value: generalRecord },
    { status: "ready", value: {
      values: { dslCookerTimeoutSeconds: 90, lang: "de" },
      errors: [{ field: "/lang", code: "invalid_option" }],
      fields: expect.arrayContaining([expect.objectContaining({
        path: "/lang", control: expect.objectContaining({
          options: [expect.objectContaining({ value: "en" }), expect.objectContaining({ value: "ja" })],
        }),
      })]),
    } },
    { status: "error", code: "INVALID_REQUEST" },
  ]);
  expect(replies[0]).not.toHaveProperty("value.rows.0.fields.parameters");
  const calls = mocks.read.mock.lastCall?.[1].map((read: { call?: unknown }) => read.call);
  expect(calls).toEqual([
    ...cases.slice(0, -1).map(({ typeId, method, params, primaryKey }) => ({
      type: typeId, name: method, parameters: { ...params, ...(primaryKey !== undefined && { primaryKey }) },
    })),
    undefined,
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("presents BusinessKnowledge entries, counts and forms from the registered batch", async () => {
  const knowledge = {
    knowledgeID: "k-1", knowledgeTitle: "Shipping rule", knowledgeText: "Compare the rule", knowledgeTags: ["Logistics"], status: 0,
  };
  const entries = {
    "k-1": knowledge,
    "k-2": { ...knowledge, knowledgeID: "k-2", knowledgeTitle: "Return rule" },
    "k-3": { ...knowledge, knowledgeID: "k-3", knowledgeTitle: "Approved rule", status: 1 },
  };
  const labels = { pendingName: "Owner pending", approvedName: "Owner approved" };
  const text = { ...labels, fieldLabels: { knowledgeText: "Owner content", knowledgeTags: "Owner tags", status: "Owner status" } };
  const fields = [{
    path: "/knowledgeTitle", label: "Owner title", control: { kind: "text", multiline: false },
    valueSchema: { type: "string" }, required: true, readOnly: false,
  }];
  const form = {
    fields, values: { ...knowledge, knowledgeTitle: "Edited" },
    save: { method: "POST", path: "/admin/editBussinessKnowledge", bodySchema: { type: "object" } },
  };
  const draft = {
    fields, values: { knowledgeID: "", knowledgeTitle: "", knowledgeText: "", knowledgeTags: [], status: 1 },
    save: { ...form.save, path: "/admin/addBussinessKnowledge" },
  };
  const cases = [
    {
      method: "query", params: { search: "rule", status: "pending", cursor: "1", size: 1 }, result: "panelRecordQuery",
      response: { status: "ready", payload: { entries, text } },
    },
    {
      method: "counts", params: { by: "status", search: "rule" }, result: "panelGroupCounts",
      response: { status: "ready", payload: {
        entries: Object.values(entries).map(({ knowledgeID: _id, ...searchable }) => searchable), labels,
      } },
    },
    {
      method: "record", primaryKey: knowledge.knowledgeID, params: { search: "rule" }, result: "panelRecord",
      response: { status: "ready", payload: { entry: knowledge, text } },
    },
    {
      method: "record", primaryKey: "outside", params: {}, result: "panelRecord",
      response: { status: "error", code: "KNOWLEDGE_UNAVAILABLE", error: "Business knowledge outside is not in this domain" },
    },
    {
      method: "form", primaryKey: knowledge.knowledgeID, params: { values: { knowledgeTitle: "Edited" }, changedField: "/knowledgeTitle" },
      result: "panelFormDescription", response: { status: "ready", payload: form },
    },
    {
      method: "createForm", params: {}, result: "panelFormDescription",
      response: { status: "ready", payload: draft },
    },
    {
      method: "count", params: {}, result: "panelRecordQuery",
      response: { status: "ready", payload: { rows: [], total: 3 } },
    },
  ];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { params, result, response: _response, ...selection } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection: { typeId: BUSINESS_KNOWLEDGE, ...selection } });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(({ response }) => response) });

  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: { rows: [{ primaryKey: "k-1" }, { primaryKey: "k-2" }], total: 2 } },
    { status: "ready", value: [
      { key: "all", count: 3 },
      { key: "pending", label: labels.pendingName, count: 2 },
      { key: "approved", label: labels.approvedName, count: 1 },
    ] },
    { status: "ready", value: { primaryKey: "k-1", fieldLabels: text.fieldLabels, fields: { status: labels.pendingName },
      highlights: { knowledgeText: [{ start: 12, end: 16 }] },
    } },
    { status: "error", code: "KNOWLEDGE_UNAVAILABLE", message: "Business knowledge outside is not in this domain" },
    { status: "ready", value: { ...form, errors: [] } },
    { status: "ready", value: { ...draft, errors: [] } },
    { status: "ready", value: { rows: [], total: 3 } },
  ]);
  expect(mocks.read.mock.lastCall?.[1].map((read: { call: unknown }) => read.call)).toEqual(
    cases.map(({ method, primaryKey, params }) => ({
      type: BUSINESS_KNOWLEDGE, name: method, parameters: { ...params, ...(primaryKey !== undefined && { primaryKey }) },
    })),
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("presents one authorized application catalogue page without a second owner request", async () => {
  const params = { scope: "mine", search: "Shipping", sort: "name", cursor: "name-en.app-first.U2hpcHBpbmc", size: 2 };
  const raw = {
    rows: [{
      id: "app-shipping", names: { en: "Shipping" }, descriptions: { en: "Shipment catalogue" },
      icon: "pages", source: "domain", canMaintain: true, canEditEntries: true, entryCount: 1, ownerName: "Owner",
    }],
    total: 3, nextCursor: "name-en.app-shipping.U2hpcHBpbmc",
  };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordQuery" }, params, selection: { typeId: APPLICATION, method: "query" },
  });
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "ready", payload: raw }] });

  const prepared = await prepareRegisteredDataReads(credentials, [request]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([{
    status: "ready", value: {
      total: 3, nextCursor: raw.nextCursor, rows: [{
        primaryKey: "app-shipping", label: "Shipping", subtitle: "Shipment catalogue",
        fields: { canMaintain: true, canEditEntries: true, owner: "Owner" },
      }],
    },
  }]);
  expect(mocks.read).toHaveBeenLastCalledWith(viewer, [expect.objectContaining({
    call: { type: APPLICATION, name: "query", parameters: params },
  })], credentials);
  expect(fetch).not.toHaveBeenCalled();
});

it("reads application detail with the admitted frame label and preserves masked lookup failures", async () => {
  const primaryKey = "app-shipping";
  const framePanelId = "frame-shipping";
  const detail = {
    id: primaryKey, names: { en: "Shipping" }, descriptions: { en: "Shipment catalogue" },
    icon: "pages", source: "domain", canMaintain: true, canEditEntries: true, entryCount: 1, ownerName: "Owner",
    entry: { path: "/applications/app-shipping", home: "/applications/app-shipping/overview" },
    panelUses: [{ id: "overview", names: { en: "overview" }, pageKey: "shipping:overview", panelId: "panel-shipping", path: "/applications/app-shipping/overview" }],
    groups: [], framePanelId, theme: { light: { accent: "#123456" } },
  };
  const time = new Date("2026-11-26T00:00:00Z");
  mocks.currentProducts.mockResolvedValueOnce(new Map([[framePanelId, {
    id: framePanelId, domainId: viewer.domainId, ownerId: "author", revision: 1, createdAt: time, updatedAt: time,
    definition: { name: "Shipping frame", description: "", visibility: "domain", content: { html: "<div />" }, manifest: { state: {}, members: {} } },
  }]]));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const ids = [primaryKey, "app-missing", "app-no-entry"];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const id of ids) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecord" }, params: {}, selection: { typeId: APPLICATION, method: "record", primaryKey: id },
    });
  }
  const emptyRange = { fixed: false, all: false, objectIds: [], authorId: null };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: detail, visibility: { PANEL: { USE: emptyRange, EDIT: { ...emptyRange, objectIds: [framePanelId] } } } },
    { status: "error", error: "Application unavailable" },
    { status: "error", error: "Application unavailable" },
  ] });
  const prepared = await prepareRegisteredDataReads(credentials, ids.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: {
      primaryKey, label: "Shipping", subtitle: "Shipment catalogue", fields: {
        entryCount: 1, owner: "Owner", framePanel: { primaryKey: framePanelId, label: "Shipping frame" },
      }, outputs: { canMaintain: true, canEditEntries: true, openPath: detail.entry.home },
    } },
    { status: "error", message: "Application unavailable" },
    { status: "error", message: "Application unavailable" },
  ]);
  expect(mocks.read).toHaveBeenLastCalledWith(viewer, ids.map(id => expect.objectContaining({
    call: { type: APPLICATION, name: "record", parameters: { primaryKey: id } },
    visibleKinds: [{ kind: "PANEL", verbs: ["USE", "EDIT"] }],
  })), credentials);
  expect(mocks.currentProducts.mock.calls).toEqual([[viewer.domainId, "panel", [framePanelId]]]);
  expect(fetch).not.toHaveBeenCalled();
});

it("labels application panel references with USE or EDIT and expands graph edges only with USE", async () => {
  const postgres = await import("../../../infrastructure/postgres");
  const primaryKey = "app-shipping";
  const framePanelId = "panel-frame";
  const panelIds = ["panel-use", "panel-edit", "panel-hidden"];
  const time = new Date("2026-11-26T00:00:00Z");
  const panel = (id: string, name: string, targets: Record<string, { panelId: string } | { projectionId: string }>) => ({
    id, domainId: viewer.domainId, ownerId: "author", revision: 1, createdAt: time, updatedAt: time,
    definition: { name, description: "", visibility: "domain", content: { html: "<div />" }, manifest: {
      state: {}, members: Object.fromEntries(Object.entries(targets).map(([key, target]) => [key, { target }])),
    } },
  });
  const definitions = new Map([
    [framePanelId, panel(framePanelId, "Frame", {})],
    ["panel-use", panel("panel-use", "Overview", {
      child: { panelId: "panel-child" },
      visible: { projectionId: "projection-visible" },
      hidden: { projectionId: "projection-hidden" },
    })],
    ["panel-edit", panel("panel-edit", "Manage", { restricted: { projectionId: "projection-edit-only" } })],
    ["panel-hidden", panel("panel-hidden", "Hidden name", { restricted: { projectionId: "projection-secret" } })],
    ["panel-child", panel("panel-child", "Child", {})],
  ]);
  const productRows = async (_domain: string, _kind: string, ids: string[]) =>
    new Map(ids.map(id => [id, definitions.get(id)]));
  mocks.currentProducts.mockImplementationOnce(productRows).mockImplementationOnce(productRows).mockImplementationOnce(productRows);
  const query = vi.fn(async (sql: string) => {
    expect(sql).toContain("p.id = ANY($2::text[])");
    expect(sql).toContain("p.id = ANY($3::text[])");
    return { rows: [{ id: "projection-visible", name: "Visible projection" }] };
  });
  const pool = vi.spyOn(postgres, "getPostgresPool")
    .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const cases = [
    { method: "usedPanels", id: primaryKey, result: "panelRecordList" },
    { method: "referenceGraph", id: primaryKey, result: "panelRecord" },
    { method: "referenceGraph", id: "app-missing", result: "panelRecord" },
  ];
  const range = (...objectIds: string[]) => ({ fixed: false, all: false, objectIds, authorId: null });
  const PANEL = { USE: range(framePanelId, "panel-use"), EDIT: range("panel-edit", "panel-child") };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { method, id, result } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params: {}, selection: { typeId: APPLICATION, method, primaryKey: id } });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: { panelIds }, visibility: { PANEL } },
    { status: "ready", payload: { id: primaryKey, names: { en: "Shipping" }, framePanelId, panelIds },
      visibility: { PANEL, PROJECTION: { USE: range("projection-visible") } } },
    { status: "error", error: "Application unavailable" },
  ] });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: [
        { primaryKey: "panel-use", label: "Overview", fields: { accessible: true } },
        { primaryKey: "panel-edit", label: "Manage", fields: { accessible: true } },
        { primaryKey: "panel-hidden", label: "panel-hidden", fields: { accessible: false } },
      ] },
      { status: "ready", value: { primaryKey, fields: { graph: { kind: "json", value: {
        nodes: expect.arrayContaining([
          { id: "asset:panel-child", name: "Child", kind: "page" },
          { id: "asset:projection-visible", name: "Visible projection", kind: "object-projection" },
          { id: "asset:projection-hidden", name: "projection-hidden", kind: "object-projection" },
        ].map(node => expect.objectContaining(node))),
        edges: expect.arrayContaining([
          { source: `asset:${primaryKey}`, target: "asset:panel-edit", relation: "navigates" },
          { source: "asset:panel-use", target: "asset:panel-child", relation: "contains" },
        ].map(edge => expect.objectContaining(edge))),
      } } } } },
      { status: "error", message: "Application unavailable" },
    ]);
    expect(JSON.stringify(results)).not.toMatch(/projection-edit-only|projection-secret|Hidden name/);
    expect(mocks.currentProducts.mock.calls).toEqual([
      [viewer.domainId, "panel", panelIds],
      [viewer.domainId, "panel", [framePanelId, ...panelIds]],
      [viewer.domainId, "panel", ["panel-child"]],
    ]);
    expect(query.mock.calls).toEqual([
      [expect.any(String), [viewer.domainId, ["projection-visible", "projection-hidden"], ["projection-visible"]]],
    ]);
    expect(mocks.read.mock.lastCall?.[1]).toMatchObject(cases.map(({ method, id }) => ({
      call: { type: APPLICATION, name: method, parameters: { primaryKey: id } },
      visibleKinds: [{ kind: "PANEL", verbs: ["USE", "EDIT"] },
        ...(method === "referenceGraph" ? [{ kind: "PROJECTION", verbs: ["USE"] }] : [])],
    })));
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    pool.mockRestore();
  }
});

it("reads registered product panel and projection contents with their original visibility rules", async () => {
  const postgres = await import("../../../infrastructure/postgres");
  const time = new Date("2026-11-26T00:00:00Z");
  const product = (id: string, definition: Record<string, unknown>) => ({
    id, domainId: viewer.domainId, ownerId: "author", revision: 7, createdAt: time, updatedAt: time,
    definition: { name: id, description: "", visibility: "domain", ...definition },
  });
  const componentId = "@ontomato/sdk:ObjectList";
  const proj = product("projection-use", {
    componentId,
    data: { rows: { read: "list", source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, params: {} } },
    inputs: { keyword: { kind: "scalar", type: "string" } },
    outputs: { count: { kind: "scalar", type: "number" } },
    config: { layout: "list" },
  });
  const panelDefinition = (members: Record<string, object> = {}) => ({
    content: { html: "<main></main>" },
    manifest: { state: {}, members: Object.fromEntries(Object.entries(members).map(([name, target]) => [name, { target }])) },
  });
  const parent = product("panel-use", panelDefinition({
    visible: { projectionId: proj.id }, hidden: { projectionId: "projection-hidden" }, child: { panelId: "panel-edit" },
  }));
  const editable = product("panel-edit", { ...panelDefinition({ placement: { projectionId: proj.id } }), name: "Editable child" });
  const broken = product("panel-broken", {});
  const rows = new Map([parent, editable, broken, proj, { ...proj, id: "projection-hidden" }].map(row => [row.id, row]));
  mocks.currentProduct.mockImplementation(async (_domain, _kind, id) => rows.get(id as string));
  mocks.currentProducts.mockImplementation(async (_domain, _kind, ids: string[]) => new Map(ids.map(id => [id, rows.get(id)])));
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    expect(args[0]).toBe(viewer.domainId);
    if (sql.includes('definition->>\'name\' AS name, definition->>\'description\'')) {
      expect(args.slice(1)).toEqual([[proj.id, "projection-hidden"], [proj.id]]);
      return { rows: [{ id: proj.id, name: "Visible projection", description: "Admitted description", componentId }] };
    }
    if (sql.includes(" AS editable FROM ")) {
      expect(args.slice(1)).toEqual([[parent.id], [editable.id, broken.id]]);
      return { rows: [{ ...broken, editable: true }] };
    }
    if (sql.startsWith("SELECT id,definition FROM")) return { rows: [parent, editable] };
    if (sql.includes("product_object_details")) return { rows: [] };
    throw new Error("Unexpected owner SQL: " + sql);
  });
  const pool = vi.spyOn(postgres, "getPostgresPool")
    .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const range = (...objectIds: string[]) => ({ fixed: false, all: false, objectIds, authorId: null });
  const PANEL = { USE: range(parent.id), EDIT: range(editable.id, broken.id) };
  const PROJECTION = { USE: range(proj.id), EDIT: range("projection-hidden") };
  const cases = [
    { typeId: PRODUCT_PANEL, method: "memberRows", key: parent.id, result: "panelRecordList" },
    { typeId: PRODUCT_PANEL, method: "sourceFile", key: editable.id, result: "panelRecord", params: { path: "panel.html" } },
    { typeId: PRODUCT_PANEL, method: "sourceFile", key: parent.id, result: "panelRecord", params: { path: "panel.html" } },
    { typeId: PRODUCT_PANEL, method: "unavailable", result: "panelRecordList" },
    ...["dataRows", "inputRows", "outputRows", "configRows"].map(method => ({
      typeId: PRODUCT_PROJECTION, method, key: proj.id, result: "panelRecordList",
    })),
    { typeId: PRODUCT_PROJECTION, method: "configRows", key: "projection-hidden", result: "panelRecordList" },
    { typeId: PRODUCT_PROJECTION, method: "usedByRows", key: proj.id, result: "panelRecordList" },
    { typeId: PRODUCT_PROJECTION, method: "referenceGraph", key: proj.id, result: "panelRecord" },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { typeId, method, key, result, params } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result }, params: params ?? {}, selection: { typeId, method, primaryKey: key },
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(() => ({ status: "ready", visibility: { PANEL, PROJECTION } })) });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
      { status: "ready", value: [
        { primaryKey: proj.id, label: "Visible projection", fields: { componentId: "@ontomato/sdk:ObjectList" } },
        { primaryKey: "projection-hidden", label: "projection-hidden", fields: { componentId: "—" } },
        { primaryKey: editable.id, label: "Editable child" },
      ] },
      { status: "forbidden" },
      { status: "ready", value: { primaryKey: "panel.html", fields: { content: "<main></main>" } } },
      { status: "ready", value: [{ primaryKey: broken.id, fields: { revision: 7, canDelete: true } }] },
      ...["rows", "keyword", "count", "layout"].map(primaryKey => ({ status: "ready", value: [{ primaryKey }] })),
      { status: "forbidden" },
      { status: "ready", value: [{ primaryKey: parent.id }] },
      { status: "ready", value: { fields: { graph: { value: { edges: expect.arrayContaining([
        expect.objectContaining({ source: "asset:" + parent.id, target: "asset:" + proj.id, relation: "contains" }),
      ]) } } } } },
    ]);
    const reads = mocks.read.mock.lastCall![1] as { call?: unknown; visibleKinds: unknown }[];
    expect(reads.every(item => !("call" in item))).toBe(true);
    expect(reads[0].visibleKinds).toEqual([{ kind: "PANEL", verbs: ["USE", "EDIT"] }, { kind: "PROJECTION", verbs: ["USE"] }]);
    expect(reads[4].visibleKinds).toEqual([{ kind: "PROJECTION", verbs: ["USE"] }]);
    expect(reads.at(-1)?.visibleKinds).toEqual([{ kind: "PROJECTION", verbs: ["USE"] }, { kind: "PANEL", verbs: ["USE"] }]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    mocks.currentProduct.mockReset();
    mocks.currentProducts.mockReset();
    pool.mockRestore();
  }
});

it("uses registered catalogue owner facts for drafts, grants, record sharing and application references", async () => {
  const postgres = await import("../../../infrastructure/postgres");
  const components = vi.spyOn(await import("../component-catalogue"), "readAuthorComponentCatalogueInRange").mockResolvedValue(new Map());
  const time = new Date("2026-11-26T00:00:00Z");
  const row = (id: string, definition: Record<string, unknown>) => ({
    id, domainId: viewer.domainId, ownerId: "author", revision: 7, createdAt: time, updatedAt: time,
    definition: { name: id, description: "", visibility: "domain", ...definition },
  });
  const panel = row("panel-owner", { content: { html: "<main></main>" }, manifest: { state: {}, members: {} } });
  const projection = row("projection-owner", { componentId: "@ontomato/sdk:ObjectList", data: {}, config: {}, inputs: {}, outputs: {} });
  const parent = row("panel-private-parent", {
    content: { html: "<main></main>" },
    manifest: { state: {}, members: { child: { target: { panelId: panel.id } } } },
  });
  const owned = new Map([panel, projection, parent].map(value => [value.id, value]));
  mocks.currentProduct.mockImplementation(async (_domain, _kind, id) => owned.get(id as string));
  mocks.currentProducts.mockImplementation(async (_domain, _kind, ids: string[]) =>
    new Map(ids.map(id => [id, owned.get(id)!])));
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    expect(args[0]).toBe(viewer.domainId);
    if (sql.startsWith("SELECT id,definition FROM")) return { rows: [parent] };
    if (sql.includes("product_object_details")) return { rows: [] };
    throw new Error("Unexpected owner SQL: " + sql);
  });
  const pool = vi.spyOn(postgres, "getPostgresPool")
    .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const range = (...objectIds: string[]) => ({ fixed: false, all: false, objectIds, authorId: null });
  const editable = { USE: range(), EDIT: range(panel.id) };
  const usable = { USE: range(panel.id), EDIT: range() };
  const entries = [{ applicationId: "app-using-panel", names: { en: "Uses this panel" }, useId: "one", path: "/apps/using/one" }];
  const grants = { shared: true, grants: [{ policyId: "team", name: "Team", verb: "EDIT" }] };
  const panelFacts = { status: "ready", visibility: { PANEL: editable } };
  const readOnly = { status: "forbidden", error: "Edit required" };
  const cases = [
    { type: PRODUCT_PANEL, name: "createForm", result: "panelFormDescription", params: { values: { id: "draft-panel", name: "Draft" } },
      reply: { status: "ready", payload: true } },
    { type: PRODUCT_PROJECTION, name: "createForm", result: "panelFormDescription", params: { values: { id: "draft-projection" } },
      reply: { status: "ready", payload: true, visibility: { COMPONENT: { USE: range() } } } },
    { type: PRODUCT_PANEL, name: "grantRows", key: panel.id, result: "panelRecordList",
      reply: { status: "ready", payload: grants } },
    { type: PRODUCT_PROJECTION, name: "grantRows", key: projection.id, result: "panelRecordList", reply: readOnly },
    { type: PRODUCT_PANEL, name: "usedByRows", key: panel.id, result: "panelRecordList",
      reply: { ...panelFacts, payload: entries } },
    { type: PRODUCT_PANEL, name: "referenceGraph", key: panel.id, result: "panelRecord",
      reply: { ...panelFacts, payload: entries, visibility: { PANEL: usable, PROJECTION: { USE: range() } } } },
    { type: PRODUCT_PANEL, name: "referenceGraph", key: panel.id, result: "panelRecord",
      reply: { ...panelFacts, payload: entries, visibility: { PANEL: editable, PROJECTION: { USE: range() } } } },
    { type: PRODUCT_PANEL, name: "record", key: panel.id, result: "panelRecord",
      reply: { ...panelFacts, payload: { editable: true, shared: true, ownerLabel: "Panel author" } } },
    { type: PRODUCT_PROJECTION, name: "record", key: projection.id, result: "panelRecord",
      reply: { status: "ready", payload: { editable: false, ownerLabel: "Projection author" },
        visibility: { PANEL: { USE: range() }, COMPONENT: { USE: range() } } } },
    { type: PRODUCT_PANEL, name: "createForm", result: "panelFormDescription", reply: { status: "forbidden", error: "Create denied" } },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { type, name, key, result, params } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result }, params: params ?? {}, selection: { typeId: type, method: name, primaryKey: key },
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(({ reply }) => reply) });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: { values: { id: "draft-panel", name: "Draft" } } },
      { status: "ready", value: { values: { id: "draft-projection" } } },
      { status: "ready", value: [{ primaryKey: "team:EDIT" }, { primaryKey: "domain", fields: { revocable: false } }] },
      { status: "forbidden", reason: "Edit required" },
      { status: "ready", value: [{ primaryKey: "/apps/using/one", label: "Uses this panel" }] },
      { status: "ready", value: { fields: { graph: { value: { edges: [
        expect.objectContaining({ source: "asset:app-using-panel", target: "asset:panel-owner", relation: "navigates" }),
      ] } } } } },
      { status: "forbidden" },
      { status: "ready", value: { fields: { owner: "Panel author" }, outputs: { canGrant: true, domainShared: true, hiddenUsedByCount: 1 } } },
      { status: "ready", value: { fields: { owner: "Projection author" }, outputs: { canGrant: false } } },
      { status: "forbidden", reason: "Create denied" },
    ]);
    expect(results[8]).not.toHaveProperty("value.outputs.domainShared");
    expect(results[8]).not.toHaveProperty("value.fields.domainShared");
    const facts = (kind: "PANEL" | "PROJECTION", id: string) => ({
      target: { domainId: viewer.domainId, kind, id }, ownerFacts: { ownerId: "author", state: "PUBLISHED" },
    });
    expect(mocks.read.mock.lastCall![1].map(({ call }: { call: unknown }) => call)).toEqual([
      { type: PRODUCT_PANEL, name: "createForm", parameters: {} },
      { type: PRODUCT_PROJECTION, name: "createForm", parameters: {} },
      { type: PRODUCT_PANEL, name: "grantRows", parameters: facts("PANEL", panel.id) },
      { type: PRODUCT_PROJECTION, name: "grantRows", parameters: facts("PROJECTION", projection.id) },
      { type: PRODUCT_PANEL, name: "usedByRows", parameters: { primaryKey: panel.id } },
      ...Array.from({ length: 2 }, () => ({ type: PRODUCT_PANEL, name: "referenceGraph", parameters: { primaryKey: panel.id } })),
      { type: PRODUCT_PANEL, name: "record", parameters: { ...facts("PANEL", panel.id), details: true } },
      { type: PRODUCT_PROJECTION, name: "record", parameters: { ...facts("PROJECTION", projection.id), details: true } },
      { type: PRODUCT_PANEL, name: "createForm", parameters: {} },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    mocks.currentProduct.mockReset();
    mocks.currentProducts.mockReset();
    components.mockRestore();
    pool.mockRestore();
  }
});

it("resolves catalogue author candidates before pagination and searches only the visible panel authors", async () => {
  const postgres = await import("../../../infrastructure/postgres");
  const components = vi.spyOn(await import("../component-catalogue"), "readAuthorComponentCatalogueInRange").mockResolvedValue(new Map());
  const time = new Date("2026-11-26T00:00:00Z");
  const cursor = Buffer.from(JSON.stringify({ sort: "updated", id: "cursor-panel", key: time.toISOString() })).toString("base64url");
  const authorIds = Array.from({ length: 125 }, (_, index) => "author-" + index);
  const projectionAuthor = viewer.userId;
  const panel = {
    id: "one-panel", name: "Does not match the author search", description: "", visibility: "domain", revision: 4,
    ownerId: authorIds.at(-1), domainId: viewer.domainId, updatedAt: time, createdAt: time, sortKey: time.toISOString(),
    editable: true, template: true, definition: {
      name: "Does not match the author search", description: "", visibility: "domain",
      content: { html: "<main></main>" }, manifest: { state: {}, members: {} },
    },
  };
  const projection = {
    id: "one-projection", name: "Projection matches", description: "", visibility: "domain", revision: 1,
    ownerId: projectionAuthor, updatedAt: time, sortKey: time.toISOString(),
    editable: false, componentId: "@ontomato/sdk:ObjectList",
    definition: {
      componentId: "@ontomato/sdk:ObjectList",
      data: { rows: { source: { type: { kind: "PlatformObjectType", id: OBJECT_TYPE } }, read: "list", params: {} } },
    },
  };
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    expect(args[0]).toBe(viewer.domainId);
    if (sql.startsWith("SELECT DISTINCT")) {
      expect(sql).not.toMatch(/LIMIT|OFFSET|UNION ALL/);
      expect(sql).toContain("p.domain_id=$1");
      expect(sql).toContain("COALESCE(owner_id=");
      expect(args).toContain(viewer.userId);
      if (sql.includes("product_projections")) {
        expect(sql).toContain("definition->>'componentId' =");
        expect(args).toContain("@ontomato/sdk:ObjectList");
        expect(args).toContain("Projection");
        expect(args).toContain(OBJECT_TYPE);
        return { rows: [{ ownerId: projectionAuthor }] };
      }
      expect(sql).toContain("(updated_at,p.id) <");
      expect(sql).toContain("definition->'template'");
      expect(sql).not.toContain("strpos(lower(");
      expect(args).toEqual([viewer.domainId, "shared", viewer.userId, true, time.toISOString(), "cursor-panel"]);
      return { rows: authorIds.map(ownerId => ({ ownerId })) };
    }
    if (sql.includes("product_projections")) {
      expect(sql).toContain("strpos(lower(");
      expect(sql).not.toContain("OR p.owner_id = ANY(");
      expect(args).toContain("Projection");
      expect(args).toContain(OBJECT_TYPE);
      return { rows: sql.startsWith("SELECT COUNT") ? [{ total: 1 }] : [projection] };
    }
    expect(sql).toContain("OR p.owner_id = ANY(");
    expect(sql).toContain("definition->'template'");
    expect(args).toContainEqual([authorIds.at(-1)]);
    expect(args).toContain("Ada");
    if (sql.startsWith("SELECT COUNT")) return { rows: [{ total: 3 }] };
    expect(args).toContain("cursor-panel");
    expect(args.slice(-2)).toEqual([2, 0]);
    return { rows: [panel, { ...panel, id: "lookahead" }] };
  });
  const pool = vi.spyOn(postgres, "getPostgresPool")
    .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const panelParams = { search: "Ada", scope: "shared", sort: "updated", template: true, size: 1, cursor };
  const projectionParams = { search: "Projection", scope: "mine", componentId: "@ontomato/sdk:ObjectList", objectType: OBJECT_TYPE, size: 1 };
  const range = (...objectIds: string[]) => ({ fixed: false, all: false, objectIds, authorId: null });
  const use = { USE: range(), EDIT: range(panel.id) };
  const labels = (...options: { id: string; name: string }[]) => ({
    options: options.map(option => ({ ...option, kind: "member" })),
  });
  const cases = [
    { typeId: PRODUCT_PANEL, params: panelParams },
    { typeId: PRODUCT_PROJECTION, params: projectionParams },
    { typeId: PRODUCT_PANEL, params: panelParams },
  ];
  const placement = { status: "ready" };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { typeId, params } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecordQuery" }, params, selection: { typeId, method: "query" },
    });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(query.mock.calls).toHaveLength(3);
    return { viewer, results: [
      placement, { status: "ready", payload: labels(
        { id: authorIds[0], name: "Unplaced author" }, { id: authorIds.at(-1)!, name: "Ada" },
      ), visibility: { PANEL: use } },
      { status: "ready", payload: labels({ id: authorIds.at(-1)!, name: "Ada" }) },
      placement, { status: "ready", payload: labels(), visibility: { PROJECTION: { USE: range(projection.id), EDIT: range() }, COMPONENT: { USE: range() } } },
      placement, { status: "error", code: "IDENTITY_FAILED", error: "Author names unavailable" },
      { status: "ready", payload: labels() },
    ] };
  });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    const result = await runPreparedDataReads(credentials, prepared);
    expect(result).toMatchObject([
      { status: "ready", value: { rows: [{ primaryKey: panel.id, fields: { owner: "Ada" } }], total: 3, nextCursor: expect.any(String) } },
      { status: "ready", value: { rows: [{ primaryKey: projection.id, fields: { owner: projectionAuthor } }], total: 1 } },
      { status: "error", code: "IDENTITY_FAILED", message: "Author names unavailable" },
    ]);
    expect(JSON.stringify(result)).not.toContain("Unplaced author");
    const directory = (parameters: unknown) => ({ type: USER, name: "principalDirectory", parameters });
    const calls = mocks.read.mock.lastCall![1] as { call?: unknown; visibleKinds?: unknown }[];
    expect(calls.map(({ call }) => call)).toEqual([
      undefined, directory({ kind: "member", ids: authorIds }), directory({ kind: "member", keyword: "Ada", limit: 100 }),
      undefined, directory({ kind: "member", ids: [projectionAuthor] }),
      undefined, directory({ kind: "member", ids: authorIds }), directory({ kind: "member", keyword: "Ada", limit: 100 }),
    ]);
    expect(calls[1].visibleKinds).toEqual([{ kind: "PANEL", verbs: ["USE", "EDIT"] }]);
    expect(calls[4].visibleKinds).toEqual([{ kind: "PROJECTION", verbs: ["USE", "EDIT"] }, { kind: "COMPONENT", verbs: ["USE"] }]);
    expect(query.mock.calls).toHaveLength(7);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    pool.mockRestore();
    components.mockRestore();
  }
});

it("describes catalogue panel deletion from admitted management ranges without doing the delete", async () => {
  const time = new Date("2026-11-26T00:00:00Z");
  const row = (id: string) => ({
    id, domainId: viewer.domainId, ownerId: "author", revision: 7, createdAt: time, updatedAt: time,
    definition: { name: id, description: "", visibility: "domain" },
  });
  mocks.currentProduct.mockImplementation(async (_domain, _kind, id) => row(id as string));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const range = (...objectIds: string[]) => ({ fixed: false, all: false, objectIds, authorId: null });
  const scope = { PANEL: { USE: range("readonly"), EDIT: range("broken-editable") } };
  const opRequest: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const ids = ["broken-editable", "readonly", "hidden", "broken-editable"];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const primaryKey of ids) {
    mocks.resolve.mockResolvedValueOnce({
      panel: { manifest: { state: {}, members: {} } },
      member: { inputs: { panel: { literal: { className: PRODUCT_PANEL, primaryKey } } } },
      projection: {
        inputs: { panel: { kind: "object", objectType: PRODUCT_PANEL } },
        operations: { delete: { operation: { kind: "PlatformOperation", id: "productPanels.delete" }, target: { input: "panel" } } },
      },
      inputs: {},
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ...ids.slice(0, -1).map(() => ({ status: "ready", visibility: scope })),
    { status: "forbidden", error: "Placement denied" },
  ] });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, ids.map(() => opRequest));
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: { delete: { handlerRef: "productPanels.delete" } } },
      { status: "ready", value: { delete: { unavailable: { reason: en["panels.productCatalog.application.readOnly"] } } } },
      { status: "ready", value: { delete: { unavailable: { reason: en["panels.productCatalog.application.availabilityUnavailable"] } } } },
      { status: "forbidden", reason: "Placement denied" },
    ]);
    expect(results[0]).not.toHaveProperty("value.delete.unavailable");
    expect(mocks.currentProduct.mock.calls).toEqual(ids.slice(0, -1).map(id => [viewer.domainId, "panel", id]));
    const reads = mocks.read.mock.lastCall![1] as { call?: unknown; visibleKinds: unknown }[];
    expect(reads.map(item => [item.call, item.visibleKinds])).toEqual(ids.map(() => [
      undefined, [{ kind: "PANEL", verbs: ["USE", "EDIT"] }],
    ]));
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    mocks.currentProduct.mockReset();
  }
});

it("describes application deletion with catalogue maintenance and masked lookup facts", async () => {
  const ids = ["app-owned", "app-read-only", "app-hidden", "app-denied", "app-failed", "app-invalid"];
  const opRequest: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const primaryKey of ids) {
    mocks.resolve.mockResolvedValueOnce({
      panel: { manifest: { state: {}, members: {} } },
      member: { inputs: { app: { literal: { className: APPLICATION, primaryKey } } } },
      projection: {
        inputs: { app: { kind: "object", objectType: APPLICATION } },
        operations: { deleteApp: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { input: "app" } } },
      },
      inputs: {},
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: { canMaintain: true } },
    { status: "ready", payload: { canMaintain: false } },
    { status: "error", code: "APPLICATION_NOT_FOUND", error: "Application unavailable" },
    { status: "forbidden", error: "Placement denied" },
    { status: "error", error: "Catalogue failed" },
    { status: "ready", payload: { canMaintain: "yes" } },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, ids.map(() => opRequest));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(results).toMatchObject([
    { status: "ready", value: { deleteApp: { handlerRef: "applications.delete" } } },
    { status: "ready", value: { deleteApp: { unavailable: { reason: en["panels.productCatalog.application.readOnly"] } } } },
    { status: "ready", value: { deleteApp: { unavailable: { reason: en["panels.productCatalog.application.availabilityUnavailable"] } } } },
    { status: "forbidden", reason: "Placement denied" },
    { status: "error", message: "Catalogue failed" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
  ]);
  expect(results[0]).not.toHaveProperty("value.deleteApp.unavailable");
  const calls = mocks.read.mock.lastCall![1] as JavaPanelRead[];
  expect(calls.map(({ call }) => call)).toEqual(ids.map(primaryKey => ({
    type: APPLICATION, name: "deleteAvailability", parameters: { primaryKey },
  })));
  expect(fetch).not.toHaveBeenCalled();
});

it("describes fixed governance delete targets from the owner batch without requesting row availability", async () => {
  const targets = [
    { slot: "deletePolicy", operation: DELETE_PERMISSION_POLICY, type: PERMISSION_POLICY, id: "reserved" },
    { slot: "orgHeader", operation: DELETE_ORG_UNIT, type: ORG_UNIT, id: "team" },
    { slot: "deletePolicy", operation: DELETE_PERMISSION_POLICY, type: PERMISSION_POLICY, id: "outside" },
    { slot: "orgHeader", operation: DELETE_ORG_UNIT, type: ORG_UNIT, id: "denied" },
    { slot: "removeMembership", operation: REMOVE_ORG_MEMBERSHIP, type: ORG_MEMBERSHIP, id: "org-member" },
    { slot: "deletePosition", operation: DELETE_ORG_POSITION, type: ORG_POSITION, id: "org-position" },
  ];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { type, operation, id } of targets) {
    mocks.resolve.mockResolvedValueOnce({
      panel: { manifest: { state: {}, members: {} } },
      member: { inputs: { target: { literal: { className: type, primaryKey: id } } } },
      projection: {
        inputs: { target: { kind: "object", objectType: type } },
        operations: { delete: { operation: { kind: "PlatformOperation", id: operation }, target: { input: "target" } } },
      },
      inputs: {},
    });
  }
  mocks.resolve.mockResolvedValueOnce({
    panel: { manifest: { state: {}, members: {} } }, member: {}, inputs: {},
    projection: { operations: { deletePolicy: {
      operation: { kind: "PlatformOperation", id: DELETE_PERMISSION_POLICY }, target: { row: true },
    } } },
  });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: { reason: "Reserved policy" } },
    { status: "ready", payload: { reason: null } },
    { status: "error", code: "POLICY_NOT_FOUND", error: "Policy not found" },
    { status: "forbidden", error: "Organization read denied" },
    { status: "ready", payload: { reason: null } },
    { status: "ready", payload: { reason: "Position has roles" } },
    { status: "ready" },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [...targets.map(({ slot }) => slot), "policiesList"].map(member =>
    ({ source, memberPath: [{ member }], operations: true, inputs: {} })));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(results).toMatchObject([
    { status: "ready", value: { delete: { handlerRef: DELETE_PERMISSION_POLICY, unavailable: { reason: "Reserved policy" } } } },
    { status: "ready", value: { delete: { handlerRef: DELETE_ORG_UNIT, inspectImpact: { handlerRef: `${DELETE_ORG_UNIT}.inspect-impact` } } } },
    { status: "error", code: "POLICY_NOT_FOUND", message: "Policy not found" },
    { status: "forbidden", reason: "Organization read denied" },
    { status: "ready", value: { delete: { handlerRef: REMOVE_ORG_MEMBERSHIP } } },
    { status: "ready", value: { delete: { handlerRef: DELETE_ORG_POSITION, unavailable: { reason: "Position has roles" } } } },
    { status: "ready", value: { deletePolicy: { target: { source: "row" } } } },
  ]);
  expect(results[1]).not.toHaveProperty("value.delete.unavailable");
  expect(results[4]).not.toHaveProperty("value.delete.unavailable");
  const calls = mocks.read.mock.lastCall![1] as JavaPanelRead[];
  expect(calls.map(({ call }) => call)).toEqual([
    ...targets.map(({ type, id }) => ({ type, name: "deleteRefusal", parameters: { primaryKey: id } })), undefined,
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("describes the role detail delete operation using the selected role's delete refusal", async () => {
  const selections = [
    { primaryKey: "empty-role", reason: null },
    { primaryKey: "assigned-role", reason: "Role still has members" },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { primaryKey } of selections) {
    mocks.resolve.mockResolvedValueOnce({
      panel: { manifest: { state: {}, members: {} } },
      member: { inputs: { role: { literal: { className: ROLE, primaryKey } } } },
      projection: {
        inputs: { role: { kind: "object", objectType: ROLE } },
        operations: { delete: { operation: { kind: "PlatformOperation", id: DELETE_ROLE }, target: { input: "role" } } },
      },
      inputs: {},
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: selections.map(({ reason }) => ({ status: "ready", payload: { reason } })) });

  const prepared = await prepareRegisteredDataReads(credentials, selections.map(() => ({
    source, memberPath: [{ member: "deleteBtn" }], operations: true, inputs: {},
  })));
  const [deletable, assigned] = await runPreparedDataReads(credentials, prepared);
  expect(deletable).toMatchObject({ status: "ready", value: { delete: { handlerRef: DELETE_ROLE } } });
  expect(deletable).not.toHaveProperty("value.delete.unavailable");
  expect(assigned).toHaveProperty("value.delete.unavailable.reason", "Role still has members");
  expect((mocks.read.mock.lastCall![1] as JavaPanelRead[]).map(({ call }) => call))
    .toEqual(selections.map(({ primaryKey }) => ({ type: ROLE, name: "deleteRefusal", parameters: { primaryKey } })));
});

it("describes all role assignment operations with the selected role's owner refusal", async () => {
  const bindings = { addMembers: ADD_ROLE_MEMBERS, removeMembers: REMOVE_ROLE_MEMBERS,
    addPolicies: ADD_ROLE_POLICIES, removePolicies: REMOVE_ROLE_POLICIES };
  const selections = [
    { primaryKey: "ordinary", result: { status: "ready", payload: { reason: null } } },
    { primaryKey: "reserved", result: { status: "ready", payload: { reason: "Managed by domain membership" } } },
    { primaryKey: "missing", result: { status: "error", code: "ROLE_NOT_FOUND", error: "Role not found" } },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { primaryKey } of selections) {
    mocks.resolve.mockResolvedValueOnce({
      panel: { manifest: { state: {}, members: {} } },
      member: { inputs: { role: { literal: { className: ROLE, primaryKey } } } },
      projection: {
        inputs: { role: { kind: "object", objectType: ROLE } },
        operations: Object.fromEntries(Object.entries(bindings).map(([name, id]) =>
          [name, { operation: { kind: "PlatformOperation", id }, target: { input: "role" } }])),
      },
      inputs: {},
    });
  }
  // Each assignment operation names the same refusal read; the batch reader sends it once per role.
  mocks.read.mockImplementationOnce(async (_viewer, reads: JavaPanelRead[]) => ({ viewer, results: reads.map(({ call }) =>
    selections.find(({ primaryKey }) => primaryKey === call!.parameters.primaryKey)!.result) }));

  const prepared = await prepareRegisteredDataReads(credentials, selections.map(() => ({
    source, memberPath: [{ member: "roleAssignments" }], operations: true, inputs: {},
  })));
  const [ordinary, reserved, missing] = await runPreparedDataReads(credentials, prepared);
  expect(ordinary).toMatchObject({ status: "ready", value: Object.fromEntries(Object.entries(bindings)
    .map(([name, handlerRef]) => [name, { handlerRef }])) });
  for (const name of Object.keys(bindings)) {
    expect(ordinary).not.toHaveProperty(`value.${name}.unavailable`);
    expect(reserved).toHaveProperty(`value.${name}.unavailable.reason`, "Managed by domain membership");
  }
  expect(missing).toEqual({ status: "error", code: "ROLE_NOT_FOUND", message: "Role not found" });
  expect((mocks.read.mock.lastCall![1] as JavaPanelRead[]).map(({ call }) => call)).toEqual(selections.flatMap(({ primaryKey }) =>
    Object.keys(bindings).map(() => ({ type: ROLE, name: "assignRefusal", parameters: { primaryKey } }))));
});

it("keeps application entries and a masked missing application as separate batch items", async () => {
  const primaryKey = "app-shipping";
  const missing = "app-missing";
  const absentMessage = "Application unavailable";
  const entries = {
    applicationId: primaryKey,
    entry: { path: "/applications/app-shipping", home: "/applications/app-shipping/overview", entryKey: "overview" },
    panelUses: [{ id: "overview", names: { en: "overview" }, pageKey: "shipping:overview", panelId: "panel-shipping", path: "/applications/app-shipping/overview" }],
    groups: [],
    framePanelId: "panel-frame",
    theme: { light: { accent: "#123456" } },
  };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const id of [primaryKey, missing]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "applicationEntries" },
      selection: { typeId: APPLICATION, method: "entries", primaryKey: id },
      params: {},
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: entries },
    { status: "error", error: absentMessage },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([
    { status: "ready", value: entries },
    { status: "error", message: absentMessage },
  ]);
  expect(mocks.read).toHaveBeenLastCalledWith(viewer, [primaryKey, missing].map(id => expect.objectContaining({
    call: { type: APPLICATION, name: "entries", parameters: { primaryKey: id } },
  })), credentials);
  expect(fetch).not.toHaveBeenCalled();
});

it("names admitted application entry rows with same-item USE or EDIT and local default agent options", async () => {
  const primaryKey = "app-shipping";
  const path = "/applications/app-shipping";
  const panelUse = (id: string) => ({ id, names: { en: String(id) }, pageKey: `shipping:${id}`, path: `${path}/${id}`, panelId: `panel-${id}` });
  const panelUses = [
    {
      ...panelUse("overview"), names: { en: "Overview" }, groupKey: "main",
      defaultAgent: { kind: "id", id: "agent-enabled" },
    },
    { ...panelUse("manage"), defaultAgent: { kind: "id", id: "agent-disabled" } },
    { ...panelUse("hidden-name"), groupKey: "unavailable-group" },
  ];
  const definitions = [
    ["panel-overview", "Shipping overview"], ["panel-manage", "Shipping management"], ["panel-hidden-name", "Hidden name"],
  ];
  const time = new Date("2026-11-26T00:00:00Z");
  mocks.currentProducts.mockResolvedValueOnce(new Map(definitions.map(([id, name]) => [id, {
    id, domainId: viewer.domainId, ownerId: "author", revision: 1, createdAt: time, updatedAt: time,
    definition: { name, description: "", visibility: "domain", content: { html: "<div />" }, manifest: { state: {}, members: {} } },
  }])));
  mocks.agents.mockClear().mockResolvedValueOnce([
    { id: "agent-enabled", kind: "custom-analyst", name: "Shipping analyst", enabled: true },
    { id: "agent-disabled", kind: "custom-analyst", name: "Disabled label", enabled: false },
  ]);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const id of [primaryKey, "app-missing"]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecordList" },
      selection: { typeId: APPLICATION, method: "entryRows", primaryKey: id },
      params: {},
    });
  }
  const range = (id: string) => ({ fixed: false, all: false, objectIds: [id], authorId: null });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    {
      status: "ready", payload: { panelUses, groups: [{ key: "main", names: { en: "Main group" }, sort: 0 }], canEditEntries: true },
      visibility: { PANEL: { USE: range("panel-overview"), EDIT: range("panel-manage") } },
    },
    { status: "error", error: "Application unavailable" },
  ] });
  const prepared = await prepareRegisteredDataReads(credentials, [request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: [
      { primaryKey: "overview", label: "Overview", fields: {
        group: "Main group", panel: { label: "Shipping overview" }, defaultAgent: "Shipping analyst", canEdit: true,
      } },
      { primaryKey: "manage", label: "manage", fields: {
        panel: { label: "Shipping management" }, defaultAgent: "agent-disabled", canEdit: true,
      } },
      { primaryKey: "hidden-name", fields: { panel: { label: "panel-hidden-name" }, group: "unavailable-group" } },
    ] },
    { status: "error", message: "Application unavailable" },
  ]);
  expect(mocks.read).toHaveBeenLastCalledWith(viewer, [primaryKey, "app-missing"].map(id => expect.objectContaining({
    call: { type: APPLICATION, name: "entryRows", parameters: { primaryKey: id } },
    visibleKinds: [{ kind: "PANEL", verbs: ["USE", "EDIT"] }],
  })), credentials);
  expect(mocks.currentProducts).toHaveBeenCalledWith(viewer.domainId, "panel", panelUses.map(use => use.panelId));
  expect(mocks.agents.mock.calls).toEqual([[viewer.domainId]]);
  expect(fetch).not.toHaveBeenCalled();
});

it("admits the builder create form and merges only batch-maintainable projects with the reader's drafts", async () => {
  const { appBuilderProjectStore } = await import("../../app-builder/project-store");
  const { RuntimeClient } = await import("../../../infrastructure/agent-runtime/client");
  const javaHttp = vi.spyOn(await import("../../../utils/backend-client"), "backendGet")
    .mockRejectedValue(new Error("Unexpected separate Java read"));
  const updatedAt = "2026-11-26T00:00:00Z";
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const projectMeta = { names: { en: "Match draft" }, descriptions: {}, icon: "box" };
  const drafts = vi.spyOn(appBuilderProjectStore, "listDraftsByCreator").mockResolvedValue([{
    domainId: viewer.domainId, appId: "app-draft", workspaceId, createdBy: viewer.userId, draftMeta: projectMeta,
    createdAt: updatedAt, updatedAt, lastSyncedFingerprint: null, lastSyncedCommit: null,
  }]);
  const projects = vi.spyOn(appBuilderProjectStore, "listByAppIds").mockResolvedValue(new Map());
  const workspace = vi.spyOn(RuntimeClient.prototype, "request").mockResolvedValue({
    id: workspaceId, name: "Match draft", headCommit: "a".repeat(40), activeRunId: workspaceId,
    createdAt: updatedAt, updatedAt,
  });
  const navigation = {
    id: "app-builder", kind: "native", names: { en: "App Builder" }, descriptions: {}, icon: "box",
    rail: "top", category: "build", sort: 0, entry: { path: "/app-builder" }, scheduleAdapter: null, releaseId: null,
  };
  const cases = [
    { method: "builderCreateForm", result: "panelFormDescription", params: { values: { name: "Local draft" } },
      reply: { status: "ready", payload: [navigation] } },
    { method: "builderCreateForm", result: "panelFormDescription", params: {},
      reply: { status: "ready", payload: [] } },
    { method: "builderProjects", result: "panelRecordList", params: { search: "Match" },
      reply: { status: "forbidden", error: "Application access denied" } },
    { method: "builderProjects", result: "panelRecordList", params: { search: "Match" },
      reply: { status: "ready", payload: [{ ...projectMeta, id: "app-live", names: { en: "Match live" },
        canEditEntries: true, updatedAt: "2026-11-27T00:00:00Z" }] } },
  ];
  const operations = {
    deleteDraft: { operation: { kind: "PlatformOperation", id: APPLICATION_DELETE_DRAFT }, target: { row: true } },
    deletePublished: { operation: { kind: "PlatformOperation", id: "applications.delete" }, target: { row: true } },
  };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { method, result, params } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {
      inputs: {}, data: { rows: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: method } }, operations,
    } });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, inputs: {}, selection: { typeId: APPLICATION, method } });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(drafts).not.toHaveBeenCalled();
    expect(workspace).not.toHaveBeenCalled();
    return { viewer, results: cases.map(({ reply }) => reply) };
  });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
      { status: "ready", value: { values: { name: "Local draft" }, save: { path: "/api/app-builder/projects" } } },
      { status: "forbidden", reason: "Application access denied" },
      { status: "forbidden", reason: "Application access denied" },
      { status: "ready", value: [
        { primaryKey: "app-live", fields: { published: true, workspaceId: "", busy: false } },
        { primaryKey: "app-draft", fields: { published: false, workspaceId, busy: true } },
      ], rowOperations: { [APPLICATION + ":app-draft"]: { deleteDraft: { available: false } } } },
    ]);
    expect(mocks.read.mock.lastCall![1].map(({ call }: { call?: unknown }) => call)).toEqual([
      { type: APPLICATION, name: "navigation", parameters: {} },
      { type: APPLICATION, name: "navigation", parameters: {} },
      { type: APPLICATION, name: "builderProjects", parameters: { search: "Match" } },
      { type: APPLICATION, name: "builderProjects", parameters: { search: "Match" } },
    ]);
    expect(drafts.mock.calls).toEqual([[viewer.domainId, viewer.userId]]);
    expect(projects.mock.calls).toEqual([[viewer.domainId, ["app-live"]]]);
    expect(javaHttp).not.toHaveBeenCalled();
  } finally {
    workspace.mockRestore();
    projects.mockRestore();
    drafts.mockRestore();
    javaHttp.mockRestore();
  }
});

it("keeps selected builder reads on their original draft or published authority without creating projects", async () => {
  const { appBuilderProjectStore } = await import("../../app-builder/project-store");
  const { assistantService } = await import("../../assistant/service");
  const { RuntimeClient } = await import("../../../infrastructure/agent-runtime/client");
  const javaHttp = vi.spyOn(await import("../../../utils/backend-client"), "backendGet")
    .mockRejectedValue(new Error("Unexpected separate Java read"));
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const time = "2026-11-26T00:00:00Z";
  const meta = { names: { en: "Published app" }, descriptions: { en: "Catalogue description" }, icon: "box" };
  const project = {
    domainId: viewer.domainId, appId: "app-bound", workspaceId, createdBy: viewer.userId, draftMeta: null,
    createdAt: time, updatedAt: time, lastSyncedFingerprint: null, lastSyncedCommit: null,
  };
  const draft = { ...project, appId: "app-draft", draftMeta: { ...meta, names: { en: "My draft" } } };
  const other = { ...draft, appId: "app-other", createdBy: "different-author" };
  const lookup = vi.spyOn(appBuilderProjectStore, "findByAppId")
    .mockImplementation(async (_domain, appId) => [project, draft, other].find(row => row.appId === appId) ?? null);
  const insert = vi.spyOn(appBuilderProjectStore, "insertProject").mockRejectedValue(new Error("Unexpected project creation"));
  const sessions = vi.spyOn(assistantService, "list").mockResolvedValue({ sessions: [], nextCursor: null });
  const workspace = vi.spyOn(RuntimeClient.prototype, "request").mockResolvedValue({
    id: workspaceId, name: "My draft", headCommit: "a".repeat(40), activeRunId: null, createdAt: time, updatedAt: time,
  });
  const cases = [
    { method: "builderMetaForm", primaryKey: draft.appId, result: "panelFormDescription", params: { values: { name: "Edited draft" } },
      reply: { status: "ready" } },
    { method: "builderSessions", primaryKey: other.appId, result: "panelRecordQuery", params: {},
      reply: { status: "ready" } },
    { method: "builderSessions", primaryKey: project.appId, result: "panelRecordQuery", params: { size: 6 },
      reply: { status: "ready", payload: meta } },
    { method: "builderSessions", primaryKey: "app-no-project", result: "panelRecordQuery", params: {},
      reply: { status: "ready", payload: meta } },
    { method: "builderMetaForm", primaryKey: "app-no-project", result: "panelFormDescription", params: {},
      reply: { status: "ready", payload: meta } },
    { method: "builderMetaForm", primaryKey: "app-readonly", result: "panelFormDescription", params: {},
      reply: { status: "forbidden", error: "Application cannot be edited in App Builder" } },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { method, primaryKey, result, params } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection: { typeId: APPLICATION, method, primaryKey } });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(sessions).not.toHaveBeenCalled();
    expect(workspace).not.toHaveBeenCalled();
    return { viewer, results: cases.map(({ reply }) => reply) };
  });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
      { status: "ready", value: { values: { name: "Edited draft" }, save: { path: "/api/app-builder/projects/app-draft/meta" } } },
      { status: "error", code: "NOT_FOUND" },
      { status: "ready", value: { rows: [], hasMore: false } },
      { status: "ready", value: { rows: [], hasMore: false } },
      { status: "ready", value: { values: { name: "Published app", description: "Catalogue description" } } },
      { status: "forbidden", reason: "Application cannot be edited in App Builder" },
    ]);
    expect(mocks.read.mock.lastCall![1].map(({ call }: { call?: unknown }) => call)).toEqual([
      undefined, undefined, ...cases.slice(2).map(({ primaryKey }) => ({
        type: APPLICATION, name: "builderProjectMetadata", parameters: { primaryKey },
      })),
    ]);
    // The placements are planned concurrently; each looks its project up once.
    expect(lookup.mock.calls.map(([, appId]) => appId).sort()).toEqual(cases.map(({ primaryKey }) => primaryKey).sort());
    expect(lookup.mock.calls.every(([domainId]) => domainId === viewer.domainId)).toBe(true);
    expect(sessions.mock.calls).toEqual([[viewer, { workspaceId, cursor: undefined, limit: 6 }]]);
    expect(workspace.mock.calls).toEqual([["/v1/workspaces/" + workspaceId]]);
    expect(insert).not.toHaveBeenCalled();
    expect(javaHttp).not.toHaveBeenCalled();
  } finally {
    workspace.mockRestore();
    sessions.mockRestore();
    insert.mockRestore();
    lookup.mockRestore();
    javaHttp.mockRestore();
  }
});

it("presents admitted application forms with existing draft IDs and domain agent choices", async () => {
  const primaryKey = "app-source";
  const target = { kind: "object", objectType: APPLICATION, primaryKey };
  const copyEntry = { path: "/applications/app-copy", renderer: "panels" };
  const partial = { names: { fr: "Brouillon" } };
  const checks = [
    { method: "form", primaryKey, params: { section: "identity", values: partial, changedField: "/names" } },
    { method: "form", primaryKey, params: { section: "entry", entryId: "__copy__", values: { id: "app-copy", entry: copyEntry } } },
    { method: "createForm", params: {} },
    { method: "form", primaryKey, params: { section: "entries" } },
  ];
  const field = {
    path: "/defaultAgent", label: "Assistant", valueSchema: {}, required: false, readOnly: false,
    control: { kind: "select", options: [] },
  };
  const draft = (id: string) => ({
    fields: [{
      path: "/panelUses", label: "Entries", valueSchema: {}, required: true, readOnly: false,
      control: { kind: "object-array", itemFields: [field] },
    }],
    values: { entry: { path: `/applications/${id}`, renderer: "panels" }, panelUses: [] },
    save: { method: "PUT", path: `/platform/applications/${id}/panel-uses?create=true`, bodySchema: {} },
    errors: [],
  });
  const identity = {
    fields: [], values: { ...partial, descriptions: { en: "Saved description" }, icon: "pages" },
    save: { method: "PUT", path: "/platform/applications/app-source/identity", bodySchema: {} },
    errors: [],
  };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.agents.mockClear().mockResolvedValue([
    { id: "agent-analyst", kind: "custom-analyst", name: "Analyst", enabled: true },
    { id: "agent-disabled", kind: "custom-analyst", name: "Disabled", enabled: false },
  ]);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { params, ...selection } of checks) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelFormDescription" }, params, selection: { typeId: APPLICATION, ...selection },
    });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(mocks.agents).not.toHaveBeenCalled();
    return { viewer, results: [
      { status: "ready", payload: identity },
      { status: "ready", payload: draft("app-copy") },
      { status: "ready", payload: draft("app-new") },
      { status: "forbidden", error: "Application access denied" },
    ] };
  });

  const prepared = await prepareRegisteredDataReads(credentials, checks.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: identity },
    {
      status: "ready", value: {
        values: { id: "app-copy", entry: copyEntry },
        fields: [{ control: { itemFields: [{
          path: "/defaultAgent", control: { options: [{ value: { kind: "id", id: "agent-analyst" }, label: "Analyst" }] },
        }] } }],
      },
    },
    { status: "ready", value: { values: { id: "app-new" } } },
    { status: "forbidden", reason: "Application access denied" },
  ]);
  const calls = mocks.read.mock.lastCall![1].map(({ call }: { call: unknown }) => call);
  expect(calls).toEqual([
    { type: APPLICATION, name: "form", parameters: {
      section: "identity", target, values: partial, changedField: "/names", mergeCurrentValues: true,
    } },
    { type: APPLICATION, name: "form", parameters: {
      section: "create", target, values: { entry: copyEntry }, changedField: null, mergeCurrentValues: false,
    } },
    { type: APPLICATION, name: "createForm", parameters: {
      section: "create", target: { kind: "draft" }, changedField: null, mergeCurrentValues: false,
    } },
    { type: APPLICATION, name: "form", parameters: {
      section: "entries", target, changedField: null, mergeCurrentValues: false,
    } },
  ]);
  expect(mocks.agents.mock.calls).toEqual([[viewer.domainId], [viewer.domainId]]);
  expect(fetch).not.toHaveBeenCalled();
});

it("presents Java model records and member row operations from the same registered batch", async () => {
  const rowOperations = Object.fromEntries(Object.entries({
    deleteMember: REMOVE_USER,
    issue: GENERATE_USER_API_KEY,
    resend: REGENERATE_USER_API_KEY,
    revoke: REVOKE_USER_API_KEY,
    reset: RESET_USER_PASSWORD,
  }).map(([name, id]) => [name, { operation: { kind: "PlatformOperation", id }, target: { row: true } }]));
  // A fixed target is described with the member's operations, not per row.
  const operations = {
    ...rowOperations,
    removeFixed: { operation: { kind: "PlatformOperation", id: REMOVE_USER }, target: { literal: { className: USER, primaryKey: "u2" } } },
  };
  const view = { relationship: "owns", fromclass: "Device", toclass: "Site", desc: "", fromField: "site", toField: "id" };
  const query = { total: 1, rows: [{ primaryKey: "u1", label: "Alice", fields: {} }] };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: { operations } });
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecord" }, inputs: {}, params: {},
    selection: { typeId: RELATIONSHIP, method: "record", primaryKey: view.relationship },
  });
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordQuery", rowType: USER }, inputs: {}, params: { page: { number: 1, size: 20 } },
    selection: { typeId: USER, method: "query" },
  });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: withReadDirective({ view, fieldLabels: { fromField: "Source field" } }, { rereadAfterMs: 500 }) },
    { status: "ready", payload: { query, rowRefusals: { u1: {
      remove: "Built-in administrator", generateApiKey: "Key exists", regenerateApiKey: null, revokeApiKey: null, resetPassword: null,
    }, u2: { remove: "Protected external member" } } } },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([
    { status: "ready", rereadAfterMs: 500, value: expect.objectContaining({
      primaryKey: "owns", fieldLabels: expect.objectContaining({ fromField: "Source field" }),
      outputs: { modelingPath: panelAddress("/ontology/visual-modeling", { selectedEdge: "owns", back: "playground" }) },
    }) },
    { status: "ready", value: query, rowOperations: { "platform:User:u1": {
      deleteMember: { available: false, unavailable: { reason: "Built-in administrator" } },
      issue: { available: false, unavailable: { reason: "Key exists" } },
      resend: { available: true }, revoke: { available: true }, reset: { available: true },
    } } },
  ]);
  expect(mocks.read.mock.lastCall?.[1][1]).toMatchObject({
    call: { type: USER, name: "query", parameters: { page: { number: 1, size: 20 }, inspectApiKeyRows: true } },
  });
  expect(mocks.read.mock.lastCall?.[1][1].call.parameters).not.toHaveProperty("fixedRowTargets");
});

it("presents removals for the four governance lists from the same owner batch", async () => {
  const cases = [
    { typeId: ROLE, method: "query", rowType: ROLE, id: DELETE_ROLE, button: "deleteRole" },
    { typeId: PERMISSION_POLICY, method: "query", rowType: PERMISSION_POLICY, id: DELETE_PERMISSION_POLICY, button: "deletePolicy" },
    { typeId: ORG_UNIT, method: "members", rowType: ORG_MEMBERSHIP, id: REMOVE_ORG_MEMBERSHIP, button: "removeMember" },
    { typeId: ORG_UNIT, method: "positions", rowType: ORG_POSITION, id: DELETE_ORG_POSITION, button: "deletePosition" },
  ];
  const rows = [
    { primaryKey: "blocked", label: "Blocked", fields: {} },
    { primaryKey: "allowed", label: "Allowed", fields: {} },
  ];
  const results: JavaPanelReadResult[] = [];
  const calls = [];
  const expected = [];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { typeId, method, rowType, id, button } of cases) {
    const query = method === "query";
    const value = query ? { rows, total: 23 } : rows;
    const params = query ? { search: "filtered", page: { number: 2, size: 5 } } : {};
    const primaryKey = query ? {} : { primaryKey: "selected-unit" };
    const operations = { [button]: { operation: { kind: "PlatformOperation", id }, target: { row: true } } };
    // The list carries its rows' removal refusal only when the page binds the removal to rows.
    for (const bound of [true, false]) {
      mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {
        data: { rows: { source: { type: { kind: "PlatformObjectType", id: rowType } }, read: method } },
        operations: bound ? operations : {},
      } });
      mocks.prepare.mockResolvedValueOnce({
        declaration: { result: query ? "panelRecordQuery" : "panelRecordList", ...(!query && { rowType }) },
        selection: { typeId, method, ...primaryKey }, params, inputs: {},
      });
      results.push({ status: "ready", payload: bound ? { value, rowRefusals: { blocked: "Owner reason", allowed: null } } : value });
      calls.push({ type: typeId, name: method, parameters: { ...params, ...primaryKey, ...(bound && { inspectRowRemoval: true }) } });
      expected.push({ status: "ready", value, ...(bound && { rowOperations: {
        [`${rowType}:blocked`]: { [button]: { available: false, unavailable: { reason: "Owner reason" } } },
        [`${rowType}:allowed`]: { [button]: { available: true } },
      } }) });
    }
  }
  mocks.read.mockResolvedValueOnce({ viewer, results });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const prepared = await prepareRegisteredDataReads(credentials, results.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toEqual(expected);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read.mock.lastCall?.[1].map(({ call }: JavaPanelRead) => call)).toEqual(calls);
  expect(fetch).not.toHaveBeenCalled();
});

it("presents owner facts with the compiled search, cursor and selected object in one registered batch", async () => {
  const metrics = [
    { id: "m1", name: "Revenue" },
    { id: "m2", name: "Net revenue", statusLabel: "Published" },
    { id: "m3", name: "Gross revenue" },
    { id: "m4", name: "Returns" },
  ];
  const cases = [
    {
      selection: { typeId: ACTION, method: "derivedSummary", primaryKey: "approve" },
      params: {}, result: "panelRecord",
      payload: withReadDirective({ definition: { version: 1, source: "DERIVED", verified: false, name: "Approve" } }, { rereadAfterMs: 500 }),
    },
    {
      selection: { typeId: FUNCTION, method: "list" },
      params: { search: "STOCK", operation: "READ" }, result: "panelRecordQuery",
      payload: [{ id: "stock", name: "Check stock", operationLabel: "Read" }, { id: "ship", name: "Ship" }],
    },
    {
      selection: { typeId: METRIC_VIEW, method: "query" },
      params: { search: "revenue", cursor: "1", size: 1, status: "PUBLISHED" }, result: "panelRecordQuery",
      payload: metrics,
    },
    {
      selection: { typeId: METRIC_VIEW, method: "query" },
      params: { cursor: "invalid" }, result: "panelRecordQuery", payload: metrics,
    },
    {
      selection: { typeId: WORKFLOW, method: "grantInForce", primaryKey: "restock" },
      params: {}, result: "panelRecordList",
      payload: {
        actions: [{ id: "stock", name: "Check stock" }],
        grants: [
          { workflowId: "restock", roleCode: "buyer", capabilityId: "stock", stepNo: 2, scope: { kind: "all" }, inForce: true },
          { workflowId: "other", roleCode: "other", capabilityId: "stock", scope: { kind: "all" }, inForce: true },
        ],
      },
    },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { selection, params, result } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(({ payload }) => ({ status: "ready", payload })) });

  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", rereadAfterMs: 500, value: { primaryKey: "approve", label: "Approve" } },
    { status: "ready", value: { rows: [{ primaryKey: "stock", fields: { operation: "Read" } }], total: 1 } },
    { status: "ready", value: { rows: [{ primaryKey: "m2", fields: { status: "Published" } }], nextCursor: "2", total: 3 } },
    { status: "error", code: "INVALID_CURSOR" },
    { status: "ready", value: [{ primaryKey: "buyer", fields: { capabilities: ["Check stock · 2 · All readable objects"] } }] },
  ]);
  expect(mocks.read.mock.lastCall?.[1].map((read: { call: unknown }) => read.call)).toEqual(
    cases.map(({ selection, params }) => ({
      type: selection.typeId, name: selection.method,
      parameters: { ...params, ...(selection.primaryKey && { primaryKey: selection.primaryKey }) },
    })),
  );
});

it("localizes a missing workflow while preserving other owner errors and refusals", async () => {
  const localizedCredentials = { ...credentials, locale: "fr" };
  const missing = { status: "error", code: "WORKFLOW_NOT_FOUND", error: "Workflow not found" };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const method of ["grantCaseScopedSteps", "grantDirect", "grantInForce", "grantSuperseded"]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecordList" }, params: {}, selection: { typeId: WORKFLOW, method, primaryKey: "restock" },
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    missing, missing,
    { status: "error", code: "PANEL_READ_ERROR", error: "The owner read failed" },
    { status: "forbidden", error: "Owner denied workflow grants" },
  ] });

  const prepared = await prepareRegisteredDataReads(localizedCredentials, Array(4).fill(request));
  expect(await runPreparedDataReads(localizedCredentials, prepared)).toEqual([
    { status: "error", code: "WORKFLOW_NOT_FOUND", message: localizedWorkflowNotFound },
    { status: "error", code: "WORKFLOW_NOT_FOUND", message: localizedWorkflowNotFound },
    { status: "error", code: "PANEL_READ_ERROR", message: "The owner read failed" },
    { status: "forbidden", reason: "Owner denied workflow grants" },
  ]);
});

it("plans operation descriptions with registered data, preserving siblings of malformed items", async () => {
  const operationsRequest: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const fixed = { className: USER, primaryKey: "fixed-member" };
  const checked = [fixed, { className: USER, primaryKey: "ordinary-member" }];
  const binding = (id: string) => ({ kind: "PlatformOperation", id });
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockImplementationOnce(async (_viewer, _credentials, _request, _cache, collectUse) => {
    collectUse("projection", { id: "member-buttons", domainId: viewer.domainId, ownerId: "author" });
    return {
      inputs: {},
      panel: { manifest: { state: {}, members: {} } },
      member: { inputs: { selected: { literal: fixed }, checked: { literal: checked } } },
      projection: { inputs: {
        selected: { kind: "object", objectType: USER },
        checked: { kind: "list", items: { kind: "object", objectType: USER } },
      }, operations: {
        remove: { operation: binding(REMOVE_USER), target: { input: "selected" } },
        removeChecked: { operation: binding(REMOVE_USER), target: { input: "checked" } },
        reset: { operation: binding(RESET_USER_PASSWORD), target: { rowField: "member" } },
      } },
    };
  });
  for (let i = 0; i < 3; i++) mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockImplementationOnce(() => z.string().parse(42));
  mocks.prepare.mockResolvedValueOnce({ declaration: { result: "panelRecordQuery" }, params: {}, selection: { typeId: OBJECT_TYPE, method: "count" } });
  mocks.prepare.mockResolvedValueOnce({ declaration: { result: "panelRecordQuery" }, params: {}, selection: { typeId: OBJECT_TYPE, method: "count" } });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: { [REMOVE_USER]: ["Protected member"] } },
    { status: "ready", payload: { [REMOVE_USER]: ["Protected member", null] } },
    { status: "ready" },
    { status: "ready", payload: { rows: 1 } },
    { status: "ready", payload: { rows: [], total: 1 } },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [operationsRequest, request, request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: {
      remove: { handlerRef: REMOVE_USER, target: { source: "input", input: "selected" }, unavailable: { reason: "Protected member" } },
      removeChecked: { handlerRef: REMOVE_USER, target: { source: "input", input: "checked" } },
      reset: { handlerRef: RESET_USER_PASSWORD, target: { source: "row" } },
    } },
    { status: "error", code: "PANEL_READ_INPUT_INVALID" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    { status: "ready", value: { rows: [], total: 1 } },
  ]);
  // Each binding reads its own targets' refusals; the selection's is decided by the all-refused rule.
  expect(mocks.read.mock.lastCall?.[1].slice(0, 2)).toMatchObject([["fixed-member"], ["fixed-member", "ordinary-member"]].map(ids => ({
    uses: [{ target: { kind: "PROJECTION", id: "member-buttons", domainId: viewer.domainId } }],
    call: { type: USER, name: "operationRefusals", parameters: { inspections: [{ name: REMOVE_USER, operation: REMOVE_USER, ids }] } },
  })));
});

it("does not accept identity or registration claims in the browser's request", () => {
  expect(productPanelReadRequestSchema.safeParse(request).success).toBe(true);
  expect(productPanelReadRequestSchema.safeParse({ ...request, registration: entry, viewer }).success).toBe(false);
  expect(productPanelReadRequestSchema.safeParse({ ...request, source: { ...source, rootPanelId: entry.use.panelId } }).success).toBe(false);
});

it("joins mixed operation facts in one read batch and keeps binding skips separate from item failures", async () => {
  const operationsRequest: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const order = { className: "Order", primaryKey: "order-42" };
  const orderPort = { kind: "object", objectType: "Order" };
  const dynamic = (id: string, target?: object) => ({ operation: { kind: "Action", id }, target });
  const platform = (id: string, className: string, primaryKey: string) => ({
    operation: { kind: "PlatformOperation", id }, target: { literal: { className, primaryKey } },
  });
  const operations = {
    approve: dynamic("approve", { literal: order }),
    create: dynamic("create"),
    unselected: dynamic("unselected", { input: "pending" }),
    denied: dynamic("denied", { literal: order }),
    status: platform(SET_ACTION_STATUS, ACTION, "draft-action"),
    removeAction: platform(DELETE_ACTION, ACTION, "draft-action"),
    removeFunction: platform(DELETE_FUNCTION, FUNCTION, "function-1"),
    removeMetric: platform(DELETE_METRIC_VIEW, METRIC_VIEW, "metric-1"),
    removeMember: platform(REMOVE_USER, USER, "user-1"),
  };
  const placement = (bound: object) => ({
    inputs: {},
    panel: { manifest: { state: { pending: { type: orderPort } }, members: {} } },
    member: { inputs: { pending: { state: "pending" } } },
    projection: { inputs: { pending: orderPort }, operations: bound },
  });
  const execution = {
    id: "approve", name: "Approve", codeHash: "hash", target: { className: "Order", keyParameter: "order_id" },
    function: { parameters: [{ name: "order_id", type: "TYPE_STRING" }, { name: "amount", type: "TYPE_NUMBER", description: "Amount" }] },
  };
  const form = {
    fields: [{
      path: "/status", label: "Owner title", help: "Owner help", required: false, readOnly: false,
      valueSchema: { type: "string" },
      control: { kind: "select", options: [
        { value: "PUBLISHED", label: "Owner publication label", description: null, disabled: false, disabledReason: null },
      ] },
    }],
    errors: [], values: {}, save: { method: "POST", path: "/api/data-query/action/save", bodySchema: {} },
  };
  const ready = (payload: unknown) => ({ status: "ready", payload });
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce(placement(operations));
  mocks.resolve.mockResolvedValueOnce(placement({ remove: operations.removeMetric }));
  mocks.resolve.mockResolvedValueOnce(placement({ approve: operations.approve }));
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordQuery" }, params: {}, selection: { typeId: OBJECT_TYPE, method: "count" },
  });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ready([
      { status: "ready", payload: execution },
      { status: "ready", payload: { ...execution, target: null, id: "create", name: "Create" } },
      { status: "forbidden", code: "ACTION_TARGET_OUT_OF_SCOPE", error: "Row is outside the scope" },
    ]),
    ready(form), ready({ reason: "System action" }), ready({ reason: "Referenced function" }), ready({ reason: null }),
    ready({ [REMOVE_USER]: ["Protected member"] }),
    ready({ reason: 42 }),
    { status: "forbidden", code: "OBJECT_FORBIDDEN", error: "Placement denied" },
    ready({ rows: [], total: 2 }),
  ] });
  const callsBefore = mocks.read.mock.calls.length;
  const prepared = await prepareRegisteredDataReads(credentials, [operationsRequest, operationsRequest, operationsRequest, request]);
  const results = await runPreparedDataReads(credentials, prepared);
  expect(mocks.read).toHaveBeenCalledTimes(callsBefore + 1);
  expect(mocks.read.mock.lastCall?.[1].map((item: { call: unknown }) => item.call)).toEqual([
    { type: ACTION, name: "executionDefinitions", parameters: { actions: [
      { primaryKey: "approve", object: order }, { primaryKey: "create" }, { primaryKey: "denied", object: order },
    ] } },
    { type: ACTION, name: "createForm", parameters: {} },
    { type: ACTION, name: "deleteRefusal", parameters: { primaryKey: "draft-action" } },
    { type: FUNCTION, name: "deleteRefusal", parameters: { primaryKey: "function-1" } },
    { type: METRIC_VIEW, name: "deleteRefusal", parameters: { primaryKey: "metric-1" } },
    { type: USER, name: "operationRefusals", parameters: { inspections: [{ name: REMOVE_USER, operation: REMOVE_USER, ids: ["user-1"] }] } },
    { type: METRIC_VIEW, name: "deleteRefusal", parameters: { primaryKey: "metric-1" } },
    { type: ACTION, name: "executionDefinitions", parameters: { actions: [{ primaryKey: "approve", object: order }] } },
    { type: OBJECT_TYPE, name: "count", parameters: {} },
  ]);
  expect(results).toMatchObject([
    { status: "ready", value: {
      approve: { handlerRef: "actions.execute", target: { source: "literal", literal: order } },
      create: { handlerRef: "actions.execute", target: { source: "none" } },
      status: { inputSchema: { properties: { status: {
        title: "Owner title", description: "Owner help", oneOf: [{ const: "PUBLISHED", title: "Owner publication label" }],
      } } } },
      removeAction: { unavailable: { reason: "System action" } },
      removeFunction: { unavailable: { reason: "Referenced function" } },
      removeMetric: { handlerRef: DELETE_METRIC_VIEW },
      removeMember: { unavailable: { reason: "Protected member" } },
    } },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    { status: "forbidden", reason: "Placement denied" },
    { status: "ready", value: { rows: [], total: 2 } },
  ]);
  const admitted = results[0];
  if (admitted.status !== "ready") throw new Error("Expected admitted buttons");
  expect(Object.keys(admitted.value as object)).toEqual(["approve", "create", "status", "removeAction", "removeFunction", "removeMetric", "removeMember"]);
  expect(admitted.value).toHaveProperty("approve.inputSchema.properties.values.properties.amount.contentMediaType", "application/json");
  expect(admitted.value).not.toHaveProperty("approve.inputSchema.properties.values.properties.order_id");
  expect(admitted.value).not.toHaveProperty("removeMetric.unavailable");
});

it("uses workflow status once for fixed and selected buttons and reuses list rows for catalogue buttons", async () => {
  const operations: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const action = (id: string) => ({ kind: "PlatformOperation", id });
  const target = (primaryKey: string) => ({ className: WORKFLOW, primaryKey });
  const rowBindings = {
    activate: { operation: action(ACTIVATE_WORKFLOW), target: { row: true } },
    deactivate: { operation: action(DEACTIVATE_WORKFLOW), target: { row: true } },
    delete: { operation: action(DELETE_WORKFLOW), target: { row: true } },
  };
  const port = { kind: "object", objectType: WORKFLOW };
  const panel = { manifest: { state: { selected: { type: port } }, members: {} } };
  const catalogue = { panel, member: {}, projection: {
    inputs: {}, data: { rows: { source: { type: action(WORKFLOW) }, read: "query" } }, operations: rowBindings,
  }, inputs: {} };
  const selected = {
    panel,
    member: { inputs: { selected: { state: "selected" } } },
    projection: { inputs: { selected: port }, operations: {
      activate: { operation: action(ACTIVATE_WORKFLOW), target: { literal: target("revisable") } },
      deactivate: { operation: action(DEACTIVATE_WORKFLOW), target: { input: "selected" } },
      delete: { operation: action(DELETE_WORKFLOW), target: { literal: target("revisable") } },
      missing: { operation: action(ACTIVATE_WORKFLOW), target: { literal: target("missing") } },
    } },
    inputs: { selected: target("revisable") },
  };
  const workflows = [
    { id: "active", name: "Active workflow", status: "ACTIVE", hasDraft: false },
    { id: "revisable", name: "Active workflow with a draft", status: "ACTIVE", hasDraft: true },
    { id: "draft", name: "Draft workflow", status: "DRAFT", hasDraft: false },
  ];
  const localized = { ...credentials, locale: "fr" };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const placement of [catalogue, selected, selected, catalogue]) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
      collectUse("projection", { id: "workflows", domainId: viewer.domainId, ownerId: "author" });
      return placement;
    });
  }
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordQuery" }, params: {}, inputs: {},
    selection: { typeId: WORKFLOW, method: "query" },
  });
  const denied = { status: "forbidden", code: "OBJECT_FORBIDDEN", error: "Placement denied" };
  // Each selected button reads its workflow's state; the batch reader sends a repeated state once.
  const revisable = { status: "ready", payload: { id: "revisable", status: "ACTIVE", hasDraft: true } };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready" },
    revisable, revisable, revisable, { status: "error", code: "WORKFLOW_NOT_FOUND", error: "Workflow not found" },
    denied, denied, denied, denied,
    { status: "ready", payload: { workflows, subjects: [], actions: [], grants: [] } },
  ] });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const prepared = await prepareRegisteredDataReads(localized, [operations, operations, operations, request]);
  const results = await runPreparedDataReads(localized, prepared);
  const state = (primaryKey: string) => ({ type: WORKFLOW, name: "lifecycleState", parameters: { primaryKey } });
  const reads = mocks.read.mock.lastCall![1];
  expect(reads.map((item: { call?: unknown }) => item.call)).toEqual([
    undefined, ...[1, 2].flatMap(() => [state("revisable"), state("revisable"), state("revisable"), state("missing")]),
    { type: WORKFLOW, name: "query", parameters: {} },
  ]);
  expect(reads).toMatchObject(reads.map(() => ({ uses: [{ target: { kind: "PROJECTION", id: "workflows" } }] })));
  expect(results).toMatchObject([
    { status: "ready", value: {
      activate: { target: { source: "row" } }, deactivate: { target: { source: "row" } }, delete: { target: { source: "row" } },
    } },
    { status: "ready", value: {
      activate: { handlerRef: ACTIVATE_WORKFLOW },
      deactivate: { target: { source: "input", input: "selected" } },
      delete: { unavailable: { reason: expect.any(String) } },
      missing: { unavailable: { reason: localizedWorkflowNotFound } },
    } },
    { status: "forbidden", reason: "Placement denied" },
    { status: "ready", value: { total: 3, rows: [{ primaryKey: "active" }, { primaryKey: "revisable" }, { primaryKey: "draft" }] },
      rowOperations: {
        [`${WORKFLOW}:active`]: { activate: { available: false }, deactivate: { available: true }, delete: { available: false } },
        [`${WORKFLOW}:revisable`]: { activate: { available: true }, deactivate: { available: true }, delete: { available: false } },
        [`${WORKFLOW}:draft`]: { activate: { available: true }, deactivate: { available: false }, delete: { available: true } },
      },
    },
  ]);
  expect(results[1]).not.toHaveProperty("value.activate.unavailable");
  expect(results[1]).not.toHaveProperty("value.deactivate.unavailable");
  expect(fetch).not.toHaveBeenCalled();
});

it("shares attribute facts for fixed buttons and keeps inner list-row refusals in the same read batch", async () => {
  const operationsRequest: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const call = (id: string) => ({ kind: "PlatformOperation", id });
  const key = (field: string) => JSON.stringify(["Device", field]);
  const fixed = (id: string, field: string) => ({
    operation: call(id), target: { literal: { className: ATTRIBUTE, primaryKey: key(field) } },
  });
  const placement = (operations: object) => ({ inputs: {}, member: {}, projection: {
    inputs: {}, data: { rows: { source: { type: call(ATTRIBUTE) }, read: "list" } }, operations,
  } });
  const ordinary = { className: "Device", name: "note", showName: "Note", type: "varchar",
    attrDesc: "", enable: true, businessKey: false, primaryKey: false };
  const attributes = { fieldLabels: {}, classLabels: { Device: "Device" }, views: [
    ordinary, { ...ordinary, name: "id", primaryKey: true }, { ...ordinary, name: "site_id" },
    { ...ordinary, name: "retired", enable: false },
  ] };
  const relationships = { fieldLabels: {}, views: [
    { relationship: "owns", desc: "Display label", fromclass: "Device", fromField: "site_id", toclass: "Site", toField: "id" },
    { relationship: "another", desc: "", fromclass: "Site", fromField: "note", toclass: "Room", toField: "id" },
  ] };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce(placement({
    deleteJoined: fixed(DELETE_ATTRIBUTE, "site_id"), deleteKey: fixed(DELETE_ATTRIBUTE, "id"),
    setRetired: fixed(SET_PRIMARY_KEY, "retired"), setFree: fixed(SET_PRIMARY_KEY, "note"),
  }));
  mocks.resolve.mockResolvedValueOnce(placement({ makeKey: fixed(SET_PRIMARY_KEY, "id") }));
  mocks.resolve.mockResolvedValueOnce(placement({ delete: { operation: call(DELETE_ATTRIBUTE), target: { row: true } } }));
  mocks.resolve.mockResolvedValueOnce(placement({ delete: { operation: call(DELETE_ATTRIBUTE), target: { row: true } } }));
  mocks.resolve.mockResolvedValueOnce(placement({ delete: fixed(DELETE_ATTRIBUTE, "note") }));
  mocks.prepare.mockResolvedValue({
    declaration: { result: "panelRecordList" }, params: { className: "Device" }, inputs: {},
    selection: { typeId: ATTRIBUTE, method: "list" },
  });
  const ready = (payload: unknown) => ({ status: "ready", payload });
  // Delete reads the attribute list with its delete facts and set-primary-key without; the batch reader sends repeats once.
  const withUses = { ...attributes, relationshipFacts: relationships };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ready(withUses), ready(withUses), ready(attributes), ready(attributes),
    ready(attributes),
    ready(withUses),
    ready({ ...attributes, relationshipFacts: { error: "Relationship read denied" } }),
    { status: "forbidden", code: "OBJECT_FORBIDDEN", error: "Model read denied" },
  ] });
  const prepared = await prepareRegisteredDataReads(credentials, [operationsRequest, operationsRequest, request, request, operationsRequest]);
  const results = await runPreparedDataReads(credentials, prepared);
  const list = { type: ATTRIBUTE, name: "list", parameters: { className: "Device" } };
  const listWithUses = { type: ATTRIBUTE, name: "list", parameters: { className: "Device", includeDeleteFacts: true } };
  expect(mocks.read.mock.lastCall?.[1].map((item: { call: unknown }) => item.call)).toEqual([
    listWithUses, listWithUses, list, list, list, listWithUses, listWithUses, listWithUses,
  ]);
  const inUse = { reason: "This attribute is used by these relationships: owns." };
  const keyProtected = { reason: "A primary key attribute cannot be deleted." };
  expect(results).toMatchObject([
    { status: "ready", value: {
      deleteJoined: { unavailable: inUse }, deleteKey: { unavailable: keyProtected },
      setRetired: { unavailable: { reason: "Only enabled text (varchar) attributes can become primary keys." } },
      setFree: { handlerRef: SET_PRIMARY_KEY },
    } },
    { status: "ready", value: { makeKey: { unavailable: { reason: "This attribute is already a primary key." } } } },
    { status: "ready", value: expect.arrayContaining([{ primaryKey: key("id") }].map(value => expect.objectContaining(value))), rowOperations: {
      [`${ATTRIBUTE}:${key("site_id")}`]: { delete: { available: false, unavailable: inUse } },
      [`${ATTRIBUTE}:${key("id")}`]: { delete: { available: false, unavailable: keyProtected } },
      [`${ATTRIBUTE}:${key("note")}`]: { delete: { available: true } },
    } },
    { status: "ready", value: expect.arrayContaining([expect.objectContaining({ primaryKey: key("id") })]), rowOperations: {
      [`${ATTRIBUTE}:${key("id")}`]: { delete: { available: false, unavailable: keyProtected } },
      [`${ATTRIBUTE}:${key("note")}`]: { delete: { available: false, unavailable: { reason: "Relationship read denied" } } },
    } },
    { status: "forbidden", reason: "Model read denied" },
  ]);
  const fixedButtons = results[0];
  if (fixedButtons.status !== "ready") throw new Error("Expected attribute descriptions");
  expect(fixedButtons.value).not.toHaveProperty("setFree.unavailable");
});

it("presents masked adapter facts without coupling the connection form to the ontology outline", async () => {
  const connection = { url: "jdbc:postgresql://db/app", user: "reader", password: "******" };
  const catalogue = { currentType: "postgresql", adapters: [{
    type: "postgresql", label: "PostgreSQL", fields: ["url", "user", "password"],
    fieldInfos: [{ name: "url", required: true }, { name: "user" }, { name: "password", secret: true }],
  }] };
  const config = { dataAdapter: "postgresql", dataAdapterConnections: { postgresql: connection } };
  const facts = { config, catalogue };
  const outline = { classDefs: [{ name: "Person" }], relationshipDefs: {} };
  const selection = { kind: "platform", typeId: DATA_ADAPTER_CONFIG, primaryKey: "domain" };
  const form = { selection: { ...selection, method: "form" }, declaration: { result: "panelFormDescription" }, params: {} };
  const routing = { ...form, selection: { ...selection, method: "routingForm" }, params: {} };
  const record = { ...form, selection: { ...selection, method: "record" }, declaration: { result: "panelRecord" } };
  const invalid = { ...routing, params: { values: { "/classRoutes": [] } } };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const plan of [record, form, routing, routing, invalid]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce(plan);
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: facts },
    { status: "ready", payload: facts },
    { status: "forbidden", error: "Ontology model read denied" },
    { status: "ready", payload: { catalogue, config: { multiDataSource: {
      dataSources: [{ id: "crm", adapterType: "postgresql" }], classes: [{ forOntoMap: "Person", sourceId: "crm" }],
    } }, ontology: outline } },
    { status: "ready" },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, Array.from({ length: 5 }, () => request));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(results).toMatchObject([
    { status: "ready", value: { primaryKey: "domain", outputs: { currentType: "postgresql" } } },
    { status: "ready", value: { values: { adapterMode: "postgresql", connection: { ...connection, password: "" } },
      save: { path: "/api/data-query/businessConfig/useDataAdapter" } } },
    { status: "forbidden", reason: "Ontology model read denied" },
    { status: "ready", value: { values: { classRoutes: [{ className: "Person", sourceId: "crm" }] },
      save: { path: "/api/data-query/businessConfig/useMultiDataSource" } } },
    { status: "error", code: "INVALID_REQUEST" },
  ]);
  expect(mocks.read.mock.lastCall?.[1].map((item: { call?: unknown }) => item.call)).toEqual([
    { type: DATA_ADAPTER_CONFIG, name: "record", parameters: { primaryKey: "domain" } },
    { type: DATA_ADAPTER_CONFIG, name: "form", parameters: { primaryKey: "domain" } },
    { type: DATA_ADAPTER_CONFIG, name: "routingForm", parameters: { primaryKey: "domain" } },
    { type: DATA_ADAPTER_CONFIG, name: "routingForm", parameters: { primaryKey: "domain" } },
    undefined,
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("presents registered model options and resolves the selected references in their original order", async () => {
  const facts = {
    models: [{ name: "chat-a", type: "chat" }, { name: "embed", type: "embedding", dimensions: 8 }, { name: "chat-b", type: "chat" }],
    defaultModel: "chat-b",
    embeddingModel: "embed",
  };
  const values = ["gone", "chat-b", null, "chat-a", "chat-b"];
  const declaration = { result: "panelOptionList" };
  const options = { declaration, selection: { kind: "platform", typeId: MODEL_OPTION, method: "options" }, params: {} };
  const resolve = { ...options, selection: { ...options.selection, method: "resolve" }, params: { values } };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const plan of [options, resolve, options]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce(plan);
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: facts },
    { status: "ready", payload: facts },
    { status: "ready", payload: { ...facts, models: [{ name: "chat-a", type: "chat", apiKeys: ["unexpected"] }] } },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [request, request, request]);
  const defaultOption = { primaryKey: "@default", value: null, label: "Domain default (chat-b)" };
  const chatA = { primaryKey: "chat-a", value: "chat-a", label: "chat-a" };
  const chatB = { primaryKey: "chat-b", value: "chat-b", label: "chat-b" };
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: { options: [defaultOption, chatA, chatB] } },
    { status: "ready", value: { options: [
      { primaryKey: "gone", value: "gone", label: "gone", unavailable: { reason: "This option is no longer available." } },
      chatB, defaultOption, chatA, chatB,
    ] } },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
  ]);
  expect(mocks.read.mock.lastCall?.[1].map((item: { call?: unknown }) => item.call)).toEqual([
    { type: MODEL_OPTION, name: "options", parameters: {} },
    { type: MODEL_OPTION, name: "resolve", parameters: { values } },
    { type: MODEL_OPTION, name: "options", parameters: {} },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("reads published MCP declarations after batch admission using the server request location", async () => {
  const product = await import("../../../product/installed");
  const analysis = "ontomato-analysis-agents";
  const ops = "ontomato-ops-agent";
  const identity = vi.spyOn(product, "workbenchProduct").mockReturnValue({
    analysisMcpServerName: analysis, opsMcpServerName: ops,
  } as ReturnType<typeof product.workbenchProduct>);
  const catalogue = vi.spyOn(await import("../../mcp/catalog"), "publishedMcpCatalogue");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("ANALYSIS_AGENT_MCP_URL", "");
  const location = { protocol: "http", headers: {
    host: "workbench:3000",
    "x-forwarded-host": "public.example, workbench:3000",
    "x-forwarded-proto": "https, http",
    "x-forwarded-prefix": "/tenant/, /internal",
  } };
  const approved = { status: "ready", payload: workbenchManagement.publishedMcpRead.id };
  const cases = [
    { method: "list", result: "panelRecordList", reply: approved },
    { method: "record", primaryKey: ops, result: "panelRecord", reply: approved },
    { method: "tools", primaryKey: ops, result: "panelRecordList", reply: approved },
    { method: "record", primaryKey: "missing", result: "panelRecord", reply: approved },
    { method: "list", result: "panelRecordList", reply: { status: "forbidden", error: "Management read denied" } },
    { method: "tools", primaryKey: analysis, result: "panelRecordList",
      reply: { status: "ready", payload: workbenchManagement.mcpServicesRead.id } },
  ];
  const mcpRequest: RegisteredDataRead = {
    ...request, source: { kind: "registered", applicationId: "settings", useId: "published-mcp" },
  };
  const mcpEntry = { applicationId: "settings", use: {
    id: "published-mcp", names: { en: "published-mcp" }, pageKey: "published-mcp", panelId: "builtin-product-published-mcp", path: "/settings/mcp-services",
  } };
  const run = async (items: typeof cases, requestLocation: typeof location | undefined) => {
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry: mcpEntry }] });
    for (const { method, primaryKey, result } of items) {
      mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
      mocks.prepare.mockResolvedValueOnce({
        declaration: { result }, params: {}, selection: { typeId: PUBLISHED_MCP_SERVICE, method, primaryKey },
      });
    }
    mocks.read.mockResolvedValueOnce({ viewer, results: items.map(({ reply }) => reply) });
    const prepared = await prepareRegisteredDataReads(credentials, items.map(() => mcpRequest), { location: requestLocation });
    return runPreparedDataReads(credentials, prepared);
  };

  try {
    expect(await run(cases, location)).toMatchObject([
      { status: "ready", value: expect.arrayContaining([
        expect.objectContaining({ primaryKey: analysis, fields: expect.objectContaining({ mcpUrl: "https://public.example/tenant/mcp/analysis-agents" }) }),
        expect.objectContaining({ primaryKey: ops, fields: expect.objectContaining({ mcpUrl: "https://public.example/tenant/mcp/ops-agent" }) }),
      ]) },
      { status: "ready", value: { primaryKey: ops, fields: { mcpUrl: "https://public.example/tenant/mcp/ops-agent" } } },
      { status: "ready", value: expect.arrayContaining([
        expect.objectContaining({ primaryKey: "send", fields: expect.objectContaining({ inputSchema: expect.any(String) }) }),
      ]) },
      { status: "error", code: "NOT_FOUND" },
      { status: "forbidden" },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    ]);
    expect(catalogue.mock.calls).toEqual(Array.from({ length: 4 }, () => [location, credentials.locale]));
    expect(mocks.read.mock.lastCall?.[1].map(({ call }: { call: unknown }) => call)).toEqual(
      cases.map(({ method }) => ({ type: PUBLISHED_MCP_SERVICE, name: method, parameters: {} })),
    );

    vi.stubEnv("ANALYSIS_AGENT_MCP_URL", "https://configured.example/base/mcp/analysis-agents/");
    expect(await run([cases[1]], location)).toMatchObject([
      { status: "ready", value: { fields: { mcpUrl: "https://configured.example/base/mcp/ops-agent" } } },
    ]);
    catalogue.mockClear();
    vi.stubEnv("ANALYSIS_AGENT_MCP_URL", "");
    vi.stubEnv("PUBLIC_BASE_PATH", "https://fallback.example/base/");
    expect(await run([cases[0]], undefined)).toMatchObject([
      { status: "ready", value: expect.arrayContaining([
        expect.objectContaining({ primaryKey: analysis, fields: expect.objectContaining({ mcpUrl: "https://fallback.example/base/mcp/analysis-agents" }) }),
        expect.objectContaining({ primaryKey: ops, fields: expect.objectContaining({ mcpUrl: "https://fallback.example/base/mcp/ops-agent" }) }),
      ]) },
    ]);
    expect(catalogue).toHaveBeenCalledWith(undefined, credentials.locale);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    catalogue.mockRestore();
    identity.mockRestore();
  }
});

it("uses the verified MCP scope and keeps tools and configured forms behind their own batch admission", async () => {
  const serviceId = "11111111-1111-4111-8111-111111111111";
  const otherId = "22222222-2222-4222-8222-222222222222";
  const retired = "33333333-3333-4333-8333-333333333333";
  const services = [{ id: serviceId, name: "Orders MCP" }, { id: otherId, name: "Other MCP" }];
  const saved = { ...services[0], url: "https://mcp.example.test/tools", headers: { Authorization: "********" } };
  const unsafe = "unexpected-unmasked-runtime-header";
  let configurationReads = 0;
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "fixture-runtime-token");
  vi.stubEnv("AGENT_RUNTIME_URL", "http://runtime.test");
  const fetch = vi.fn(async (url: string, init: NonNullable<Parameters<typeof globalThis.fetch>[1]>) => {
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      "x-domain-id": viewer.domainId, "x-ontomato-user-id": viewer.userId, "x-workspace-owner-id": viewer.userId,
    });
    if (url === "http://runtime.test/v1/mcp/services/names") return Response.json(services);
    if (url === `http://runtime.test/v1/mcp/services/${serviceId}/tools`)
      return Response.json({ tools: [{ name: "lookup-order", title: "Lookup order" }] });
    expect(url).toBe("http://runtime.test/v1/mcp/services");
    configurationReads++;
    return Response.json({ services: [configurationReads === 1 ? saved : {
      ...saved, headers: { Authorization: unsafe },
    }] });
  });
  vi.stubGlobal("fetch", fetch);

  const approval = { status: "ready", payload: workbenchManagement.mcpServicesRead.id };
  const values = [otherId, retired, serviceId, otherId];
  const cases = [
    { method: "options", params: {}, result: "panelOptionList", response: { status: "ready" } },
    { method: "resolve", params: { values }, result: "panelOptionList", response: { status: "ready" } },
    { method: "form", primaryKey: serviceId, params: {}, result: "panelFormDescription",
      response: { status: "forbidden", error: "MCP configuration read denied" } },
    { method: "form", primaryKey: serviceId, params: {}, result: "panelFormDescription", response: { status: "ready" } },
    { method: "createForm", params: {}, result: "panelFormDescription", response: approval },
    { method: "form", primaryKey: serviceId, params: { values: { name: "Draft", url: "not a URL" } },
      result: "panelFormDescription", response: approval },
    { method: "form", primaryKey: serviceId, params: {}, result: "panelFormDescription", response: approval },
    { method: "tools", primaryKey: otherId, params: {}, result: "panelRecordList",
      response: { status: "forbidden", error: "MCP tools read denied" } },
    { method: "tools", primaryKey: serviceId, params: {}, result: "panelRecordList", response: approval },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { params, result, response: _response, ...selection } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection: { ...selection, typeId: EXTERNAL_MCP_SERVICE } });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(fetch).not.toHaveBeenCalled();
    return { viewer, results: cases.map(({ response }) => response) };
  });

  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
  const results = await runPreparedDataReads(credentials, prepared);
  const orders = { primaryKey: serviceId, value: serviceId, label: "Orders MCP" };
  const other = { primaryKey: otherId, value: otherId, label: "Other MCP" };
  expect(results).toMatchObject([
    { status: "ready", value: { options: [orders, other] } },
    { status: "ready", value: { options: [
      other, { primaryKey: retired, value: retired, label: retired, unavailable: { reason: "This option is no longer available." } },
      orders, other,
    ] } },
    { status: "forbidden", reason: "MCP configuration read denied" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    { status: "ready", value: { values: { name: "", url: "", headers: [] }, save: { method: "POST", path: "/api/mcp/services" } } },
    { status: "ready", value: {
      values: { name: "Draft", headers: [{ name: "Authorization", value: "", storedName: "Authorization" }] },
      errors: [{ field: "/url", code: "invalid_format" }],
      save: { method: "PUT", path: `/api/mcp/services/${serviceId}` },
    } },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    { status: "forbidden", reason: "MCP tools read denied" },
    { status: "ready", value: [{ primaryKey: "lookup-order", label: "Lookup order" }] },
  ]);
  expect(JSON.stringify(results)).not.toContain(unsafe);
  expect(mocks.read.mock.lastCall?.[1].map((item: { call?: unknown }) => item.call)).toEqual([
    undefined, undefined,
    ...cases.slice(2).map(({ method, primaryKey }) => ({
      type: EXTERNAL_MCP_SERVICE, name: method,
      parameters: primaryKey === undefined ? {} : { primaryKey },
    })),
  ]);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "http://runtime.test/v1/mcp/services/names", "http://runtime.test/v1/mcp/services/names",
    "http://runtime.test/v1/mcp/services", "http://runtime.test/v1/mcp/services",
    `http://runtime.test/v1/mcp/services/${serviceId}/tools`,
  ]);
});

it("reads external MCP services using only the batch management approval and AGENT/VIEW", async () => {
  const postgres = await import("../../../infrastructure/postgres");
  const serviceId = "11111111-1111-4111-8111-111111111111";
  const unusedId = "22222222-2222-4222-8222-222222222222";
  const missingId = "33333333-3333-4333-8333-333333333333";
  const agentId = "44444444-4444-4444-8444-444444444444";
  const services = [
    { id: serviceId, name: "Orders MCP", url: "https://orders.example/mcp", headers: { Authorization: "********" } },
    { id: unusedId, name: "Billing MCP", url: "https://billing.example/mcp", headers: {} },
  ];
  const unsafe = "unexpected-unmasked-runtime-header";
  let runtimeReads = 0;
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "fixture-runtime-token");
  vi.stubEnv("AGENT_RUNTIME_URL", "http://runtime.test");
  const fetch = vi.fn(async (url: string, init: NonNullable<Parameters<typeof globalThis.fetch>[1]>) => {
    expect(url).toBe("http://runtime.test/v1/mcp/services");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ "x-domain-id": viewer.domainId, "x-ontomato-user-id": viewer.userId });
    if (++runtimeReads === 4)
      return Response.json({ services: [{ ...services[0], headers: { Authorization: unsafe } }] });
    return Response.json({ services });
  });
  vi.stubGlobal("fetch", fetch);

  const query = vi.fn(async (sql: string, values: unknown[]) => {
    expect(sql).toContain("a.enabled_mcp_service_ids");
    expect(sql).toContain("WHERE domain_id=$1 AND kind NOT IN ('app-builder','ops-diagnosis')");
    expect(values[0]).toBe(viewer.domainId);
    if (values.length === 1) {
      expect(sql).toContain("AND FALSE");
      return { rows: [] };
    }
    expect(sql).toContain("a.id::text = ANY($2::text[])");
    expect(values[1]).toEqual([agentId]);
    return { rows: [{ id: agentId, name: "Sales agent", kind: "custom", enabled_mcp_service_ids: [serviceId] }] };
  });
  const pool = vi.spyOn(postgres, "getPostgresPool")
    .mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);
  const emptyRange = { fixed: false, authorId: null, objectIds: [], all: false };
  const approved = (view: ObjectVisibilityRange) => ({
    status: "ready", payload: workbenchManagement.mcpServicesRead.id,
    visibility: { AGENT: { VIEW: view, USE: { ...emptyRange, all: true } } },
  });
  const visible = approved({ ...emptyRange, objectIds: [agentId] });
  const cases = [
    { method: "list", result: "panelRecordList", response: visible },
    { method: "record", primaryKey: serviceId, result: "panelRecord", response: approved(emptyRange) },
    { method: "record", primaryKey: missingId, result: "panelRecord", response: visible },
    { method: "list", result: "panelRecordList", response: { status: "forbidden", error: "MCP list denied" } },
    { method: "record", primaryKey: unusedId, result: "panelRecord", response: {
      ...visible, visibility: { AGENT: { USE: { ...emptyRange, all: true } } },
    } },
    { method: "list", result: "panelRecordList", response: visible },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { method, primaryKey, result } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params: {},
      selection: { typeId: EXTERNAL_MCP_SERVICE, method, primaryKey } });
  }
  mocks.read.mockImplementationOnce(async () => {
    expect(query).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    return { viewer, results: cases.map(({ response }) => response) };
  });

  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: [
        { primaryKey: serviceId, fields: { headerNames: "Authorization", usedBy: "Sales agent" } },
        { primaryKey: unusedId, fields: { usedBy: "Not used" } },
      ] },
      { status: "ready", value: { primaryKey: serviceId, fields: { headerNames: "Authorization" } } },
      { status: "error", code: "NOT_FOUND", message: "External MCP service not found" },
      { status: "forbidden", reason: "MCP list denied" },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID", message: expect.stringContaining("AGENT/VIEW") },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID",
        message: "Runtime did not return a valid masked MCP service configuration" },
    ]);
    expect(results[1]).not.toHaveProperty("value.fields.usedBy");
    expect(JSON.stringify(results)).not.toContain("********");
    expect(JSON.stringify(results)).not.toContain(unsafe);
    expect(mocks.locate).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.read.mock.lastCall?.[1]).toMatchObject(cases.map(({ method, primaryKey }) => ({
      visibleKinds: [{ kind: "AGENT", verbs: ["VIEW"] }],
      call: { type: EXTERNAL_MCP_SERVICE, name: method, parameters: primaryKey ? { primaryKey } : {} },
    })));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(query).toHaveBeenCalledTimes(4);
  } finally {
    pool.mockRestore();
  }
});

it("reads SDK releases and current domain components with only the returned COMPONENT/USE range", async () => {
  const sdk = await import("../../app-builder/sdk");
  const packages = await import("../../component-packages/store");
  const postgres = await import("../../../infrastructure/postgres");
  const id = (suffix: string) => `domain-component:00000000-0000-0000-0000-${suffix.padStart(12, "0")}`;
  const allowed = id("1");
  const authored = id("2");
  const denied = id("3");
  const foreign = id("4");
  const released = "@ontomato/sdk:Released";
  const catalogueSpy = vi.spyOn(sdk, "readCurrentAppSdkComponents").mockResolvedValue({
    version: "1.0.0", digest: "a".repeat(64), catalogue: { version: "1.0.0", components: [{
      componentId: "Released", module: "@ontomato/sdk/base", exportName: "Released",
      role: "control", group: "list", meaning: "Match released component",
      ports: { props: [], slots: [], events: [] },
    }] },
  });
  const packageSpy = vi.spyOn(packages, "listComponentPackages").mockResolvedValue([]);
  const time = new Date("2026-11-26T00:00:00.000Z");
  const row = (key: string, domainId: string, ownerId: string, name: string) => ({
    id: key, domainId, ownerId, revision: 2, createdAt: time, updatedAt: time,
    definition: { name, source: { template: "<div>stored-runtime-source</div>" }, declaration: {
      componentId: key, role: "control", meaning: "Domain component",
      data: { rows: { results: ["panelRecordList"], required: true } },
      config: [{ name: "pageSize", type: "number", required: false, description: "Page size" }],
      inputs: { label: { kind: "scalar", type: "string" } },
      outputs: { selected: { kind: "scalar", type: "string" } },
      operations: [{ name: "approve", handlerRef: "orders.approve" }],
      ports: { props: [], slots: [], events: [] },
    } },
  });
  const rows = [
    row(allowed, viewer.domainId, "other", "Match explicit grant"),
    row(authored, viewer.domainId, viewer.userId, "Match author"),
    row(denied, viewer.domainId, "other", "Match ungranted"),
    row(foreign, "another-domain", viewer.userId, "Match foreign"),
  ];
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    expect(sql).toContain("domain_components");
    expect(args[0]).toBe(viewer.domainId);
    if (sql.includes("id=$2")) return { rows: rows.filter(row => row.domainId === args[0] && row.id === args[1]) };
    expect(sql).toContain("domain_id=$1 AND ($2::boolean OR id=ANY($3::text[]) OR owner_id=$4)");
    expect(args).toEqual([viewer.domainId, false, [allowed, foreign], viewer.userId]);
    return { rows: rows.filter(row => row.domainId === args[0] && ((args[2] as string[]).includes(row.id) || row.ownerId === args[3]))
      .sort((left, right) => left.definition.name.localeCompare(right.definition.name)) };
  });
  const pool = vi.spyOn(postgres, "getPostgresPool").mockReturnValue({ query } as unknown as ReturnType<typeof postgres.getPostgresPool>);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const range = { fixed: true, all: false, objectIds: [allowed, foreign], authorId: viewer.userId };
  const response = (use: typeof range) => ({ status: "ready", visibility: { COMPONENT: { USE: use } } });
  const cases = [
    { method: "catalogue", params: { search: " MATCH " }, result: "panelRecordList", response: response(range) },
    { method: "definition", primaryKey: released, params: {}, result: "sdkComponentDefinition", response: response({ ...range, fixed: false }) },
    { method: "record", primaryKey: allowed, params: {}, result: "panelRecord", response: response(range) },
    ...["dataRows", "configRows", "inputRows", "outputRows", "operationRows"].map(method => ({
      method, primaryKey: authored, params: {}, result: "panelRecordList", response: response(range),
    })),
    { method: "record", primaryKey: denied, params: {}, result: "panelRecord", response: response(range) },
    { method: "record", primaryKey: foreign, params: {}, result: "panelRecord", response: response(range) },
    { method: "record", primaryKey: allowed, params: {}, result: "panelRecord", response: { status: "ready", visibility: { COMPONENT: {} } } },
  ];
  try {
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
    for (const { params, result, response: _response, ...selection } of cases) {
      mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
      mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection: { ...selection, typeId: SDK_COMPONENT } });
    }
    mocks.read.mockImplementationOnce(async () => {
      expect(query).not.toHaveBeenCalled();
      return { viewer, results: cases.map(({ response }) => response) };
    });
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: [{ primaryKey: released }, { primaryKey: authored }, { primaryKey: allowed }] },
      { status: "ready", value: { componentId: "Released" } },
      { status: "ready", value: { primaryKey: allowed, label: "Match explicit grant" } },
      { status: "ready", value: [{ primaryKey: "rows" }] },
      { status: "ready", value: [{ primaryKey: "pageSize" }] },
      { status: "ready", value: [{ primaryKey: "input:label" }] },
      { status: "ready", value: [{ primaryKey: "output:selected" }] },
      { status: "ready", value: [{ primaryKey: "approve", fields: { signature: "orders.approve" } }] },
      { status: "forbidden" },
      { status: "error", code: "SDK_COMPONENT_NOT_FOUND" },
      { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
    ]);
    expect(JSON.stringify(results)).not.toContain("stored-runtime-source");
    for (const item of mocks.read.mock.lastCall![1]) {
      expect(item).toMatchObject({ visibleKinds: [{ kind: "COMPONENT", verbs: ["USE"] }] });
      expect(item).not.toHaveProperty("call");
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    pool.mockRestore();
    packageSpy.mockRestore();
    catalogueSpy.mockRestore();
  }
});

it("describes selected and checked knowledge approvals with authorized status facts only", async () => {
  const opRequest: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const reference = (primaryKey: string) => ({ className: BUSINESS_KNOWLEDGE, primaryKey });
  const object = { kind: "object", objectType: BUSINESS_KNOWLEDGE };
  const placement = (selected: string | string[]) => {
    const list = Array.isArray(selected);
    const port = list ? "checked" : "selected";
    return {
      inputs: {},
      panel: { manifest: { state: {}, members: {} } },
      member: { inputs: { [port]: { literal: list ? selected.map(reference) : reference(selected) } } },
      projection: {
        inputs: { [port]: list ? { kind: "list", items: object } : object },
        operations: { approve: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, target: { input: port } } },
      },
    };
  };
  const ready = (payload: unknown) => ({ status: "ready", payload });
  const cases = [
    { selected: "approved", response: ready([1]) },
    { selected: ["approved", "missing", "pending"], response: ready([1, null, 0]) },
    { selected: ["missing", "approved"], response: ready([null, 1]) },
    { selected: "pending", response: { status: "forbidden", error: "Knowledge read denied" } },
    { selected: [], response: { status: "ready" } },
    { selected: ["approved", "pending"], response: ready([0]) },
  ];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { selected } of cases) mocks.resolve.mockResolvedValueOnce(placement(selected));
  mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(({ response }) => response) });
  const readsBefore = mocks.read.mock.calls.length;

  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => opRequest));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(mocks.read).toHaveBeenCalledTimes(readsBefore + 1);
  expect(mocks.read.mock.lastCall?.[1].map((read: { call?: unknown }) => read.call)).toEqual(cases.map(({ selected }) =>
    Array.isArray(selected) && !selected.length ? undefined : {
      type: BUSINESS_KNOWLEDGE, name: "approvalStatuses", parameters: { ids: Array.isArray(selected) ? selected : [selected] },
    }));
  expect(results).toMatchObject([
    { status: "ready", value: { approve: { target: { source: "input", input: "selected" },
      unavailable: { reason: "This business knowledge entry is already approved." } } } },
    { status: "ready", value: { approve: { batch: true, target: { source: "input", input: "checked" } } } },
    { status: "ready", value: { approve: { unavailable: { reason: "Business knowledge does not exist or has been deleted." } } } },
    { status: "forbidden", reason: "Knowledge read denied" },
    { status: "ready", value: { approve: { handlerRef: APPROVE_KNOWLEDGE } } },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
  ]);
  expect(results[1]).not.toHaveProperty("value.approve.unavailable");
  expect(fetch).not.toHaveBeenCalled();
});

it("pages registered Function.query over the authorized function list", async () => {
  const payload = [
    { id: "stock", name: "Check stock", operationLabel: "Read" },
    { id: "ship", name: "Ship", description: "Adjust stock", operationLabel: "Read" },
    { id: "unrelated", name: "Invoice" },
    { id: "audit", name: "Audit stock", operationLabel: "Read" },
  ];
  const cases = [
    { search: " STOCK ", operation: "OPERATION_READ", cursor: "1", size: 1 },
    { cursor: "invalid" },
  ];
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const params of cases) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
      collectUse("projection", { id: "function-query", domainId: viewer.domainId, ownerId: "author" });
      return { inputs: {}, projection: {} };
    });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecordQuery" }, params, selection: { typeId: FUNCTION, method: "query" },
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: cases.map(() => ({ status: "ready", payload })) });

  const readsBefore = mocks.read.mock.calls.length;
  const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: { rows: [{ primaryKey: "ship", fields: { operation: "Read" } }], nextCursor: "2", total: 3 } },
    { status: "error", code: "INVALID_CURSOR" },
  ]);
  expect(mocks.read).toHaveBeenCalledTimes(readsBefore + 1);
  expect(mocks.read.mock.lastCall?.[1]).toMatchObject([
    { uses: [{ target: { kind: "PROJECTION", id: "function-query", domainId: viewer.domainId } }],
      call: { type: FUNCTION, name: "list", parameters: { operation: "OPERATION_READ" } } },
    { call: { type: FUNCTION, name: "list", parameters: {} } },
  ]);
  expect(mocks.read.mock.lastCall?.[1].map((read: { call: { parameters: unknown } }) => read.call.parameters))
    .toEqual([{ operation: "OPERATION_READ" }, {}]);
  expect(fetch).not.toHaveBeenCalled();
});

it("shares model type facts across option and resolve placements without sharing a different USE admission", async () => {
  const value = {
    className: "Customer", showName: "Customer accounts", classDesc: "Customer account data",
    attributeCount: 2, businessKeyCount: 0, relationshipCount: 0, primaryKey: { status: "configured", count: 1 },
  };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {} }).mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.resolve.mockImplementationOnce(async (_owner, _viewer, _request, _cache, collectUse) => {
    collectUse("projection", { id: "private-type-options", domainId: viewer.domainId, ownerId: "author" });
    return { inputs: {}, projection: {} };
  });
  for (const method of ["options", "resolve", "resolve"]) {
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelOptionList" }, selection: { typeId: OBJECT_TYPE, method },
      params: method === "resolve" ? { values: ["Customer", "Removed"] } : {},
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: [value] }, { status: "ready", payload: [value] }, { status: "forbidden", error: "Owner denied definition" },
  ] });

  const plan = await prepareRegisteredDataReads(credentials, ["choices", "chosen", "restricted"].map(member =>
    ({ ...request, memberPath: [{ member }] })));
  const replies = await runPreparedDataReads(credentials, plan);
  const choice = { value: "Customer", label: "Customer accounts (Customer)" };
  expect(replies).toMatchObject([
    { status: "ready", value: { options: [choice] } },
    { status: "ready", value: { options: [choice, { value: "Removed", unavailable: { reason: expect.any(String) } }] } },
    { status: "forbidden", reason: "Owner denied definition" },
  ]);
  const batch = mocks.read.mock.lastCall![1];
  expect(batch).toHaveLength(3);
  expect(batch[0].call).toEqual({ type: OBJECT_TYPE, name: "options", parameters: {} });
  expect(batch[2].uses).toMatchObject([{ target: { id: "private-type-options" } }]);
});

it("describes clearing a detail panel using the current domain's mapping and management gate", async () => {
  const ids = ["Configured", "Unconfigured", "Denied", "Hidden", "InvalidReply"];
  const operation = CLEAR_OBJECT_DETAIL_PANEL;
  const opRequest: RegisteredDataRead = { source, memberPath: request.memberPath, operations: true, inputs: {} };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  const projections = ["detail-clear", "detail-clear", "denied-clear", "hidden-clear", "invalid-clear"];
  for (const [index, primaryKey] of ids.entries()) {
    mocks.resolve.mockImplementationOnce(async (_viewer, _credentials, _request, _cache, collectUse) => {
      collectUse("projection", { id: projections[index], domainId: viewer.domainId, ownerId: "author" });
      return {
        panel: { manifest: { state: {}, members: {} } },
        member: { inputs: { objectType: { literal: { className: OBJECT_TYPE, primaryKey } } } },
        projection: {
          inputs: { objectType: { kind: "object", objectType: OBJECT_TYPE } },
          operations: { clear: { operation: { kind: "PlatformOperation", id: operation }, target: { input: "objectType" } } },
        },
        inputs: {},
      };
    });
  }
  mocks.detailMapping.mockResolvedValueOnce("no-longer-visible-panel").mockResolvedValueOnce(null);
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: true },
    { status: "ready", payload: true },
    { status: "ready", payload: false },
    { status: "forbidden", error: "Placement denied" },
    { status: "ready", payload: "yes" },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, ids.map(() => opRequest));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(results).toMatchObject([
    { status: "ready", value: { clear: { handlerRef: operation } } },
    { status: "ready", value: { clear: { unavailable: { reason: en["panels.objectDetail.unconfigured"] } } } },
    { status: "ready", value: { clear: { unavailable: { reason: en["panels.objectDetail.configureForbidden"] } } } },
    { status: "forbidden", reason: "Placement denied" },
    { status: "error", code: "PANEL_READ_OWNER_RESPONSE_INVALID" },
  ]);
  expect(results[0]).not.toHaveProperty("value.clear.unavailable");
  expect(mocks.detailMapping.mock.calls).toEqual(ids.slice(0, 2).map(id => [viewer.domainId, id]));
  const calls = mocks.read.mock.lastCall![1] as JavaPanelRead[];
  expect(calls.map(({ call }) => call)).toEqual(projections.map(() => ({
    type: OBJECT_TYPE, name: "detailPanel", parameters: {},
  })));
  expect(fetch).not.toHaveBeenCalled();
});

it("reads detail bindings and forms using one batch item's management and panel USE facts", async () => {
  const panel = { id: "private-detail", name: "Private detail", domainId: viewer.domainId, ownerId: "author" };
  const range = { fixed: false, all: false, objectIds: [], authorId: null };
  const members = ["detailBinding", "detailBindingSummary", "detailPanelForm", "unconfigured", "broken"];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const member of members) {
    const form = member === "detailPanelForm";
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: form ? "panelFormDescription" : "panelRecord" },
      selection: {
        typeId: OBJECT_TYPE, method: form ? "detailPanelForm" : "detailPanel",
        primaryKey: member === "unconfigured" || member === "broken" ? member : "Customer",
      },
      params: {},
    });
  }
  const mappings = new Map([["Customer", panel.id], ["broken", "removed-detail"]]);
  mocks.detailMapping.mockImplementation(async (_domain, className) => mappings.get(className) ?? null);
  mocks.detailPanel.mockImplementation(async (_domain, id) => id === panel.id ? { status: "available", panel } : { status: "missing" });
  mocks.currentProduct.mockResolvedValueOnce(panel);
  const detailReply = { status: "ready" as const, payload: false, visibility: { PANEL: { USE: range } } };
  mocks.read.mockResolvedValueOnce({ viewer, results: members.map(() => detailReply) });

  const prepared = await prepareRegisteredDataReads(credentials, members.map(member => ({ ...request, memberPath: [{ member }] })));
  const replies = await runPreparedDataReads(credentials, prepared);
  const forbidden = { status: "ready", value: { outputs: { panelStatus: "forbidden", panelId: "", canConfigure: false } } };
  expect(replies).toMatchObject([
    forbidden, forbidden,
    { status: "ready", value: { fields: [{ readOnly: true }], values: { panelId: null } } },
    { status: "ready", value: { outputs: { panelStatus: "unconfigured", configured: false } } },
    { status: "ready", value: { outputs: { panelStatus: "unavailable", panelId: "", configured: true } } },
  ]);
  const detailCalls = mocks.read.mock.lastCall![1] as JavaPanelRead[];
  expect(detailCalls).toHaveLength(members.length);
  expect(detailCalls[0]).toMatchObject({
    call: { type: OBJECT_TYPE, name: "detailPanel", parameters: {} }, visibleKinds: [{ kind: "PANEL", verbs: ["USE"] }],
  });
  expect(mocks.detailPanel.mock.calls).toHaveLength(2);
});

it("maps registered customer pages and records from one owner batch keyed by the actual class", async () => {
  const attributes = [
    { className: "Person", name: "id", showName: "Identifier", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
    { className: "Person", name: "name", showName: "Full name", type: "varchar", attrDesc: "", enable: true, businessKey: true, primaryKey: false },
  ];
  const params = {
    page: { number: 2, size: 10 }, size: 3, search: "ali",
    filters: [{ field: "name", operator: "contains", value: "ali" }], sort: { field: "name", order: "desc" },
  };
  const selection = { kind: "customer", typeId: "Person" };
  const pagePlan = { declaration: { result: "panelRecordQuery" }, params, selection: { ...selection, method: "query" } };
  const recordPlan = { declaration: { result: "panelRecord" }, params: {}, selection: { ...selection, method: "record", primaryKey: "p:1" } };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (let i = 0; i < 6; i++) mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  for (const plan of [pagePlan, recordPlan, pagePlan, recordPlan, pagePlan, recordPlan]) mocks.prepare.mockResolvedValueOnce(plan);
  const ready = (answer: unknown) => ({ status: "ready", payload: { attributes, answer } });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ready({ success: true, data: [{ id: "p:1", name: "Alice" }], readable_fields: ["id", "name"], total_count: 7 }),
    ready({ success: true, data: { data: { name: "Alice" } } }),
    ready({ success: true, data: [{ name: "Alice" }], readable_fields: ["name"], total_count: 7 }),
    ready({ success: false, code: "DATA_PERMISSION_DENIED", message: "Owner denied this row" }),
    ready({ success: true, data: [], readable_fields: ["name"], total_count: 0 }),
    { status: "error", error: "Owner could not find this class" },
  ] });
  const readsBefore = mocks.read.mock.calls.length;
  const prepared = await prepareRegisteredDataReads(credentials, Array.from({ length: 6 }, () => request));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(mocks.read).toHaveBeenCalledTimes(readsBefore + 1);
  const query = { type: "customer:ObjectType", name: "query", parameters: {
    classname: "Person", pagenum: 2, pagecount: 3, search: "ali", filters: params.filters, sort: params.sort,
  } };
  const record = { type: "customer:ObjectType", name: "record", parameters: { className: "Person", primaryKey: "p:1" } };
  expect(mocks.read.mock.lastCall?.[1].map((item: { call: unknown }) => item.call)).toEqual([query, record, query, record, query, record]);
  const row = { className: "Person", primaryKey: "p:1", label: "Alice", fields: { id: "p:1", name: "Alice" },
    fieldLabels: { id: "Identifier", name: "Full name" } };
  expect(results).toMatchObject([
    { status: "ready", value: { rows: [row], total: 7, fieldLabels: row.fieldLabels } },
    { status: "ready", value: row },
    { status: "error", code: "NO_READABLE_OBJECT_KEY" },
    { status: "forbidden", reason: "Owner denied this row" },
    { status: "ready", value: { rows: [], total: 0, fieldLabels: { name: "Full name" } } },
    { status: "error", message: "Owner could not find this class" },
  ]);
});

it("uses captured object facts for edit forms and only model facts for create forms", async () => {
  const attribute = { className: "Person", type: "varchar", attrDesc: "", enable: true, businessKey: false };
  const attributes = [
    { ...attribute, name: "id", showName: "Identifier", primaryKey: true },
    { ...attribute, name: "name", showName: "Name", primaryKey: false },
    { ...attribute, name: "note", showName: "Owner note", primaryKey: false, readOnly: true },
  ];
  const declaration = { result: "panelFormDescription" };
  const selection = { kind: "customer", typeId: "Person" };
  const edit = {
    declaration, selection: { ...selection, method: "form", primaryKey: "p:1" },
    params: { values: { id: "not the target", name: "Draft", note: "Read-only override" }, changedField: "/name" },
  };
  const create = { declaration, selection: { ...selection, method: "createForm" }, params: { values: { name: "New" }, changedField: null } };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (let i = 0; i < 6; i++) mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  for (const plan of [edit, create, edit, edit, create, create]) mocks.prepare.mockResolvedValueOnce(plan);
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: { attributes, answer: { success: true, data: { data: { name: "Stored", note: "Owner value" } } } } },
    { status: "ready", payload: { attributes } },
    { status: "error", error: "Object type 'Person' has no primary key attribute" },
    { status: "ready", payload: { attributes, answer: { success: false, code: "DATA_PERMISSION_DENIED", message: "Owner denied this row" } } },
    { status: "ready", payload: { attributes: [] } },
    { status: "error", error: "Owner could not find this class" },
  ] });
  const readsBefore = mocks.read.mock.calls.length;
  const prepared = await prepareRegisteredDataReads(credentials, Array.from({ length: 6 }, () => request));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(mocks.read).toHaveBeenCalledTimes(readsBefore + 1);
  const editCall = { type: "customer:ObjectType", name: "form", parameters: { className: "Person", primaryKey: "p:1" } };
  const createCall = { type: "customer:ObjectType", name: "createForm", parameters: { className: "Person" } };
  expect(mocks.read.mock.lastCall?.[1].map((item: { call: unknown }) => item.call)).toEqual([
    editCall, createCall, editCall, editCall, createCall, createCall,
  ]);
  expect(results).toMatchObject([
    { status: "ready", value: {
      fields: [{ path: "/id", readOnly: true }, { path: "/name", readOnly: false }, { path: "/note", readOnly: true }],
      values: { id: "p:1", name: "Draft", note: "Owner value" }, errors: [],
      save: { method: "PUT", path: "/ontology/objects/Person" },
    } },
    { status: "ready", value: {
      fields: [{ path: "/id", readOnly: false }, { path: "/name", readOnly: false }, { path: "/note", readOnly: true }],
      values: { name: "New" },
      errors: [{ field: "/id", code: "required" }],
      save: { method: "POST", path: "/ontology/objects/Person" },
    } },
    { status: "error", message: "Object type 'Person' has no primary key attribute" },
    { status: "forbidden", reason: "Owner denied this row" },
    { status: "error", message: "Object type 'Person' has no attributes" },
    { status: "error", message: "Owner could not find this class" },
  ]);
});

it("reads customer relationship neighbors in one owner call after locating the placement", async () => {
  const node = { className: "org", primaryKey: "o1" };
  const params = { node, limit: 1, offset: 1 };
  const selection = { kind: "customer", typeId: "person_to_org", method: "neighbors" };
  const attributes = (className: string) => [{
    className, name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, primaryKey: true, businessKey: false,
  }];
  const payload = {
    anchor: { attributes: attributes("org"), answer: { success: true, data: { data: {} } } },
    label: "Staff", typeLabels: {}, targetAttributes: { person: attributes("person") },
    directions: [{ direction: "incoming", targetClass: "person", status: "ok", rows: [{ id: "p3" }] }],
  };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockResolvedValueOnce({ selection, params, declaration: { result: "panelRelationNeighbors" } });
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "ready", payload }] });
  const prepared = await prepareRegisteredDataReads(credentials, [request]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([{
    status: "ready", value: {
      node, edges: [{ relationKind: "person_to_org", direction: "incoming" }],
      neighbors: [{ className: "person", primaryKey: "p3" }], nextOffset: null, total: 2,
    },
  }]);
  expect(mocks.read.mock.lastCall?.[1]).toMatchObject([{
    call: { type: "customer:Relationship", name: "neighbors", parameters: { relationshipId: "person_to_org", ...params } },
  }]);
});

it("reads platform class directories, including model definitions, in the registered data-browser batch", async () => {
  const object = { className: OBJECT_TYPE, primaryKey: "order_archive" };
  const route = "/ontology/objects?selected=order_archive";
  const list = (params: object) => ({
    declaration: { result: "panelRecordQuery" }, selection: { kind: "platform", typeId: ONTOLOGY_TYPE, method: "instances" }, params,
  });
  const record = (target: { className: string; primaryKey: string }) => ({
    declaration: { result: "panelRecord" }, selection: { kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceRecord" }, params: { object: target },
  });
  const rows = list({ className: OBJECT_TYPE, search: "ORDER", page: { number: 2, size: 20 }, size: 1 });
  const reads = [
    rows, record(object), rows, record({ ...object, primaryKey: "deleted" }),
    list({ className: "Order" }), record({ className: "Order", primaryKey: "business-row" }),
  ];
  const directory = { status: "ready", payload: { classDef: [
    { className: "invoice", showName: "Invoice", attrs: [] },
    { className: "order_archive", showName: "Archive", classDesc: "Historical order", attrs: [] },
    { className: "orders", showName: "Active orders", attrs: [] },
    { className: "order_history", showName: "History", attrs: [] },
  ] } };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const read of reads) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce(read);
  }
  const admitted = { status: "ready" };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    admitted, directory, admitted, directory, admitted, { status: "forbidden", error: "Model READ denied" },
    admitted, directory, admitted, admitted,
  ] });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const prepared = await prepareRegisteredDataReads(credentials, reads.map(() => request));
  const [listResult, ...otherResults] = await runPreparedDataReads(credentials, prepared);
  expect(listResult).toMatchObject({
    status: "ready", value: { total: 3, hasMore: true, rows: [{
      ...object, label: "Archive", fields: { detail: "order_archive", description: "Historical order" },
      outputs: { detailPath: route },
    }] },
  });
  expect(listResult).not.toHaveProperty("value.rows.0.outputs.typeLabel");
  expect(otherResults).toMatchObject([
    { status: "ready", value: { ...object, outputs: { typeLabel: expect.any(String), detailPath: route } } },
    { status: "forbidden", reason: "Model READ denied" },
    { status: "error", message: "Object not found: platform:ObjectType~deleted" },
    { status: "error", message: "Unknown platform ontology type: Order" },
    { status: "error", message: "Unknown platform ontology type: Order" },
  ]);
  const fact = { type: ONTOLOGY_TYPE, name: "modelInstanceDirectory", parameters: { type: OBJECT_TYPE } };
  expect((mocks.read.mock.lastCall![1] as JavaPanelRead[]).map(({ call }) => call))
    .toEqual([undefined, fact, undefined, fact, undefined, fact, undefined, fact, undefined, undefined]);
  expect(mocks.locate).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the exact Trigger detail and the P1 library gate for platform browser reads", async () => {
  const trigger = (primaryKey: string) => ({
    declaration: { result: "panelRecord" }, selection: { kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceRecord" },
    params: { object: { className: TRIGGER, primaryKey } },
  });
  const skill = {
    declaration: { result: "panelRecordQuery" }, selection: { kind: "platform", typeId: ONTOLOGY_TYPE, method: "instances" },
    params: { className: SKILL, search: "ontomato-analyst-assistant" },
  };
  const reads = [trigger(triggerFixture.id), trigger("missing"), skill, skill];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const read of reads) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce(read);
  }
  const admitted = { status: "ready" };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    admitted, { status: "ready", payload: triggerFixture },
    admitted, { status: "error", code: "TASK_NOT_FOUND", error: "Trigger or run not found" },
    admitted, { status: "forbidden", error: "Skill library denied" },
    admitted, { status: "ready", payload: true },
  ] });
  const analyst = { namespace: { kind: "provider" as const, provider: "ontology" }, name: "ontomato-analyst-assistant" };
  mocks.skills.mockResolvedValueOnce({ registry: { getSkills: () => [generatedSkillEntry(analyst)] } });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const prepared = await prepareRegisteredDataReads(credentials, reads.map(() => request));
  const results = await runPreparedDataReads(credentials, prepared);
  expect(results).toMatchObject([
    { status: "ready", value: { primaryKey: triggerFixture.id, fields: { status: "PUBLISHED", version: 1 },
      outputs: { typeLabel: expect.any(String), detailPath: "/schedules?taskId=tr-1" } } },
    { status: "error", message: "Trigger or run not found" },
    { status: "forbidden", reason: "Skill library denied" },
    { status: "ready", value: { total: 1, rows: [{ className: SKILL, outputs: { detailPath: expect.stringContaining("/ontology/skills/detail?selected=") } }] } },
  ]);
  const skillFact = { type: SKILL, name: "count", parameters: {} };
  expect((mocks.read.mock.lastCall![1] as JavaPanelRead[]).map(({ call }) => call)).toEqual([
    undefined, { type: TRIGGER, name: "record", parameters: { primaryKey: triggerFixture.id } },
    undefined, { type: TRIGGER, name: "record", parameters: { primaryKey: "missing" } },
    undefined, skillFact, undefined, skillFact,
  ]);
  expect(mocks.skills).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps data-browser instance paths, type labels and owner read states in the registered batch", async () => {
  const object = { className: "Person", primaryKey: "p:1" };
  const attributes = [
    { className: "Person", name: "id", showName: "Identifier", type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey: true },
  ];
  const type = {
    className: "Person", showName: "People", classDesc: "", attributeCount: 1, businessKeyCount: 0, relationshipCount: 1,
    primaryKey: { status: "ok", count: 1, name: "id" },
  };
  const plan = (method: string, params: object, result: string) => ({
    declaration: { result }, params, selection: { kind: "platform", typeId: OBJECT_TYPE, method },
  });
  const instances = plan("instances", { className: object.className }, "panelRecordQuery");
  const record = plan("instanceRecord", { object }, "panelRecord");
  const neighbors = plan("instanceNeighbors", { node: object, targetClass: "Department", direction: "outgoing", limit: 5 }, "panelGraphNeighbors");
  const recordAnswer = (answer: object) => ({ status: "ready", payload: { record: { attributes, answer }, type } });
  const preparedReads = [instances, record, neighbors, instances, record, record];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const prepared of preparedReads) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce(prepared);
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: { attributes, answer: { success: true, data: [{ id: "p:1" }], readable_fields: ["id"], total_count: 1 } } },
    recordAnswer({ success: true, data: { data: {} } }),
    { status: "ready", payload: { success: true, status: "READY", data: {
      nodes: [{ class: "Person", primaryKey: "p:1" }, { class: "Department", primaryKey: "engineering" }],
      edges: [{ from: object, to: { className: "Department", primaryKey: "engineering" }, type: "belongs-to" }],
      relations: [{ relationKind: "belongs-to", status: "ok", edgeCount: 1 }],
      version: "current",
    } } },
    { status: "ready", payload: { attributes, answer: { success: false, code: "NO_VISIBLE_FIELDS", message: "No visible fields" } } },
    recordAnswer({ success: false, code: "OBJECT_NOT_FOUND", message: "Missing instance" }),
    recordAnswer({ success: false, code: "DATA_PERMISSION_DENIED", message: "Unreadable instance" }),
  ] });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const prepared = await prepareRegisteredDataReads(credentials, preparedReads.map(() => request));
  const detailPath = panelAddress("/browser/views", { selected: object });
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: { rows: [{ outputs: { detailPath } }], total: 1 } },
    { status: "ready", value: { outputs: { detailPath, typeLabel: "People" } } },
    { status: "ready", value: {
      node: object, neighbors: [{ className: "Department", primaryKey: "engineering" }],
      edges: [{ relationKind: "belongs-to", direction: "outgoing" }], relations: [{ edgeCount: 1 }], version: "current",
    } },
    { status: "error", code: "NO_VISIBLE_FIELDS", message: "No visible fields" },
    { status: "error", message: "Missing instance" },
    { status: "forbidden", reason: "Unreadable instance" },
  ]);
  const calls = mocks.read.mock.lastCall![1].map(({ call }: { call: unknown }) => call);
  expect(calls.slice(0, 3)).toEqual([
    { type: OBJECT_TYPE, name: "instances", parameters: { classname: "Person", pagenum: 1, pagecount: 20 } },
    { type: OBJECT_TYPE, name: "instanceRecord", parameters: object },
    { type: OBJECT_TYPE, name: "instanceNeighbors", parameters: { node: object, neighborClass: "Department", direction: "outgoing", limit: 5 } },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it("presents the five registered business graph reads with the owner's sample, version and readiness states", async () => {
  const sample = { version: "v1", sampleToken: "sample-1" };
  const node = { className: "Person", primaryKey: "p1" };
  const group = { class: "Person", classLabel: "People", instanceCount: 2, sampleCount: 1 };
  const rawNode = { class: "Person", primaryKey: "p1", name: "Avery", classLabel: "People" };
  const ready = (data: object) => ({ status: "ready", payload: { success: true, status: "READY", data } });
  const notReady = (status: string) => ({ status: "ready", payload: { success: true, status } });
  const refused = (code: string) => ({ status: "ready", payload: { success: false, code, message: "Owner response" } });
  const overview = ready({ ...sample, classes: [group], overviewNodes: [rawNode], nodeCount: 2, relationTypes: ["knows"] });
  const connections = ready({
    version: sample.version,
    overviewEdges: [{ from: node, to: { className: "Person", primaryKey: "p2" }, type: "knows" }],
    overviewEdgesTruncated: true,
  });
  const searchParams = { search: "ave", className: "Person", version: sample.version };
  const reads = [
    ["instanceGraphOverview", "panelGraphOverview", {}, overview],
    ["instanceGraphConnections", "panelGraphConnections", sample, connections],
    ["instanceGraphStatistics", "panelGraphCounts", {}, ready({ classes: [group] })],
    ["instanceGraphClasses", "panelRecordList", {}, overview],
    ["instanceGraphSearch", "panelRecordQuery", searchParams, ready({ nodes: [rawNode], total: 3, hasMore: true })],
    ["instanceGraphConnections", "panelGraphConnections", { version: "old" }, refused("GRAPH_VERSION_CHANGED")],
    ["instanceGraphConnections", "panelGraphConnections", sample, refused("GRAPH_SAMPLE_EXPIRED")],
    ["instanceGraphOverview", "panelGraphOverview", {}, notReady("GENERATING")],
    ["instanceGraphClasses", "panelRecordList", {}, notReady("NOT_GENERATED")],
    ["instanceGraphStatistics", "panelGraphCounts", {}, notReady("GENERATING")],
  ] as const;
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const [method, result, params] of reads) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result }, params, selection: { kind: "platform", typeId: OBJECT_TYPE, method },
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer, results: reads.map(([, , , reply]) => reply) });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);

  const prepared = await prepareRegisteredDataReads(credentials, reads.map(() => request));
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: {
      status: "READY", ...sample, nodes: [node], groups: [{ id: "Person", label: "People", totalCount: 2, sampleCount: 1 }],
    } },
    { status: "ready", value: { version: "v1", edges: [{ relationKind: "knows" }], truncated: true } },
    { status: "ready", value: { counts: [{ type: "Person", layer: "fact", status: "ok", count: 2 }] } },
    { status: "ready", value: [{ className: OBJECT_TYPE, primaryKey: "Person", fields: { instanceCount: 2, sampleCount: 1 } }] },
    { status: "ready", value: { rows: [{ ...node, label: "Avery" }], total: 3, hasMore: true } },
    { status: "error", code: "GRAPH_VERSION_CHANGED", message: en["panels.objectDetail.graphVersionChanged"] },
    { status: "error", message: en["panels.objectDetail.graphSampleExpired"] },
    { status: "ready", value: { status: "GENERATING", groups: [], nodes: [] } },
    { status: "empty" },
    { status: "error", message: en["panels.objectDetail.graphUnavailable"] },
  ]);
  const calls = mocks.read.mock.lastCall![1].map(({ call }: { call: unknown }) => call);
  expect(calls.slice(0, 6)).toEqual([
    { type: OBJECT_TYPE, name: "instanceGraphOverview", parameters: {} },
    { type: OBJECT_TYPE, name: "instanceGraphConnections", parameters: sample },
    { type: OBJECT_TYPE, name: "instanceGraphStatistics", parameters: {} },
    { type: OBJECT_TYPE, name: "instanceGraphClasses", parameters: {} },
    { type: OBJECT_TYPE, name: "instanceGraphSearch", parameters: { term: "ave", class: "Person", version: "v1" } },
    { type: OBJECT_TYPE, name: "instanceGraphConnections", parameters: { version: "old" } },
  ]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("reads only the verified viewer's pinned objects in one batch and keeps unavailable rows in order", async () => {
  const pinned = [
    { className: "Customer", primaryKey: "c/1", title: "Saved name" },
    { className: "Order", primaryKey: "missing", title: "Deleted order" },
    { className: "Customer", primaryKey: "revoked", title: "Old private name" },
    { className: "Removed", primaryKey: "removed", title: "Removed class" },
    { className: "Private", primaryKey: "hidden", title: "Removed model permission" },
  ];
  const attribute = { className: "Customer", type: "varchar", attrDesc: "", enable: true };
  const attributes = [
    { ...attribute, name: "id", showName: "ID", businessKey: false, primaryKey: true },
    { ...attribute, name: "name", showName: "Name", businessKey: true, primaryKey: false },
  ];
  const ready = (answer: unknown) => ({ status: "ready", payload: { attributes, answer } });
  const unavailable = tForLocale(credentials.locale, "panels.favorite.unavailable");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockImplementationOnce(async () => {
    expect(mocks.favoriteState).not.toHaveBeenCalled();
    return { viewer, entries: [{ kind: "ready", entry }] };
  });
  mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
    collectUse("projection", { id: "pinned-objects", domainId: viewer.domainId, ownerId: "author" });
    return { inputs: {}, projection: {} };
  }).mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
    collectUse("projection", { id: "pinned-objects", domainId: viewer.domainId, ownerId: "author" });
    return { inputs: {}, projection: {} };
  });
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordList" }, selection: { typeId: FAVORITE, method: "list" },
    params: { targetGroup: "objects", className: "Spoofed", primaryKey: "not-a-favorite" },
  }).mockResolvedValueOnce({
    declaration: { result: "panelRecordList" }, selection: { typeId: FAVORITE, method: "list" }, params: {},
  });
  mocks.favoriteState.mockResolvedValue({ favorites: [], dashboardIds: [], dashboardCards: {}, pinnedSessions: [], pinnedObjects: pinned });
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready" },
    ready({ success: true, data: { data: { name: "Current name" } } }),
    ready({ success: false, code: "OBJECT_NOT_FOUND", message: "Object missing" }),
    ready({ success: false, code: "DATA_PERMISSION_DENIED", message: "Row permission revoked" }),
    { status: "error", code: "OBJECT_TYPE_NOT_FOUND", error: "Class removed" },
    { status: "forbidden", error: "Model permission revoked" },
    { status: "error", code: "PANEL_READ_UNKNOWN", error: "Read not registered" },
    ...pinned.map(() => ({ status: "ready" })),
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [request, request]);
  expect(mocks.favoriteState).toHaveBeenCalledTimes(1);
  expect(mocks.favoriteState).toHaveBeenCalledWith(viewer);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: [
      { primaryKey: "c/1", label: "Current name", outputs: {
        openPath: "/browser/views/Customer?key=c%2F1&from=workspace", canMoveUp: false, canMoveDown: true, unavailable: false,
      } },
      ...pinned.slice(1).map(({ primaryKey }, index) => ({
        primaryKey, label: unavailable, outputs: {
          unavailable: true, openPath: "", canMoveUp: true, canMoveDown: index < pinned.length - 2,
        },
      })),
    ] },
    { status: "error", code: "PANEL_READ_UNKNOWN" },
  ]);
  const [owner, batch] = mocks.read.mock.lastCall!;
  expect(owner).toEqual(viewer);
  const use = { target: { kind: "PROJECTION", id: "pinned-objects", domainId: viewer.domainId } };
  const objectCalls = pinned.map(({ className, primaryKey }) => ({
    type: "customer:ObjectType", name: "record", parameters: { className, primaryKey },
  }));
  expect(batch).toHaveLength((pinned.length + 1) * 2);
  expect(batch[0]).not.toHaveProperty("call");
  expect(batch.slice(1, pinned.length + 1).map(({ call }: { call?: unknown }) => call)).toEqual(objectCalls);
  expect(batch[pinned.length + 1]).toMatchObject({
    call: { type: APPLICATION, name: "navigation", parameters: {} },
    visibleKinds: [{ kind: "AGENT", verbs: ["USE"] }],
  });
  expect(batch.slice(pinned.length + 2).map(({ call }: { call?: unknown }) => call)).toEqual(objectCalls);
  for (const item of batch) expect(item.uses).toMatchObject([use]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves denied favorite placements and real owner failures in one objects batch", async () => {
  const pinned = [{ className: "Customer", primaryKey: "c1", title: "Saved name" }];
  const state = { favorites: [], dashboardIds: [], dashboardCards: {}, pinnedSessions: [], pinnedObjects: pinned };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (let index = 0; index < 3; index += 1) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelRecordList" }, selection: { typeId: FAVORITE, method: "list" }, params: { targetGroup: "objects" },
    });
  }
  mocks.pinnedObjects.mockResolvedValueOnce(pinned);
  mocks.favoriteState.mockResolvedValue(state);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "forbidden", error: "Placement denied" },
    { status: "error", code: "PANEL_READ_ERROR", error: "Ignored under denied placement" },
    { status: "ready" },
    { status: "error", code: "PANEL_READ_ERROR", error: "The owner read failed" },
    { status: "ready" },
    { status: "ready", payload: { attributes: [], answer: { success: false, code: "QUERY_FAILED", message: "Data query failed" } } },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [request, request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([
    { status: "forbidden", reason: "Placement denied" },
    { status: "error", code: "PANEL_READ_ERROR", message: "The owner read failed" },
    { status: "error", code: "CUSTOMER_OBJECT_READ_FAILED", message: "Data query failed" },
  ]);
  const [, batch] = mocks.read.mock.lastCall!;
  expect(batch).toHaveLength(6);
  for (const index of [0, 2, 4]) expect(batch[index]).not.toHaveProperty("call");
  for (const index of [1, 3, 5]) expect(batch[index]).toMatchObject({ call: {
    type: "customer:ObjectType", name: "record", parameters: { className: "Customer", primaryKey: "c1" },
  } });
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it("returns an empty objects favorite list without a customer record fact", async () => {
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordList" }, selection: { typeId: FAVORITE, method: "list" }, params: { targetGroup: "objects" },
  });
  mocks.pinnedObjects.mockResolvedValueOnce([]);
  mocks.favoriteState.mockResolvedValue({ favorites: [], dashboardIds: [], dashboardCards: {}, pinnedSessions: [], pinnedObjects: [] });
  mocks.read.mockResolvedValueOnce({ viewer, results: [{ status: "ready" }] });

  const prepared = await prepareRegisteredDataReads(credentials, [request]);
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([{ status: "empty" }]);
  const [, batch] = mocks.read.mock.lastCall!;
  expect(batch).toHaveLength(1);
  expect(batch[0]).not.toHaveProperty("call");
});

it("starts the platform graph with the directory's own member label or the second authenticated viewer", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.locate.mockResolvedValueOnce({ viewer: { ...viewer, userName: "Old name" }, entries: [{ kind: "ready", entry }] });
  for (const member of ["member-label", "directory-denied", "no-member", "missing-fact", "placement-denied"]) {
    mocks.resolve.mockImplementationOnce(async (_owner, _credentials, _request, _cache, collectUse) => {
      collectUse("projection", { id: member, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: {}, projection: {} };
    });
    mocks.prepare.mockResolvedValueOnce({
      declaration: { result: "panelGraphStart" }, selection: { typeId: ONTOLOGY_TYPE, method: "start" }, params: {},
    });
  }
  mocks.read.mockResolvedValueOnce({ viewer: { ...viewer, userName: "Verified name" }, results: [
    { status: "ready" }, { status: "ready", payload: "Member name" },
    { status: "ready" }, { status: "forbidden", error: "Members directory refused" },
    { status: "ready" }, { status: "empty" },
    { status: "ready" }, { status: "error", code: "PANEL_READ_UNKNOWN", error: "Missing member fact" },
    { status: "forbidden", error: "Placement refused" }, { status: "forbidden", error: "Placement refused" },
  ] });
  const prepared = await prepareRegisteredDataReads(credentials, [request, request, request, request, request]);
  const node = { className: USER, primaryKey: viewer.userId, layer: "governance" };
  expect(await runPreparedDataReads(credentials, prepared)).toEqual([
    { status: "ready", value: { node: { ...node, label: "Member name" } } },
    { status: "ready", value: { node: { ...node, label: "Verified name" } } },
    { status: "ready", value: { node: { ...node, label: "Verified name" } } },
    { status: "error", message: "Missing member fact", code: "PANEL_READ_UNKNOWN" },
    { status: "forbidden", reason: "Placement refused" },
  ]);
  const batch = mocks.read.mock.lastCall![1];
  expect(batch).toHaveLength(10);
  for (const [index, id] of ["member-label", "directory-denied", "no-member", "missing-fact", "placement-denied"].entries()) {
    const [placement, fact] = batch.slice(index * 2, index * 2 + 2);
    expect(placement).not.toHaveProperty("call");
    expect(fact).toEqual({ ...placement, call: { type: ONTOLOGY_TYPE, name: "start", parameters: {} } });
    expect(fact.uses).toMatchObject([{ target: { id } }]);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the built-in graph search class picker declaration and shares the owner-fact batch with start", async () => {
  const base = new URL("../../../../../ontology-manager/resources/builtin-panels/data-browser/", import.meta.url);
  const panel = JSON.parse(readFileSync(new URL("panel.json", base), "utf8"));
  const member = panel.manifest.members.graphSearchClassPicker;
  const candidates: string[] = member.target.candidates.projectionIds;
  const projections = JSON.parse(readFileSync(new URL("projections.json", base), "utf8")) as {
    id: string; input: Record<string, unknown>;
  }[];
  const { id, input } = projections.find(candidate => candidates.includes(candidate.id)
    && candidate.id === "builtin-product-db-capability-search-class-filter")!;
  const { projectionDefinition } = await import("../render-definitions");
  const { prepareProjectionDataRead } = await vi.importActual<typeof import("../data-reads")>("../data-reads");
  const projection = projectionDefinition({
    id, domainId: null, ownerId: null, definition: input, revision: 1, createdAt: new Date(0), updatedAt: new Date(0),
  }, false);
  const pickerRequest: RegisteredDataRead = { ...request, memberPath: [{ member: "graphSearchClassPicker" }] };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const postgres = await import("../../../infrastructure/postgres");
  const pool = vi.spyOn(postgres, "getPostgresPool").mockReturnValue({
    query: vi.fn().mockResolvedValue({ rows: [{ total: 0 }] }),
  } as unknown as ReturnType<typeof postgres.getPostgresPool>);
  try {
    mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, member, projection }).mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockImplementationOnce(prepareProjectionDataRead).mockResolvedValueOnce({
      declaration: { result: "panelGraphStart" }, selection: { kind: "platform", typeId: ONTOLOGY_TYPE, method: "start" }, params: {},
    });
    mocks.read.mockImplementationOnce(async (_actor, reads: readonly JavaPanelRead[]) => ({
      viewer: { ...viewer, userName: "Current reader" },
      results: reads.map(({ call }): JavaPanelReadResult => {
        switch (call?.name) {
          case "metadataCounts": return { status: "ready", payload: { objectTypes: 2, attributes: 3, relationships: 4 } };
          case "organizationCounts": return { status: "forbidden", error: "Organization refused" };
          case "count": if (call.type === SKILL) return { status: "ready", payload: true };
            return { status: "ready", payload: { total: 1 } };
          case "start": return { status: "empty" };
          default: return { status: "ready", payload: { total: 1, outsideDirectory: 0 } };
        }
      }),
    }));
    const prepared = await prepareRegisteredDataReads(credentials, [pickerRequest, request]);
    const [classes, start] = await runPreparedDataReads(credentials, prepared);
    expect(classes).toMatchObject({
      status: "ready",
      value: expect.arrayContaining([
        expect.objectContaining({ primaryKey: OBJECT_TYPE, fields: expect.objectContaining({ count: 2, countStatus: "ok", countDisplay: "2" }) }),
        expect.objectContaining({ primaryKey: "platform:OrgUnit", fields: expect.objectContaining({ countStatus: "refused", countReason: "Organization refused" }) }),
        expect.objectContaining({ primaryKey: SKILL, fields: expect.objectContaining({ countStatus: "failed" }) }),
      ]),
    });
    expect(start).toMatchObject({ status: "ready", value: { node: { primaryKey: viewer.userId, label: "Current reader" } } });
    expect(mocks.locate).toHaveBeenCalledTimes(1);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    const calls = (mocks.read.mock.lastCall![1] as JavaPanelRead[]).flatMap(read => read.call ? [read.call.name] : []);
    expect(calls.filter(name => name === "metadataCounts")).toHaveLength(1);
    expect(calls).not.toContain("instanceGraphClasses");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    pool.mockRestore();
  }
});

it("uses admitted builder project facts for detail, publish and operations without separate Java reads", async () => {
  const { appBuilderProjectStore } = await import("../../app-builder/project-store");
  const { RuntimeClient } = await import("../../../infrastructure/agent-runtime/client");
  const java = vi.spyOn(await import("../../../utils/backend-client"), "backendGet")
    .mockRejectedValue(new Error("Unexpected separate Java read"));
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const when = "2026-11-26T00:00:00Z";
  const headCommit = "a".repeat(40);
  const primaryKey = "app-bound";
  const draftId = "app-draft";
  const bound = {
    domainId: viewer.domainId, appId: primaryKey, workspaceId, createdBy: viewer.userId, draftMeta: null,
    createdAt: when, updatedAt: when, lastSyncedCommit: null,
    lastSyncedFingerprint: { kind: "panel" as const, applicationHash: "old", panels: {}, projections: {} },
  };
  const draftMeta = { names: { en: "My draft" }, descriptions: {}, icon: "box" };
  const draft = { ...bound, appId: draftId, draftMeta, lastSyncedFingerprint: null };
  const lookup = vi.spyOn(appBuilderProjectStore, "findByAppId").mockImplementation(async (_domain, appId) =>
    appId === primaryKey ? bound : appId === draftId ? draft : null);
  const owners = vi.spyOn(appBuilderProjectStore, "findResourceOwners").mockResolvedValue(new Map());
  const releases = vi.spyOn(appBuilderProjectStore, "listReleases").mockResolvedValue([]);
  const claim = vi.spyOn(appBuilderProjectStore, "claimUnclaimedResources").mockRejectedValue(new Error("Unexpected resource claim"));
  const create = vi.spyOn(appBuilderProjectStore, "insertProject").mockRejectedValue(new Error("Unexpected materialization"));
  const workspace = vi.spyOn(RuntimeClient.prototype, "request").mockImplementation(async path => {
    if (path.endsWith("/tree")) return { files: [] };
    if (path.includes("/commits?")) return { items: [{ id: headCommit, parentIds: ["b".repeat(40)], message: "Saved source" }] };
    expect(path).toBe("/v1/workspaces/" + workspaceId);
    return { id: workspaceId, name: "Workspace", headCommit, activeRunId: null, createdAt: when, updatedAt: when };
  });
  const catalog = (id: string, canMaintain = true) => ({
    ...draftMeta, names: { en: "Live application" }, id, source: "domain", canMaintain, canEditEntries: canMaintain,
    allowStandalone: true, entryCount: 1, groups: [],
    entry: { path: `/applications/${id}`, renderer: "panels", home: `/applications/${id}/main` },
    panelUses: [{ id: "main", pageKey: "main", panelId: "builtin-product-2fb20dd5-c6b9-4cfa-aeaf-c3b22c01765e",
      path: `/applications/${id}/main`, names: { en: "Main preview" } }],
  });
  const operations = Object.fromEntries([
    ["sync", APPLICATION_SYNC_BUILDER_SOURCE],  ].map(([name, id]) => [name, { operation: { kind: "PlatformOperation", id },
    target: { literal: { className: APPLICATION, primaryKey } } }]));
  const opRequest: RegisteredDataRead = { source, memberPath: request.memberPath, inputs: {}, operations: true };
  const operationPlacement = { inputs: {}, member: {}, projection: { inputs: {}, operations } };
  const detail = (id: string) => ({ declaration: { result: "panelRecord" },
    params: { workspaceId: "ignored-browser-field" }, selection: { typeId: APPLICATION, method: "builderProject", primaryKey: id } });
  const publish = { declaration: { result: "panelFormDescription" },
    params: { values: { icon: "box" }, defaultCommit: headCommit },
    selection: { typeId: APPLICATION, method: "builderPublishForm", primaryKey: draftId } };
  const ready = (payload?: object): JavaPanelReadResult => ({ status: "ready", payload });

  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const read of [detail(primaryKey), publish, detail("app-live"), detail(primaryKey), detail(primaryKey), detail("app-denied")]) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce(read);
  }
  mocks.resolve.mockResolvedValueOnce(operationPlacement).mockResolvedValueOnce(operationPlacement);
  mocks.read.mockImplementationOnce(async () => {
    expect(workspace).not.toHaveBeenCalled();
    return { viewer, results: [
      ready(), ready(catalog(primaryKey)),
      ready(),
      ready(), ready(catalog("app-live")),
      ready(), ready(catalog(primaryKey)),
      ready(), ready(catalog(primaryKey)),
      ready(), ready(catalog("app-denied", false)),
      ready(draftMeta),
      ready(draftMeta),
    ] };
  });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, [
      request, request, request, request, request, request, opRequest, opRequest,
    ]);
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: { label: "Live application", outputs: {
        workspaceId, materialized: true, hasDrift: true,
      } } },
      { status: "ready", value: { values: { name: "My draft", commit: headCommit, icon: "box" },
        save: { path: "/api/app-builder/projects/app-draft/publish" } } },
      { status: "ready", value: { outputs: { materialized: false, sourceKind: "panel" },
        fields: { previewEntries: { value: [{ id: "main", label: "Main preview" }] } } } },
      { status: "ready", value: { outputs: { materialized: true } } },
      { status: "ready", value: { outputs: { materialized: true } } },
      { status: "forbidden" },
      { status: "ready", value: { sync: {} } },
      { status: "ready", value: { sync: {} } },
    ]);
    const calls = mocks.read.mock.lastCall![1].map(({ call }: JavaPanelRead) => call);
    expect(calls.slice(0, 3)).toEqual([
      undefined, { type: APPLICATION, name: "record", parameters: { primaryKey } },
      undefined,
    ]);
    expect(calls.slice(-2)).toEqual([0, 1].map(() =>
      ({ type: APPLICATION, name: "builderProjectMetadata", parameters: { primaryKey } })
    ));
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(java).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  } finally {
    for (const spy of [workspace, create, claim, releases, owners, lookup, java]) spy.mockRestore();
  }
});

it("renders the admitted business product graph with scoped edges and preserves it when edge facts fail", async () => {
  const current = await import("../current");
  const details = await import("../object-detail");
  const postgres = await import("../../../infrastructure/postgres");
  const now = new Date("2026-11-26");
  const row = (id: string, definition: object) => ({
    id, domainId: viewer.domainId, ownerId: viewer.userId, revision: 1, createdAt: now, updatedAt: now,
    definition: { visibility: "domain", name: id, description: "", ...definition },
  });
  const panel = (id: string, members: object) => row(id, { content: { html: "<div />" }, manifest: { state: {}, members } });
  const panels = [
    panel("order-panel", { main: { target: { projectionId: "order-view" } } }),
    panel("unused-panel", {}),
  ];
  const order = { source: { type: { kind: "ObjectType", id: "Order" } }, read: "query", params: {} };
  const projections = [row("order-view", {
    componentId: "@ontomato/sdk:MetricChart", metricId: "order-metric", inputs: {}, outputs: {}, config: {}, data: { rows: order },
    operations: { approve: { operation: { kind: "Action", id: "approve" } } },
  })];
  const definitions = vi.spyOn(current, "readCurrentDefinitionRows").mockImplementation(async (_domain, kind) =>
    kind === "panel" ? panels : projections);
  const mappings = vi.spyOn(details, "listObjectDetailPanelMappings").mockResolvedValue([]);
  const pool = vi.spyOn(postgres, "getPostgresPool").mockReturnValue({} as ReturnType<typeof postgres.getPostgresPool>);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mocks.agents.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  mocks.locate.mockImplementationOnce(async () => {
    expect(definitions).not.toHaveBeenCalled();
    return { viewer, entries: [{ kind: "ready", entry }] };
  });
  for (const member of ["with-edges", "failed-edges"]) {
    mocks.resolve.mockImplementationOnce(async (_viewer, _credentials, _request, _cache, collectUse) => {
      collectUse("projection", { id: member, domainId: viewer.domainId, ownerId: "author" });
      return { inputs: {}, projection: {} };
    });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result: "panelRecord" },
      selection: { typeId: OBJECT_TYPE, method: "productGraph" }, params: {},
    });
  }

  const app = (id: string, panelId: string) => ({
    id, names: { en: id }, canMaintain: true, panelIds: [panelId], defaultAgentIds: [],
  });
  const range = { fixed: false, all: true, objectIds: [], authorId: null };
  const edgeFacts = {
    rolePolicies: [
      { roleId: "reader", policyId: "policy-order", kind: "OBJECT" },
      { roleId: "unused-role", policyId: "policy-unused", kind: "OBJECT" },
    ],
    entries: [{ id: "app-orders/main", applicationId: "app-orders", pageKey: "main", names: { en: "Enter orders" } }],
    policyGrants: [
      { policyId: "policy-order", targetKind: "APPLICATION", targetKey: "app-orders", verb: "EDIT" },
      { policyId: "policy-order", targetKind: "ENTRY", targetKey: "app-orders/main", verb: "ENTER" },
      { policyId: "policy-unused", targetKind: "APPLICATION", targetKey: "app-unused", verb: "EDIT" },
    ],
  };
  const ready = (payload: unknown) => ({ status: "ready" as const, payload });
  const reply = (call: JavaPanelRead["call"], usable: boolean): JavaPanelReadResult => {
    expect(call).toEqual({
      type: OBJECT_TYPE, name: "productGraph", parameters: {
        panelIds: ["order-panel", "unused-panel"], projectionIds: ["order-view"],
        objectTypes: ["Order"], actions: ["approve"], metrics: ["order-metric"],
      },
    });
    return ready({
      panels: ready(range),
      projections: ready(range),
      applications: ready([app("app-orders", "order-panel"), app("app-unused", "unused-panel")]),
      authorization: usable ? ready(edgeFacts) : { status: "forbidden", error: "No authorization facts" },
      objectTypes: { Order: ready("Orders") },
      actions: { approve: { status: "forbidden", error: "No action definition access" } },
      metrics: { "order-metric": ready("Order count") },
    });
  };
  mocks.read.mockImplementationOnce(async (_viewer, batch: JavaPanelRead[]) => ({
    viewer, results: batch.map(({ call, uses, visibleKinds }) => {
      expect(visibleKinds).toBeUndefined();
      return reply(call, uses[0].target.id === "with-edges");
    }),
  }));
  try {
    const prepared = await prepareRegisteredDataReads(credentials, [request, request]);
    const results = await runPreparedDataReads(credentials, prepared);
    expect(results).toMatchObject([
      { status: "ready", value: { fields: { graph: { value: {
        nodes: expect.arrayContaining([
          { id: "object-type:Order", name: "Orders", kind: "object-type", category: "ontology" },
          { id: "metric:order-metric", name: "Order count", kind: "metric", category: "ontology" },
          { id: "action:approve", name: "approve", kind: "action", category: "ontology" },
        ]),
        edges: expect.arrayContaining([
          { source: "policy:policy-order", target: "asset:app-orders", relation: "edit", storage: "governance" },
          { source: "policy:policy-order", target: "entry:app-orders/main", relation: "enter", storage: "governance" },
          { source: "grant:role:reader", target: "policy:policy-order", relation: "uses-policy", storage: "governance" },
        ]),
      } } } } },
      { status: "ready", value: { fields: { graph: { value: {
        edges: expect.arrayContaining([{ source: "asset:app-orders", target: "asset:order-panel", relation: "navigates", storage: "product-index" }]),
      } } } } },
    ]);
    expect(JSON.stringify(results)).not.toContain("policy-unused");
    expect(JSON.stringify(results)).not.toContain("app-unused");
    expect(JSON.stringify(results[1])).not.toContain("policy:policy-order");
    const [, batch] = mocks.read.mock.lastCall!;
    expect(batch).toHaveLength(2);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    pool.mockRestore();
    mappings.mockRestore();
    definitions.mockRestore();
  }
});

it("reads builder source panes from admitted application facts and the original workspace owner", async () => {
  const { appBuilderProjectStore } = await import("../../app-builder/project-store");
  const { RuntimeClient } = await import("../../../infrastructure/agent-runtime/client");
  const { APPLICATION_SOURCE_FILE } = await import("../../app-builder/source-codec");
  const java = vi.spyOn(await import("../../../utils/backend-client"), "backendGet")
    .mockRejectedValue(new Error("Unexpected separate Java read"));
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  const time = "2026-11-26T00:00:00Z";
  const headCommit = "a".repeat(40);
  const meta = { names: { en: "Source application" }, descriptions: {}, icon: "box" };
  const appId = "app-live";
  const draftId = "app-draft";
  const lookup = vi.spyOn(appBuilderProjectStore, "findByAppId").mockImplementation(async (_domain, id) => id === draftId ? {
    domainId: viewer.domainId, appId: draftId, workspaceId, createdBy: viewer.userId, draftMeta: meta,
    createdAt: time, updatedAt: time, lastSyncedCommit: null, lastSyncedFingerprint: null,
  } : null);
  const release = vi.spyOn(appBuilderProjectStore, "listReleases").mockResolvedValue([{
    id: releaseId, domainId: viewer.domainId, appId, commitId: headCommit, publishedBy: viewer.userId, createdAt: time,
  }]);
  const claim = vi.spyOn(appBuilderProjectStore, "claimUnclaimedResources").mockRejectedValue(new Error("Unexpected resource claim"));
  const materialize = vi.spyOn(appBuilderProjectStore, "insertProject").mockRejectedValue(new Error("Unexpected materialization"));
  const runtime = vi.spyOn(RuntimeClient.prototype, "request").mockImplementation(async path => {
    if (path.includes("/diff?")) return { patch: "+ changed" };
    if (path.includes("/commits?")) return { items: [
      { id: headCommit, parentIds: ["b".repeat(40)], message: "Current source", createdAt: time },
      { id: "b".repeat(40), parentIds: [], message: "Initial source", createdAt: time },
    ] };
    expect(path).toBe("/v1/workspaces/" + workspaceId);
    return { id: workspaceId, name: "Draft", headCommit, activeRunId: null, createdAt: time, updatedAt: time };
  });
  const cases = [
    { method: "sourceFiles", id: appId, params: {}, result: "panelRecordList" },
    { method: "sourceFile", id: appId, params: { path: APPLICATION_SOURCE_FILE }, result: "panelRecord" },
    { method: "sourceDiff", id: draftId, params: { target: "working" }, result: "panelRecord" },
    { method: "sourceCommits", id: draftId, params: { cursor: "7", size: 1 }, result: "panelRecordQuery" },
    { method: "sourceReleases", id: appId, params: {}, result: "panelRecordList" },
  ];
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const { method, id, params, result } of cases) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result }, params, selection: { typeId: APPLICATION, method, primaryKey: id } });
  }
  const catalogue = {
    ...meta, id: appId, source: "domain", canMaintain: true, canEditEntries: true, allowStandalone: true,
    entryCount: 0, entry: { path: "/applications/app-live", renderer: "panels" }, groups: [], panelUses: [],
  };
  const ready = (payload?: object) => ({ status: "ready", payload });
  mocks.read.mockImplementationOnce(async () => {
    expect(runtime).not.toHaveBeenCalled();
    return { viewer, results: [
      ready(), ready(catalogue), ready(), ready(catalogue), ready(), ready(), ready(), ready(meta),
    ] };
  });

  try {
    const prepared = await prepareRegisteredDataReads(credentials, cases.map(() => request));
    expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
      { status: "ready", value: [{ primaryKey: APPLICATION_SOURCE_FILE }] },
      { status: "ready", value: { primaryKey: APPLICATION_SOURCE_FILE, fields: { content: expect.stringContaining("Source application") } } },
      { status: "ready", value: { fields: { content: "+ changed", materialized: true } } },
      { status: "ready", value: { rows: [{ primaryKey: headCommit, fields: { isHead: true } }], nextCursor: "8", hasMore: true } },
      { status: "ready", value: [{ primaryKey: releaseId, fields: { isCurrent: true } }] },
    ]);
    expect(mocks.read.mock.lastCall![1].map(({ call }: JavaPanelRead) => call)).toEqual([
      undefined, { type: APPLICATION, name: "record", parameters: { primaryKey: appId } },
      undefined, { type: APPLICATION, name: "record", parameters: { primaryKey: appId } },
      undefined, undefined,
      undefined, { type: APPLICATION, name: "builderProjectMetadata", parameters: { primaryKey: appId } },
    ]);
    expect(runtime).toHaveBeenCalledWith(`/v1/workspaces/${workspaceId}/diff?from=${headCommit}&to=working`);
    expect(runtime).toHaveBeenCalledWith(`/v1/workspaces/${workspaceId}/commits?offset=7&limit=2`);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(java).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  } finally {
    for (const spy of [runtime, materialize, claim, release, lookup, java]) spy.mockRestore();
  }
});

it("describes builder history row actions from the admitted workspace, drift and version facts", async () => {
  const { appBuilderProjectStore } = await import("../../app-builder/project-store");
  const { RuntimeClient } = await import("../../../infrastructure/agent-runtime/client");
  const java = vi.spyOn(await import("../../../utils/backend-client"), "backendGet")
    .mockRejectedValue(new Error("Unexpected separate Java read"));
  const time = "2026-11-26T00:00:00Z";
  const head = "a".repeat(40);
  const older = "b".repeat(40);
  const currentRelease = "11111111-1111-4111-8111-111111111111";
  const olderRelease = "22222222-2222-4222-8222-222222222222";
  const idleWorkspace = "33333333-3333-4333-8333-333333333333";
  const busyWorkspace = "44444444-4444-4444-8444-444444444444";
  const draftMeta = { names: { en: "Project" }, descriptions: {}, icon: "box" };
  const lookup = vi.spyOn(appBuilderProjectStore, "findByAppId").mockImplementation(async (_domain, appId) => ({
    domainId: viewer.domainId, appId, workspaceId: appId === "app-busy" ? busyWorkspace : idleWorkspace, createdBy: viewer.userId,
    draftMeta: appId === "app-draft" || appId === "app-busy" ? draftMeta : null,
    createdAt: time, updatedAt: time, lastSyncedCommit: null,
    lastSyncedFingerprint: appId === "app-drift" ? { kind: "panel", applicationHash: "old", panels: {}, projections: {} } : null,
  }));
  const releases = vi.spyOn(appBuilderProjectStore, "listReleases").mockImplementation(async (domainId, appId) =>
    [currentRelease, olderRelease].map((id, index) => ({
      id, domainId, appId, commitId: index ? older : head, publishedBy: viewer.userId, createdAt: time,
    })),
  );
  const runtime = vi.spyOn(RuntimeClient.prototype, "request").mockImplementation(async path => {
    if (path.includes("/commits?")) return { items: [
      { id: head, parentIds: [older], message: "Current", createdAt: time },
      { id: older, parentIds: [], message: "Older", createdAt: time },
    ] };
    const id = path.split("/").at(-1);
    expect([idleWorkspace, busyWorkspace]).toContain(id);
    return { id, name: "Workspace", headCommit: head, activeRunId: id === busyWorkspace ? busyWorkspace : null,
      createdAt: time, updatedAt: time };
  });
  const cases = [
    ["app-draft", "sourceCommits"],
    ["app-busy", "sourceCommits"],
    ["app-clean", "sourceReleases"],
    ["app-drift", "sourceReleases"],
    ["app-denied", "sourceReleases"],
  ] as const;
  function placement(appId: string, method: string) {
    const commit = method === "sourceCommits";
    const operation = commit ? APPLICATION_RESTORE_SOURCE_COMMIT : APPLICATION_ROLLBACK_BUILDER_RELEASE;
    const key = commit ? "commit" : "releaseId";
    const object = { className: APPLICATION, primaryKey: appId };
    const port = { kind: "object", objectType: APPLICATION };
    return {
      inputs: { app: object }, member: { inputs: { app: { state: "app" } } },
      panel: { manifest: { state: { app: { type: port } }, members: {} } },
      projection: { inputs: { app: port }, data: { rows: { source: { object: { input: "app" } }, read: method } }, operations: {
        [commit ? "restore" : "rollback"]: {
          operation: { kind: "PlatformOperation", id: operation }, target: { input: "app" },
          params: { [key]: { rowField: commit ? "id" : "releaseId" } },
        },
      } },
    };
  }
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const [appId, method] of cases) {
    const resolved = placement(appId, method);
    mocks.resolve.mockResolvedValueOnce(resolved);
    mocks.prepare.mockResolvedValueOnce({ declaration: { result: method === "sourceCommits" ? "panelRecordQuery" : "panelRecordList" },
      selection: { typeId: APPLICATION, method, primaryKey: appId }, inputs: resolved.inputs, params: {},
    });
  }
  mocks.resolve.mockResolvedValueOnce(placement("app-draft", "sourceCommits"))
    .mockResolvedValueOnce(placement("app-clean", "sourceReleases"));
  const ready = (payload?: object) => ({ status: "ready", payload });
  const record = (id: string) => ready({
    ...draftMeta, id, source: "domain", canMaintain: true, canEditEntries: true, allowStandalone: true,
    entryCount: 0, entry: { path: "/applications/" + id, renderer: "panels" }, groups: [], panelUses: [],
  });
  // A history list reads its project's metadata; the fixed application's facts for each row's rollback join the batch.
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    ready(), ready(),
    ready(), ready(draftMeta), record("app-clean"),
    ready(), ready(draftMeta), record("app-drift"),
    ready(), { status: "forbidden", error: "No query admission" }, record("app-denied"),
    ready(), ready(),
  ] });
  const operations: RegisteredDataRead = { source, memberPath: request.memberPath, inputs: {}, operations: true };
  const unavailable = (key: string) => ({
    available: false, unavailable: { reason: tForLocale(credentials.locale, `panels.appBuilder.${key}`) },
  });
  try {
    const prepared = await prepareRegisteredDataReads(credentials, [
      ...cases.map(() => request), operations, operations,
    ]);
    expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
      { status: "ready", rowOperations: {
        [`${APPLICATION}:${head}`]: { restore: unavailable("currentCommit") },
        [`${APPLICATION}:${older}`]: { restore: { available: true } },
      } },
      { status: "ready", rowOperations: {
        [`${APPLICATION}:${head}`]: { restore: unavailable("busy") },
        [`${APPLICATION}:${older}`]: { restore: unavailable("busy") },
      } },
      { status: "ready", rowOperations: {
        [`${APPLICATION}:${currentRelease}`]: { rollback: unavailable("currentRelease") },
        [`${APPLICATION}:${olderRelease}`]: { rollback: { available: true } },
      } },
      { status: "ready", rowOperations: {
        [`${APPLICATION}:${olderRelease}`]: { rollback: unavailable("driftBlocking") },
      } },
      { status: "forbidden", reason: "No query admission" },
      { status: "ready", value: { restore: { effect: "write" } } },
      { status: "ready", value: { rollback: { effect: "write" } } },
    ]);
    const calls = mocks.read.mock.lastCall![1].map(({ call }: JavaPanelRead) => call);
    expect(calls.filter(Boolean)).toEqual(["app-clean", "app-drift", "app-denied"].flatMap(primaryKey => [
      { type: APPLICATION, name: "builderProjectMetadata", parameters: { primaryKey } },
      { type: APPLICATION, name: "record", parameters: { primaryKey } },
    ]));
    // The commit pages' workspaces, then each fixed application's workspace for its restore or rollback rule.
    expect(runtime.mock.calls.filter(([path]) => !path.includes("/commits?"))).toHaveLength(6);
    // The release list for each history page, and again for each rollback's current release.
    expect(releases).toHaveBeenCalledTimes(4);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(java).not.toHaveBeenCalled();
  } finally {
    for (const spy of [runtime, releases, lookup, java]) spy.mockRestore();
  }
});

it("maps execution user option pages and repeated selected IDs from one registered batch", async () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const deleted = "22222222-2222-4222-8222-222222222222";
  const first = { keyword: "ali", page: { number: 1, size: 10 } };
  const second = { ...first, page: { number: 2, size: 10 } };
  const values = [deleted, null, user, deleted];
  const texts = (key: string) => tForLocale(credentials.locale, `panels.agentOptions.${key}`);
  const own = { primaryKey: "@default", value: null, label: texts("executionOwn") };
  const member = { primaryKey: user, value: user, label: "Alice" };
  const unavailable = { primaryKey: deleted, value: deleted, label: deleted, unavailable: { reason: texts("deleted") } };
  mocks.locate.mockResolvedValueOnce({ viewer, entries: [{ kind: "ready", entry }] });
  for (const [method, params] of [["options", first], ["options", second], ["resolve", { values }]] as const) {
    mocks.resolve.mockResolvedValueOnce({ inputs: {}, projection: {} });
    mocks.prepare.mockResolvedValueOnce({ declaration: { result: "panelOptionList" },
      params, selection: { typeId: USER, method } });
  }
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const unavailableSelection = { id: deleted, name: deleted, available: false, reason: "deleted" };
  mocks.read.mockResolvedValueOnce({ viewer, results: [
    { status: "ready", payload: [{ id: user, name: "Alice" }] },
    { status: "ready", payload: [{ id: user, name: "Alice" }] },
    { status: "ready", payload: [unavailableSelection, { id: user, name: "Alice", available: true }, unavailableSelection] },
  ] });

  const prepared = await prepareRegisteredDataReads(credentials, [request, request, request]);
  expect(await runPreparedDataReads(credentials, prepared)).toMatchObject([
    { status: "ready", value: { options: [own, member] } },
    { status: "ready", value: { options: [member] } },
    { status: "ready", value: { options: [unavailable, own, member, unavailable] } },
  ]);
  expect(mocks.read.mock.lastCall![1].map(({ call }: JavaPanelRead) => call)).toEqual([
    { type: USER, name: "options", parameters: { keyword: "ali", pageNum: 1, pageSize: 10 } },
    { type: USER, name: "options", parameters: { keyword: "ali", pageNum: 2, pageSize: 10 } },
    { type: USER, name: "resolve", parameters: { ids: [deleted, user, deleted] } },
  ]);
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
