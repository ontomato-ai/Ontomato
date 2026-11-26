import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { RETRIEVAL_AGENT_ID } from "@ontomato/contracts/product-governance";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { ObjectDecisionRequest, ObjectVisibilityRange } from "../../product-governance/authorization";
import { operationHost } from "../operation-host";

const mocks = vi.hoisted(() => ({
  summaries: vi.fn(), countVisible: vi.fn(), findAgent: vi.fn(),
  appBuilder: vi.fn(), opsDiagnosis: vi.fn(), saveDiagnosis: vi.fn(), saveBuilder: vi.fn(),
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../app-builder/agents", () => ({ saveBuilderModel: mocks.saveBuilder }));
vi.mock("../../ops-diagnosis/model-settings", () => ({
  saveOpsDiagnosisModel: mocks.saveDiagnosis,
}));
vi.mock("../../assistant/store", () => ({
  assistantStore: {
    agentDefinitionSummaries: mocks.summaries, countVisibleAgentDefinitions: mocks.countVisible,
    findAgent: mocks.findAgent, appBuilder: mocks.appBuilder,
    opsDiagnosis: mocks.opsDiagnosis, agent: mocks.findAgent,
  },
}));

installContentLayout({ runtimeRoot: tmpdir(), prompts: [], publicSkillsRoot: tmpdir(), runtimeResources: [] });
const { createAgentDefinitionDirectory } = await import("../agent-definition-directory");
const { agentDefinitionOperations } = await import("../agent-definition-operations");

const owner = { domainId: "example", userId: "reader" };
const credentials = { token: "reader-token", locale: "en" };
const requester = { owner, credentials };
const builderId = "11111111-1111-4111-8111-111111111111";
const presetId = "22222222-2222-4222-8222-222222222222";
const customId = "33333333-3333-4333-8333-333333333333";
const retrievalId = RETRIEVAL_AGENT_ID;
const systemIds = [builderId, DIAGNOSIS_AGENT_ID, retrievalId];
const modelSelection = { modelId: "chat-model" };
const retrieval = { id: retrievalId, kind: "retrieval", name: "Data retrieval", modelSelection };
const builder = { id: builderId, domain_id: owner.domainId, owner_id: null, kind: "app-builder", model_selection: modelSelection };
const diagnosis = { id: DIAGNOSIS_AGENT_ID, domain_id: owner.domainId, owner_id: null, kind: "ops-diagnosis", model_selection: modelSelection };
const preset = { id: presetId, domain_id: owner.domainId, owner_id: null, name: "Preset", description: "", enabled: true, kind: "regular", icon: '{"key":"Sparkles","color":"#EEF7FF"}' };
const custom = { id: customId, domain_id: owner.domainId, owner_id: "original-author", name: "Custom", description: "", enabled: false, kind: customId, icon: null };
const fetchOwner = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
const target = (primaryKey: string) => ({ kind: "object" as const, objectType: AGENT_DEFINITION, primaryKey });
const [save, remove, grant, revoke, share] = agentDefinitionOperations;
const policy = { policyId: "analyst-policy" };
const storedGrants = [{ ...policy, name: "Analysts", level: "EDIT" }];
const cannotDeleteSystemAgent = "Built-in system agents cannot be deleted.";
const local = [preset, custom, builder, diagnosis];
const definition = (id: string, ownerId: string | null = null) => ({
  target: { domainId: owner.domainId, kind: "AGENT", id },
  ownerFacts: { ownerId, state: "PUBLISHED" },
});
const retrievalPath = `/ontology/ai/agent-models/${retrievalId}`;
const decision = vi.fn<[ObjectDecisionRequest], boolean>();
const retrievalRead = vi.fn<[], Response>();
const retrievalWrite = vi.fn<[], Response>();
let canManage: boolean;

function rpcCalls(path: string) {
  return fetchOwner.mock.calls.filter(([url]) => new URL(String(url)).pathname === `/authorization/objects/${path}`);
}
function rpcBodies(path: string): unknown[] {
  return rpcCalls(path).map(([, init]) => JSON.parse(String(init?.body)));
}

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "workbench-test-token");
  canManage = true;
  decision.mockReturnValue(true);
  mocks.summaries.mockImplementation(async (_domainId, view: ObjectVisibilityRange, { editRange }: { editRange: ObjectVisibilityRange }) =>
    local.filter(agent => view.objectIds.includes(agent.id)).map(agent => ({ ...agent, editable: editRange.objectIds.includes(agent.id) })));
  mocks.countVisible.mockImplementation(async (_domainId, view: ObjectVisibilityRange) =>
    local.filter(agent => view.objectIds.includes(agent.id)).length);
  mocks.appBuilder.mockResolvedValue(builder);
  mocks.opsDiagnosis.mockResolvedValue(diagnosis);
  mocks.findAgent.mockImplementation(async (id: string) => local.find(agent => agent.id === id));
  mocks.saveBuilder.mockResolvedValue({ modelSelection });
  mocks.saveDiagnosis.mockResolvedValue({ modelSelection });
  retrievalRead.mockImplementation(() => Response.json({ success: true, data: { ...retrieval, editable: true } }));
  retrievalWrite.mockImplementation(() => Response.json({ success: true, data: retrieval }));
  fetchOwner.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === retrievalPath && init?.method === "GET") return retrievalRead();
    if (path === retrievalPath && init?.method === "PUT") return retrievalWrite();
    if (path === "/authorization/objects/decide-batch") {
      const { requests } = JSON.parse(String(init?.body)) as { requests: ObjectDecisionRequest[] };
      return Response.json({ decisions: requests.map(request => decision(request)
        ? { allowed: true, code: null, reason: null }
        : { allowed: false, code: "OBJECT_FORBIDDEN", reason: "Object permission required" }) });
    }
    if (path === "/authorization/objects/read-ranges") {
      const { verbs } = JSON.parse(String(init?.body)) as { verbs: ("VIEW" | "EDIT")[] };
      return Response.json({ ranges: Object.fromEntries(verbs.map(verb => [verb, {
        fixed: false, all: false, authorId: null,
        objectIds: local.filter(agent => decision({
          target: { domainId: owner.domainId, kind: "AGENT", id: agent.id },
          ownerFacts: { ownerId: agent.owner_id, state: "PUBLISHED" }, verb,
        })).map(agent => agent.id),
      }])) });
    }
    if (["agent-access", "agent-level", "domain-use"].some(name => path === `/authorization/objects/${name}`)) {
      if (!canManage) return Response.json({ success: false, code: 403, message: "Policy permission required" }, { status: 403 });
      return path.endsWith("/agent-access")
        ? Response.json({ grants: storedGrants, shared: true })
        : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected owner request: ${init?.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchOwner);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("combines four sources with localized category fields and stable outputs", async () => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  const rows = await directory.list();
  expect(rows.map(row => [row.primaryKey, row.outputs?.category, row.fields?.category])).toEqual([
    [presetId, "preset", "Preset"], [customId, "custom", "Custom"],
    [builderId, "system", "System"], [DIAGNOSIS_AGENT_ID, "system", "System"], [retrievalId, "system", "System"],
  ]);
  expect(rpcBodies("decide-batch")).toEqual([]);
  expect(rpcBodies("read-ranges")).toEqual([{ kind: "AGENT", verbs: ["VIEW", "EDIT"] }]);
  expect(new Headers(rpcCalls("read-ranges")[0][1]?.headers).get("tk")).toBe(credentials.token);
  expect(new Headers(rpcCalls("read-ranges")[0][1]?.headers).get("X-Ontomato-Query-Service-Token")).toBe("workbench-test-token");
  expect(rows.slice(2).every(row => row.tones?.enabled === "success")).toBe(true);
  expect(rows.map(row => [row.primaryKey, row.fields?.icon, row.fields?.agentTitle])).toEqual([
    [presetId, '{"key":"Sparkles","color":"#EEF7FF"}', ["Preset", '{"key":"Sparkles","color":"#EEF7FF"}']],
    [customId, "", ["Custom", ""]],
    [builderId, "", ["App builder", ""]],
    [DIAGNOSIS_AGENT_ID, "", ["Operations diagnosis", ""]],
    [retrievalId, "", ["Data retrieval", ""]],
  ]);
  const customRecord = await directory.record(customId);
  expect(customRecord.outputs).toMatchObject({ category: "custom", canEdit: true, canGrant: true, domainShared: true });
  expect(customRecord.fields?.domainShared).toBe(true);
  expect((await directory.record(presetId)).fields?.icon).toBe('{"key":"Sparkles","color":"#EEF7FF"}');
  expect((await directory.record(retrievalId)).fieldLabels?.category).toBe("Category");
  await expect(directory.count()).resolves.toEqual({ rows: [], total: 5 });
});

it("omits hidden local system agents without loading their model settings and keeps the other sources", async () => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  decision.mockImplementation(request => "target" in request &&
    (request.target.id === customId || (request.target.id === builderId && request.verb === "VIEW")));
  retrievalRead.mockImplementation(() => Response.json({ success: false, code: 403 }, { status: 403 }));
  const rows = await directory.list();
  expect(rows.map(row => row.primaryKey)).toEqual([customId, builderId]);
  expect(rows.find(row => row.primaryKey === builderId)?.outputs).toMatchObject({ category: "system", canEdit: false, canGrant: false });
  await expect(directory.count()).resolves.toMatchObject({ total: 2 });
  expect(mocks.opsDiagnosis).not.toHaveBeenCalled();
  await expect(directory.record(retrievalId)).rejects.toMatchObject({ status: 403 });
  decision.mockReturnValue(false);
  await expect(directory.list()).resolves.toEqual([]);
  await expect(directory.count()).resolves.toMatchObject({ total: 0 });
  retrievalRead.mockImplementation(() => Response.json({ success: true, data: { ...retrieval, editable: false } }));
  await expect(directory.list()).resolves.toMatchObject([{ primaryKey: retrievalId, outputs: { canEdit: false, canGrant: false } }]);
  await expect(directory.count()).resolves.toMatchObject({ total: 1 });
});

