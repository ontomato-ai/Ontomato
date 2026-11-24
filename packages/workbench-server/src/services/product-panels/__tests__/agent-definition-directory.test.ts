import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { AGENT_DEFINITION, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { operationHost } from "../operation-host";

const mocks = vi.hoisted(() => ({
  admit: vi.fn(), builderAccess: vi.fn(), count: vi.fn(), agents: vi.fn(), findAgent: vi.fn(),
  appBuilder: vi.fn(), readDiagnosis: vi.fn(), saveDiagnosis: vi.fn(), saveBuilder: vi.fn(),
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../../identity/installed", async importOriginal => ({
  ...await importOriginal<typeof import("../../../identity/installed")>(), assertPermission: mocks.admit,
}));
vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: mocks.builderAccess }));
vi.mock("../../app-builder/agents", () => ({ saveBuilderModel: mocks.saveBuilder }));
vi.mock("../../ops-diagnosis/model-settings", () => ({
  readDiagnosisModel: mocks.readDiagnosis, saveDiagnosisModel: mocks.saveDiagnosis,
}));
vi.mock("../../assistant/store", () => ({
  assistantStore: {
    agents: mocks.agents, countAgentDefinitions: mocks.count, findAgent: mocks.findAgent, appBuilder: mocks.appBuilder,
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
const retrievalId = "dd3b91b9-9214-4aa6-9937-fb07fd37b232";
const modelSelection = { modelId: "chat-model" };
const retrieval = { id: retrievalId, kind: "retrieval", name: "Data retrieval", modelSelection };
const builder = { id: builderId, kind: "app-builder", model_selection: modelSelection };
const preset = { id: presetId, name: "Preset", description: "", enabled: true, kind: "regular" };
const custom = { id: customId, name: "Custom", description: "", enabled: false, kind: customId };
const fetchOwner = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
const target = (primaryKey: string) => ({ kind: "object" as const, objectType: AGENT_DEFINITION, primaryKey });
const [save, remove] = agentDefinitionOperations;

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.count.mockResolvedValue(2);
  mocks.agents.mockResolvedValue([preset, custom]);
  mocks.appBuilder.mockResolvedValue(builder);
  mocks.findAgent.mockImplementation(async (id: string) => [builder, preset, custom].find(agent => agent.id === id));
  mocks.readDiagnosis.mockResolvedValue({ modelSelection });
  mocks.saveBuilder.mockResolvedValue({ modelSelection });
  mocks.saveDiagnosis.mockResolvedValue({ modelSelection });
  fetchOwner.mockImplementation(async (_url, init) => Response.json({
    success: true, data: init?.method === "PUT" ? retrieval : { agents: [retrieval] },
  }));
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
  expect((await directory.record(customId)).outputs).toEqual({ category: "custom" });
  expect((await directory.record(retrievalId)).fieldLabels?.category).toBe("Category");
  await expect(directory.count()).resolves.toEqual({ rows: [], total: 5 });
});

it("hides each inaccessible source and returns forbidden only when all sources deny access", async () => {
  const directory = createAgentDefinitionDirectory(owner, credentials);
  mocks.admit.mockRejectedValue(new HttpError(403, "Analysis denied", "ANALYSIS_DENIED"));
  await expect(directory.list()).resolves.toMatchObject([{ primaryKey: builderId }, { primaryKey: retrievalId }]);
  await expect(directory.count()).resolves.toMatchObject({ total: 2 });
  await expect(directory.record(DIAGNOSIS_AGENT_ID)).rejects.toMatchObject({ status: 403, code: "ANALYSIS_DENIED" });
  mocks.builderAccess.mockRejectedValue(new HttpError(403, "Builder denied", "BUILDER_DENIED"));
  await expect(directory.form(builderId, { changedField: null })).rejects.toMatchObject({ status: 403, code: "BUILDER_DENIED" });
  fetchOwner.mockImplementation(async () => Response.json({ success: false, message: "System config denied" }, { status: 403 }));
  await expect(directory.list()).rejects.toMatchObject({ status: 403 });
  await expect(directory.count()).rejects.toMatchObject({ status: 403 });
  await expect(directory.record(retrievalId)).rejects.toMatchObject({ status: 403, message: "System config denied" });
});

it.each([builderId, DIAGNOSIS_AGENT_ID, retrievalId])("exposes only the model as an editable field for %s", async id => {
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
  }
  expect(mocks.saveBuilder).toHaveBeenCalledWith(owner, builderId, modelSelection);
  expect(mocks.builderAccess).toHaveBeenCalledWith(credentials);
  expect(mocks.saveDiagnosis).toHaveBeenCalledWith(owner.domainId, modelSelection);
  expect(mocks.admit).toHaveBeenCalledWith(credentials, ["analysis-agent"]);
  expect(fetchOwner).toHaveBeenCalledWith(`http://owner.test/ontology/ai/agent-models/${retrievalId}`, expect.objectContaining({
    method: "PUT", body: JSON.stringify({ modelSelection }), headers: expect.any(Headers),
  }));
  expect((fetchOwner.mock.calls[0][1]?.headers as Headers).get("tk")).toBe("reader-token");
  expect(save.projectResult({ modelSelection }, {} as never)).toEqual({ modelSelection });

  fetchOwner.mockResolvedValueOnce(Response.json({ success: false, code: 403, message: "System config denied" }, { status: 403 }));
  await expect(save.execute(host, target(retrievalId), input, "intent")).resolves.toEqual({
    kind: "refusal", code: "FORBIDDEN", message: "System config denied",
  });
});

it("removes the transitional types from the platform contract", () => {
  expect(platformObjectTypes).not.toHaveProperty("platform:DiagnosisModel");
  expect(platformObjectTypes).not.toHaveProperty("platform:BuilderAgent");
});
