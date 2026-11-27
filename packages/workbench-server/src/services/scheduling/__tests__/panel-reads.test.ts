import { afterEach, expect, it, vi } from "vitest";
import { TRIGGER, USER } from "@ontomato/contracts/panel-client-requests";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import examples from "../../../../../contracts/examples/platform-schedules.json";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { unwrapReadDirective } from "../../product-panels/read-directive";
import { prepareRegisteredTriggerRead } from "../registered-trigger-reads";
import { triggerFixture } from "./fixtures";
import type { JavaPanelReadResult } from "../../product-panels/java-panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../../identity/management", () => ({ assertManagement: vi.fn(async () => {}) }));
const directory = vi.hoisted(() => ({ agents: vi.fn(), caseSets: vi.fn(), opsDiagnosis: vi.fn() }));
vi.mock("../../assistant/store", () => ({ assistantStore: { agents: directory.agents, opsDiagnosis: directory.opsDiagnosis } }));
vi.mock("../../assistant/service", () => ({ assistantService: {} }));
vi.mock("../../ops-diagnosis/service", () => ({ diagnosisService: {} }));
vi.mock("../../assistant/authorization", async original => ({
  ...await original<typeof import("../../assistant/authorization")>(),
  allowedAgents: async (agents: { permitted: boolean }[]) => agents.filter(agent => agent.permitted),
}));
vi.mock("../../../platform/diagnosis/autotest/cases/repository", () => ({ listCaseSets: directory.caseSets }));
directory.agents.mockResolvedValue([]);
directory.caseSets.mockReturnValue([{ id: "set-regression", name: "Regression suite", caseCount: 12 }]);

const task = examples.creates.find(create => create.name === "operations-autotest")!.response;
const owner = { userId: "test-member", domainId: "test-domain" };
const viewer = { token: "test-viewer", locale: "en" };
const catalogue = {
  success: true,
  data: ["agents", "operations"].map(id => ({
    id, kind: "native", names: { en: id === "operations" ? "Operations center" : id },
    descriptions: {}, icon: "apps", rail: "apps", category: "business", sort: 0,
    entry: { path: `/${id}`, entryKey: id }, scheduleAdapter: `workbench:${id}`, releaseId: null, entryAvailable: true,
  })),
};

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("uses searchable members for the registered picker and marks unmatched selections unavailable", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const visible = { id: "member-jordan", name: "Jordan", kind: "member" };
  const inactive = "member-disabled";
  const directoryResult = (...options: (typeof visible)[]): JavaPanelReadResult => ({ status: "ready", payload: { options } });
  const directorySearch = (keyword: string, limit: number) => ({
    call: { type: USER, name: "principalDirectory", parameters: { kind: "member", keyword, limit } },
  });
  const options = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "memberOptions" },
    { keyword: "Jordan", page: { number: 1, size: 12 } }, viewer)!;
  expect(options.facts).toEqual([directorySearch("Jordan", 12)]);
  expect(await options.present(owner, [directoryResult(visible)]))
    .toMatchObject({ options: [{ value: visible.id, label: visible.name }] });

  const resolve = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "memberResolve" },
    { values: [inactive, visible.id, inactive] }, viewer)!;
  expect(resolve.facts).toEqual([directorySearch(inactive, 100), directorySearch(visible.id, 100)]);
  expect(await resolve.present(owner, [directoryResult(visible), directoryResult(visible)]))
    .toMatchObject({ options: [
      { value: inactive, label: inactive, unavailable: { reason: expect.any(String) } },
      { value: visible.id, label: visible.name },
      { value: inactive, label: inactive, unavailable: { reason: expect.any(String) } },
    ] });
  expect(fetch).not.toHaveBeenCalled();
});