it.each(systemIds)("checks view and edit separately for system agent %s", async id => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  decision.mockImplementation(request => "verb" in request && request.verb === "VIEW");
  canManage = false;
  retrievalRead.mockImplementation(() => Response.json({ success: true, data: { ...retrieval, editable: false } }));
  retrievalWrite.mockImplementation(() => Response.json({ success: false, code: 403 }, { status: 403 }));
  const record = await directory.record(id);
  expect(record.outputs).toEqual({ category: "system", canEdit: false, canGrant: false });
  expect(record.fields?.domainShared).toBeUndefined();
  expect(rpcBodies("agent-access")).toEqual([]);
  const form = await directory.form(id, { changedField: null });
  expect(form.fields.find(field => field.path === "/modelSelection/modelId")).toMatchObject({
    readOnly: true, readOnlyReason: expect.any(String),
  });
  const host = operationHost(requester);
  const input = { values: { modelSelection }, submittedFields: ["/modelSelection/modelId"] };
  const saveCode = id === retrievalId ? "FORBIDDEN" : "OBJECT_FORBIDDEN";
  await expect(save.execute(host, target(id), input, "intent")).resolves.toMatchObject({ kind: "refusal", code: saveCode });
  await expect(grant.execute(host, target(id), { ...policy, verb: "edit" })).resolves.toMatchObject({ kind: "refusal", code: "FORBIDDEN" });
  await expect(directory.grants(id)).rejects.toMatchObject({ status: 403 });
  await expect(remove.unavailable(host, target(id))).resolves.toEqual({ reason: cannotDeleteSystemAgent });
  expect(mocks.saveBuilder).not.toHaveBeenCalled();
  expect(mocks.saveDiagnosis).not.toHaveBeenCalled();
  if (id === retrievalId) {
    expect(rpcBodies("decide-batch")).toEqual([]);
    expect(retrievalWrite).toHaveBeenCalledTimes(1);
  } else {
    expect(retrievalWrite).not.toHaveBeenCalled();
  }
  decision.mockReturnValue(false);
  retrievalRead.mockImplementation(() => Response.json({ success: false, code: 403 }, { status: 403 }));
  const viewCode = id === retrievalId ? "FORBIDDEN" : "OBJECT_FORBIDDEN";
  await expect(directory.record(id)).rejects.toMatchObject({ status: 403, code: viewCode });
  await expect(directory.form(id, { changedField: null })).rejects.toMatchObject({ status: 403, code: viewCode });
});

