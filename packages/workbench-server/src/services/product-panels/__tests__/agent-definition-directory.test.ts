import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { RETRIEVAL_AGENT_ID } from "@ontomato/contracts/product-governance";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { operationHost } from "../operation-host";

const mocks = vi.hoisted(() => ({
  ids: vi.fn(), allowed: vi.fn(), records: vi.fn(), set: vi.fn(), share: vi.fn(), agents: vi.fn(), findAgent: vi.fn(),
  appBuilder: vi.fn(), readDiagnosis: vi.fn(), saveDiagnosis: vi.fn(), saveBuilder: vi.fn(),
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../product-governance/grants", () => ({
  grantedProductIds: mocks.ids,
  productGrantAllowed: mocks.allowed,
  readProductGrantRecords: mocks.records,
  setProductGrants: mocks.set,
  shareProductResource: mocks.share,
  requireProductGrant: async (...args: unknown[]) => {
    if (!await mocks.allowed(...args)) throw new HttpError(403, "Product Grant required", "PRODUCT_FORBIDDEN");
  },
}));
vi.mock("../../app-builder/agents", () => ({ saveBuilderModel: mocks.saveBuilder }));
vi.mock("../../ops-diagnosis/model-settings", () => ({
  readDiagnosisModel: mocks.readDiagnosis, saveDiagnosisModel: mocks.saveDiagnosis,
}));
vi.mock("../../assistant/store", () => ({
  assistantStore: {
    channelAgents: mocks.agents, findAgent: mocks.findAgent, appBuilder: mocks.appBuilder,
    agent: mocks.findAgent,
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
const builder = { id: builderId, kind: "app-builder", model_selection: modelSelection };
const preset = { id: presetId, name: "Preset", description: "", enabled: true, kind: "regular" };
const custom = { id: customId, name: "Custom", description: "", enabled: false, kind: customId };
const fetchOwner = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
const target = (primaryKey: string) => ({ kind: "object" as const, objectType: AGENT_DEFINITION, primaryKey });
const [save, remove, grant, revoke, share] = agentDefinitionOperations;
const role = { principalKind: "role", principalId: "analyst" } as const;
const storedGrants = [{ ...role, verb: "use" }, { ...role, verb: "edit" }, { principalKind: "domain", principalId: "*", verb: "use" }];

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ids.mockResolvedValue([presetId, customId, ...systemIds]);
  mocks.allowed.mockResolvedValue(true);
  mocks.records.mockResolvedValue({ grants: storedGrants });
  mocks.agents.mockResolvedValue([preset, custom, builder]);
  mocks.appBuilder.mockResolvedValue(builder);
  mocks.findAgent.mockImplementation(async (id: string) => [builder, preset, custom].find(agent => agent.id === id));
  mocks.readDiagnosis.mockResolvedValue({ modelSelection });
  mocks.saveBuilder.mockResolvedValue({ modelSelection });
  mocks.saveDiagnosis.mockResolvedValue({ modelSelection });
  fetchOwner.mockImplementation(async () => Response.json({ success: true, data: retrieval }));
  vi.stubGlobal("fetch", fetchOwner);
});

afterEach(() => { vi.unstubAllGlobals(); });

it("combines four sources with localized category fields and stable outputs", async () => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  const rows = await directory.list();
  expect(rows.map(row => [row.primaryKey, row.outputs?.category, row.fields?.category])).toEqual([
    [presetId, "preset", "Preset"], [customId, "custom", "Custom"],
    [builderId, "system", "System"], [DIAGNOSIS_AGENT_ID, "system", "System"], [retrievalId, "system", "System"],
  ]);
  expect(rows.slice(2).every(row => row.tones?.enabled === "success")).toBe(true);
  const customRecord = await directory.record(customId);
  expect(customRecord.outputs).toMatchObject({ category: "custom", canEdit: true, canGrant: true, domainShared: true });
  expect(customRecord.fields?.domainShared).toBe(true);
  expect((await directory.record(retrievalId)).fieldLabels?.category).toBe("Category");
  await expect(directory.count()).resolves.toEqual({ rows: [], total: 5 });
});

it("omits hidden system agents without reading their model settings", async () => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  mocks.ids.mockImplementation(async (verb: string) => verb === "view" ? [builderId, customId] : [customId]);
  const rows = await directory.list();
  expect(rows.map(row => row.primaryKey)).toEqual([customId, builderId]);
  expect(rows.find(row => row.primaryKey === builderId)?.outputs).toMatchObject({ category: "system", canEdit: false, canGrant: false });
  await expect(directory.count()).resolves.toMatchObject({ total: 2 });
  expect(mocks.readDiagnosis).not.toHaveBeenCalled();
  expect(fetchOwner).not.toHaveBeenCalled();
  mocks.ids.mockResolvedValue([]);
  await expect(directory.list()).resolves.toEqual([]);
  await expect(directory.count()).resolves.toMatchObject({ total: 0 });
});