it("presents the registered trigger catalogue from the task owner and admitted application label facts", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const plan = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "catalogue" },
    { scope: "application", search: "Regression suite" }, viewer)!;
  expect(plan.facts).toEqual([
    { call: { type: TRIGGER, name: "list", parameters: {} } },
    { call: { type: "platform:Application", name: "scheduleTargets", parameters: {} } },
    { call: { type: TRIGGER, name: "applicationLabelAccess", parameters: {} }, visibleKinds: [{ kind: "AGENT", verbs: ["USE"] }] },
  ]);
  const access = {
    status: "ready" as const,
    payload: { inspection: { allowed: false, reason: "Inspection refused" }, caseSets: { allowed: true } },
    visibility: { AGENT: { USE: { fixed: false, all: false, authorId: null, objectIds: [] } } },
  };
  const { value } = unwrapReadDirective(await plan.present(owner, [
    { status: "ready", payload: { tasks: [task, triggerFixture], timeZone: "UTC" } },
    { status: "ready", payload: catalogue.data },
    access,
  ]));
  const rows = panelReadResultSchemas.panelRecordList.parse(value);
  expect(rows).toMatchObject([{ primaryKey: task.id, fields: { targetName: "Regression suite (12)" } }]);
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps native trigger names and masks refused runs in the registered reads", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const list = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "list" }, {}, viewer)!;
  const { value } = unwrapReadDirective(await list.present(owner, [
    { status: "ready", payload: { tasks: [triggerFixture], timeZone: "UTC" } },
    { status: "forbidden", error: "Application directory refused" },
    { status: "forbidden", error: "Application labels refused" },
  ]));
  expect(value).toMatchObject([{ fields: { targetName: triggerFixture.targetName } }]);
  const history = prepareRegisteredTriggerRead({
    kind: "platform", typeId: TRIGGER, method: "runRecord", primaryKey: triggerFixture.id,
  }, {}, viewer)!;
  expect(history.facts).toEqual([{ call: { type: TRIGGER, name: "runRecord", parameters: { primaryKey: triggerFixture.id } } }]);
  expect(await history.present(owner, [{
    status: "ready", payload: { task: triggerFixture, history: { runs: [], nextCursor: null } },
  }])).toMatchObject({ fields: { timeZone: "UTC" }, outputs: { status: "", isRunning: false } });
  await expect(async () => history.present(owner, [{ status: "error", code: "TASK_NOT_FOUND", error: "Trigger or run not found" }]))
    .rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  expect(fetch).not.toHaveBeenCalled();
});

function triggerFormFacts(agentIds: readonly string[] = []): [JavaPanelReadResult, JavaPanelReadResult, JavaPanelReadResult] {
  return [
    { status: "ready", payload: { actions: [{ id: "post", name: "Post orders", description: null }], workflows: [] } },
    { status: "ready", payload: catalogue.data.map(app => app.id === "agents" ? { ...app, scheduleAdapter: "java:agents" } : app) },
    { status: "ready", payload: { inspection: { allowed: true }, caseSets: { allowed: false, reason: "Case sets refused" } },
      visibility: { AGENT: { USE: { fixed: false, all: false, authorId: null, objectIds: [...agentIds] } } } },
  ];
}

it("keeps a native Trigger create draft in Node and shows only its admitted Java targets", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const plan = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "createForm" }, {
    values: { task: { title: "Draft orders", targetKind: "action", targetId: "private-action" } }, changedField: "/task/targetId",
  }, viewer)!;
  expect(plan.facts.map(fact => fact.call)).toEqual([
    { type: TRIGGER, name: "createForm", parameters: {} },
    { type: TRIGGER, name: "targets", parameters: {} },
    { type: "platform:Application", name: "scheduleTargets", parameters: {} },
    { type: TRIGGER, name: "applicationLabelAccess", parameters: {} },
  ]);
  const form = panelReadResultSchemas.panelFormDescription.parse(await plan.present(owner, [
    { status: "ready", payload: { timeZone: "UTC" } }, ...triggerFormFacts(),
  ]));
  expect(form.values.task).toMatchObject({ title: "Draft orders", targetKind: "action", targetId: "private-action", timeZone: "UTC" });
  expect(form.fields.find(field => field.path === "/task/targetId")?.control).toMatchObject({
    kind: "select", options: expect.arrayContaining([expect.objectContaining({ value: "post", label: "Post orders" })]),
  });
  expect(form.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "/task/targetId", code: "invalid_option" })]));
  expect(form.save.path).toContain("/platform/triggers");
  expect(fetch).not.toHaveBeenCalled();
});