it.each(systemIds)("allows editors to read and change grants for system agent %s", async id => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  const host = operationHost(requester);
  await expect(directory.grants(id)).resolves.toEqual({ grants: storedGrants, shared: true });
  const rows = await directory.grantRows(id);
  expect(rows.find(row => row.primaryKey === policy.policyId)?.fields).toMatchObject({ level: "edit" });
  expect(rows.filter(row => row.primaryKey === policy.policyId)).toHaveLength(1);
  await expect(grant.execute(host, target(id), { ...policy, verb: "view" })).resolves.toMatchObject({ kind: "success" });
  await expect(revoke.execute(host, target(id), policy)).resolves.toMatchObject({ kind: "success" });
  await expect(share.execute(host, target(id), { shared: false })).resolves.toMatchObject({ kind: "success" });
  expect(rpcBodies("agent-access")).toEqual([definition(id), definition(id)]);
  expect(rpcBodies("agent-level")).toEqual([
    { ...definition(id), ...policy, level: "VIEW" },
    { ...definition(id), ...policy, level: null },
  ]);
  expect(rpcBodies("domain-use")).toEqual([{ ...definition(id), shared: false }]);
});

it.each(systemIds)("exposes only the model as an editable field for %s", async id => {
  const form = panelFormDescriptionSchema.parse(await createAgentDefinitionDirectory(owner, credentials).form(id, { changedField: null }));
  expect(form.sections?.map(section => section.key)).toEqual(["basics", "model"]);
  expect(form.fields.map(field => [field.path, field.readOnly, field.section])).toEqual([
    ["/name", true, "basics"], ["/description", true, "basics"], ["/modelSelection/modelId", false, "model"],
  ]);
  expect(form.fields[2].control).toMatchObject({ kind: "reference", objectType: "platform:ModelOption" });
  const host = operationHost(requester);
  await expect(remove.unavailable(host, target(id))).resolves.toEqual({ reason: cannotDeleteSystemAgent });
  await expect(remove.execute(host, target(id))).resolves.toEqual({
    kind: "refusal", code: "SYSTEM_AGENT_READ_ONLY", message: cannotDeleteSystemAgent,
  });
});