it.each(systemIds)("checks view and edit separately for system agent %s", async id => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  mocks.allowed.mockImplementation(async (_id: string, verb: string) => verb === "view");
  const record = await directory.record(id);
  expect(record.outputs).toEqual({ category: "system", canEdit: false, canGrant: false });
  expect(record.fields?.domainShared).toBeUndefined();
  const form = await directory.form(id, { changedField: null });
  expect(form.fields.find(field => field.path === "/modelSelection/modelId")).toMatchObject({
    readOnly: true, readOnlyReason: expect.any(String),
  });
  const host = operationHost(requester);
  const input = { values: { modelSelection }, submittedFields: ["/modelSelection/modelId"] };
  await expect(save.execute(host, target(id), input, "intent")).resolves.toMatchObject({ kind: "refusal", code: "PRODUCT_FORBIDDEN" });
  await expect(grant.execute(host, target(id), { ...role, verb: "edit" })).resolves.toMatchObject({ kind: "refusal", code: "PRODUCT_FORBIDDEN" });
  await expect(directory.grants(id)).rejects.toMatchObject({ status: 403 });
  await expect(remove.unavailable(host, target(id))).resolves.toMatchObject({ reason: form.fields[2].readOnlyReason });
  expect(mocks.records).not.toHaveBeenCalled();
  expect(mocks.saveBuilder).not.toHaveBeenCalled();
  expect(mocks.saveDiagnosis).not.toHaveBeenCalled();
  expect(fetchOwner.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  mocks.allowed.mockResolvedValue(false);
  await expect(directory.record(id)).rejects.toMatchObject({ status: 403, code: "PRODUCT_FORBIDDEN" });
  await expect(directory.form(id, { changedField: null })).rejects.toMatchObject({ status: 403, code: "PRODUCT_FORBIDDEN" });
});

it.each(systemIds)("allows editors to read and change grants for system agent %s", async id => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  const host = operationHost(requester);
  await expect(directory.grants(id)).resolves.toEqual({ grants: storedGrants, shared: true });
  const rows = await directory.grantRows(id);
  expect(rows.find(row => row.primaryKey === "role:analyst")?.fields).toMatchObject({ level: "edit" });
  expect(rows.filter(row => row.primaryKey === "role:analyst")).toHaveLength(1);
  await expect(grant.execute(host, target(id), { ...role, verb: "view" })).resolves.toMatchObject({ kind: "success" });
  await expect(revoke.execute(host, target(id), role)).resolves.toMatchObject({ kind: "success" });
  await expect(share.execute(host, target(id), { shared: false })).resolves.toMatchObject({ kind: "success" });
  expect(mocks.set).toHaveBeenCalledWith(credentials, { id, ...role, verbs: ["use", "view"] });
  expect(mocks.set).toHaveBeenCalledWith(credentials, { id, ...role, verbs: [] });
  expect(mocks.share).toHaveBeenCalledWith(id, false, credentials);
});

it.each(systemIds)("exposes only the model as an editable field for %s", async id => {
  const form = panelFormDescriptionSchema.parse(await createAgentDefinitionDirectory(owner, credentials).form(id, { changedField: null }));
  expect(form.sections?.map(section => section.key)).toEqual(["basics", "model"]);
  expect(form.fields.map(field => [field.path, field.readOnly, field.section])).toEqual([
    ["/name", true, "basics"], ["/description", true, "basics"], ["/modelSelection/modelId", false, "model"],
  ]);
  expect(form.fields[2].control).toMatchObject({ kind: "reference", objectType: "platform:ModelOption" });
  const host = operationHost(requester);
  await expect(remove.unavailable(host, target(id))).resolves.toEqual({ reason: "Built-in system agents cannot be deleted." });
  await expect(remove.execute(host, target(id))).resolves.toEqual({
    kind: "refusal", code: "SYSTEM_AGENT_READ_ONLY", message: "Built-in system agents cannot be deleted.",
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
    expect(mocks.allowed).toHaveBeenCalledWith(id, "edit", credentials);
  }
  expect(mocks.saveBuilder).toHaveBeenCalledWith(owner, builderId, modelSelection);
  expect(mocks.saveDiagnosis).toHaveBeenCalledWith(owner.domainId, modelSelection);
  expect(fetchOwner).toHaveBeenCalledWith(`http://owner.test/ontology/ai/agent-models/${retrievalId}`, expect.objectContaining({
    method: "PUT", body: JSON.stringify({ modelSelection }), headers: expect.any(Headers),
  }));
  expect((fetchOwner.mock.calls[0][1]?.headers as Headers).get("tk")).toBe("reader-token");
  expect(save.projectResult({ modelSelection }, {} as never)).toEqual({ modelSelection });

  fetchOwner.mockResolvedValueOnce(Response.json({ success: false, code: 403, message: "Grant denied by owner" }, { status: 403 }));
  await expect(save.execute(host, target(retrievalId), input, "intent")).resolves.toEqual({
    kind: "refusal", code: "FORBIDDEN", message: "Grant denied by owner",
  });
});

it("removes the transitional types from the platform contract", () => {
  expect(platformObjectTypes).not.toHaveProperty("platform:DiagnosisModel");
  expect(platformObjectTypes).not.toHaveProperty("platform:BuilderAgent");
});