it("reads the original agent form using the stored task and present edit and use decisions", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  const agentId = agentTask.content.agentId!;
  directory.agents.mockClear().mockResolvedValue([{
    id: agentId, name: "Inventory assistant", description: "", enabled: true,
    domain_id: owner.domainId, owner_id: "another-member",
  }]);
  const plan = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "form", primaryKey: agentTask.id },
    { values: { instruction: "Review new inventory" } }, viewer)!;
  expect(plan.facts[0]).toEqual({ call: { type: TRIGGER, name: "form", parameters: { primaryKey: agentTask.id } } });
  await expect(plan.present(owner, [
    { status: "ready", payload: { task: agentTask, edit: { allowed: false, reason: "Edit refused" } } },
    ...triggerFormFacts([agentId]),
  ])).rejects.toMatchObject({ status: 403, message: "Edit refused" });
  expect(directory.agents).not.toHaveBeenCalled();
  const state = { status: "ready" as const, payload: { task: agentTask, edit: { allowed: true } } };
  const form = panelReadResultSchemas.panelFormDescription.parse(await plan.present(owner, [state, ...triggerFormFacts([agentId])]));
  expect(form.values).toMatchObject({ agentId, instruction: "Review new inventory" });
  expect(form.revision).toBe(agentTask.revision);
  expect(form.errors).toEqual([]);
  const forbidden = panelReadResultSchemas.panelFormDescription.parse(await plan.present(owner, [state, ...triggerFormFacts()]));
  expect(forbidden.fields.find(field => field.path === "/agentId")?.control).toMatchObject({
    kind: "select", options: [expect.objectContaining({ value: agentId, label: agentId, disabled: true, disabledReason: "Agent use permission required" })],
  });
  const [targets, , access] = triggerFormFacts([agentId]);
  await expect(plan.present(owner, [
    state, targets,
    { status: "ready", payload: catalogue.data.map(app => app.id === "agents" ? { ...app, scheduleAdapter: "java:other" } : app) },
    access,
  ])).rejects.toMatchObject({ status: 502, code: "DEPENDENCY_UNAVAILABLE" });
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the admitted operations branch and the scoped diagnosis option without checking Java again", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  directory.opsDiagnosis.mockResolvedValueOnce({ id: "diagnosis", domain_id: owner.domainId, owner_id: "another-member", enabled: true });
  const plan = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "createForm" },
    { defaultAppId: "operations" }, viewer)!;
  const form = panelReadResultSchemas.panelFormDescription.parse(await plan.present(owner, [
    { status: "ready", payload: { timeZone: "UTC" } }, ...triggerFormFacts(["diagnosis"]),
  ]));
  expect(form.values).toMatchObject({ operation: "inspection", task: { appId: "operations", timeZone: "UTC" } });
  expect(form.fields.some(field => field.path === "/instruction")).toBe(true);
  expect(form.fields.some(field => field.path === "/caseSetId")).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it("retains the selected workspace task and the agent default in the registered Trigger reads", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const agentTask = examples.creates.find(create => create.name === "agents-instruction")!.response;
  const agentId = agentTask.content.agentId!;
  directory.agents.mockResolvedValueOnce([{
    id: agentId, name: "Inventory assistant", description: "", enabled: true,
    domain_id: owner.domainId, owner_id: "another-member",
  }]);
  const [targets, applications, permissions] = triggerFormFacts([agentId]);
  const catalogueRead = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "catalogue" }, {
    workspace: "agent", workspaceAgent: agentId, selectedTask: { className: TRIGGER, primaryKey: triggerFixture.id },
  }, viewer)!;
  const rows = unwrapReadDirective(await catalogueRead.present(owner, [
    { status: "ready", payload: { tasks: [triggerFixture, agentTask], timeZone: "UTC" } }, applications, permissions,
  ])).value;
  expect(rows).toMatchObject([{ primaryKey: triggerFixture.id }]);

  const create = prepareRegisteredTriggerRead({ kind: "platform", typeId: TRIGGER, method: "createForm" }, {
    defaultAppId: "agents", defaultAgentId: agentId,
  }, viewer)!;
  const form = panelReadResultSchemas.panelFormDescription.parse(await create.present(owner, [
    { status: "ready", payload: { timeZone: "UTC" } }, targets, applications, permissions,
  ]));
  expect(form.values).toMatchObject({ agentId, task: { appId: "agents" } });
  expect(fetch).not.toHaveBeenCalled();
});