it("routes model saves to the three owners with the initiator's credentials", async () => {
  const host = operationHost(requester, undefined, { owner, credentials: { token: "executor-token" } });
  const input = { values: { name: "Read-only name", modelSelection }, submittedFields: ["/modelSelection/modelId"] };
  for (const id of [builderId, DIAGNOSIS_AGENT_ID, retrievalId]) {
    expect(save.draftInput(input, target(id))).toEqual({ modelSelection });
    await expect(save.execute(host, target(id), input, "intent")).resolves.toMatchObject({
      kind: "success", data: { modelSelection }, affected: { objects: [{ objectType: AGENT_DEFINITION, primaryKey: id }] },
    });
  }
  expect(rpcBodies("decide-batch")).toEqual([builderId, DIAGNOSIS_AGENT_ID].map(id => ({
    requests: [{ ...definition(id), verb: "EDIT" }],
  })));
  for (const [, init] of rpcCalls("decide-batch")) {
    expect(new Headers(init?.headers).get("tk")).toBe("reader-token");
  }
  expect(mocks.saveBuilder).toHaveBeenCalledWith(owner, builderId, modelSelection);
  expect(mocks.saveDiagnosis).toHaveBeenCalledWith(owner, DIAGNOSIS_AGENT_ID, modelSelection);
  expect(fetchOwner).toHaveBeenCalledWith(`http://owner.test/ontology/ai/agent-models/${retrievalId}`, expect.objectContaining({
    method: "PUT", body: JSON.stringify({ modelSelection }), headers: expect.any(Headers),
  }));
  const retrievalPut = fetchOwner.mock.calls.find(([, init]) => init?.method === "PUT");
  expect(new Headers(retrievalPut?.[1]?.headers).get("tk")).toBe("reader-token");
  expect(save.projectResult({ modelSelection }, {} as never)).toEqual({ modelSelection });

  retrievalWrite.mockReturnValueOnce(Response.json({ success: false, code: 403, message: "Grant denied by owner" }, { status: 403 }));
  await expect(save.execute(host, target(retrievalId), input, "intent")).resolves.toEqual({
    kind: "refusal", code: "FORBIDDEN", message: "Grant denied by owner",
  });
});

it("removes the transitional types from the platform contract", () => {
  expect(platformObjectTypes).not.toHaveProperty("platform:DiagnosisModel");
  expect(platformObjectTypes).not.toHaveProperty("platform:BuilderAgent");
});

it("keeps the history-preservation notice in the delete confirmation impact", async () => {
  const host = operationHost(requester);
  vi.spyOn(host, "requestWorkbench").mockResolvedValueOnce(Response.json({
    id: customId,
    name: "Custom",
    description: "",
    icon: null,
    enabled: false,
    systemPrompt: "",
    engine: "pi",
    modelSelection,
    skills: [],
    classNames: [],
    enabledMcpServiceIds: [],
    executionUserId: null,
    sortOrder: 0,
  }));
  const impact = await remove.inspectImpact!.inspect(host, [{ target: target(customId), input: {} }]);
  expect(impact?.summary).toBe("This deletes the selected agent definition. Existing conversations remain in history.");
  expect(impact?.objects).toEqual([{ target: { objectType: AGENT_DEFINITION, primaryKey: customId }, label: "Custom" }]);
});
