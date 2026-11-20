import { randomUUID } from "node:crypto";
import pg from "pg";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assistantAgentInputSchema } from "@ontomato/contracts/assistant-chat";
import { AGENT_DEFINITION } from "@ontomato/contracts/panel-client-requests";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", assertPermission: vi.fn(), skillView: vi.fn(), hiddenSkills: vi.fn(), visibleSkills: vi.fn(), validateSkills: vi.fn().mockResolvedValue([]), setting: vi.fn(), prepare: vi.fn() }));
const certainSkillView = { requireCertainStoredSkill: () => undefined };
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../infrastructure/agent-runtime/client", () => ({ RuntimeClient: class { async modelOptions() { return { models: [{ ref: "test/configured", type: "chat", displayName: "Configured" }], defaultModelId: "test/configured" }; } } }));
vi.mock("../../identity/installed", async original => ({
  ...await original<typeof import("../../identity/installed")>(),
  assertPermission: state.assertPermission,
}));
vi.mock("../../services/assistant/execution-setting", () => ({
  validateExecutionSetting: state.setting,
  prepareExecutionSetting: state.prepare,
  readExecutionOptions: async () => ({ canSetExecutionUser: false, users: [], selected: null }),
}));
vi.mock("../../services/assistant/skills", () => ({
  validateAssistantSkills: state.validateSkills,
  readAssistantSkillView: state.skillView,
  hasHiddenAssistantSkillRefs: state.hiddenSkills,
  visibleAssistantSkillRefs: state.visibleSkills,
}));
vi.mock("../../services/skills/operations", () => ({ withDomainSkills: async (_domain: string, work: () => Promise<unknown>) => work() }));
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../identity/installed";
import type { WorkbenchIdentity } from "../../identity/types";
import assistantRouter from "../routes/assistant";
import { HttpError } from "../../utils/errors";
import { createAgentDefinition, filterReadableAgentDefinitions, saveAgentDefinition, saveAgentDefinitionSnapshot, validateAgentDefinition, type AgentDefinitionSkillSelection } from "../../services/assistant/definitions";
import { readAssistantSkillView } from "../../services/assistant/skills";
import { agentDefinitionOperations } from "../../services/assistant/definition-operations";
import { readDiagnosisModel, saveDiagnosisModel } from "../../services/ops-diagnosis/model-settings";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
// A database-backed suite never skips silently: the integration command requires a disposable database.
if (!database)
  throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

describe("agent definitions on PostgreSQL", () => {
  let server: Server;
  let base: string;
  const owner = { userId: "owner", domainId: "skill-selection" };
  const savedSkill = { namespace: { kind: "domain" as const, domainId: owner.domainId }, name: "stored-page-skill" };
  const form = { name: "Agent", description: "", icon: null, enabled: true, systemPrompt: "Before" };
  const write = (method: string, id: string, input: object) => fetch(base + (method === "POST" ? "" : "/" + id), {
    method, headers: { "Content-Type": "application/json", "Idempotency-Key": id }, body: JSON.stringify(input),
  });
  const stored = async (id: string) => (await state.pool!.query(
    `SELECT * FROM "${state.schema}".assistant_agents WHERE id=$1`, [id],
  )).rows[0];
  const skillWrites = async (id: string) => (await state.pool!.query(
    `SELECT agent_id FROM "${state.schema}".skill_writes WHERE agent_id=$1`, [id],
  )).rowCount;

  beforeAll(async () => {
    state.schema = `agent_definition_${randomUUID().replaceAll("-", "")}`;
    state.pool = new pg.Pool({ connectionString: database });
    await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
    await state.pool.query(`CREATE TABLE "${state.schema}".assistant_agents (
      id uuid PRIMARY KEY, domain_id text, kind text, name text, description text, enabled boolean,
      system_prompt text, model_selection jsonb, skills jsonb, icon text, class_names jsonb,
      enabled_mcp_service_ids jsonb, sort_order integer, execution_user_id text, model_reference_migrated boolean)`);
    await state.pool.query(`CREATE TABLE "${state.schema}".product_native_agent_bindings (domain_id text, agent_id text, asset_id text)`);
    await state.pool.query(`CREATE TABLE "${state.schema}".ops_diagnosis_settings (domain_id text PRIMARY KEY, model_selection jsonb NOT NULL, model_reference_migrated boolean)`);
    await state.pool.query(`CREATE TABLE "${state.schema}".skill_writes (agent_id uuid);
      CREATE FUNCTION "${state.schema}".record_skill_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO "${state.schema}".skill_writes VALUES (NEW.id); RETURN NEW; END $$;
      CREATE TRIGGER record_skill_write AFTER UPDATE OF skills ON "${state.schema}".assistant_agents
        FOR EACH ROW EXECUTE FUNCTION "${state.schema}".record_skill_write()`);
    state.skillView.mockResolvedValue(certainSkillView);
    state.hiddenSkills.mockImplementation((_refs, skillView: { hidden?: boolean }) => skillView.hidden === true);
    state.visibleSkills.mockImplementation((refs, skillView: { hidden?: boolean }) => skillView.hidden ? [] : refs);
    configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });
    const requirePermission: WorkbenchIdentity["requirePermission"] = () => (_req, _res, next) => next();
    installWorkbenchIdentity({ requireDomainId: () => owner.domainId, requirePermission } as unknown as WorkbenchIdentity);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, owner, { token: "editor", locale: "en" });
      next();
    });
    app.use("/api/assistant", assistantRouter);
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/assistant/agent-definitions`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (state.pool) {
      await state.pool.query(`DROP SCHEMA "${state.schema}" CASCADE`);
      await state.pool.end();
    }
  });
  it("creates and replays a UUID definition with its selected class range", async () => {
    const id = randomUUID();
    const input = assistantAgentInputSchema.parse({ name: "Scoped agent", description: "", icon: null,
      enabled: true, systemPrompt: "Analyze the selected classes", skills: [], classNames: ["org"], enabledMcpServiceIds: [], sortOrder: 0 });
    const owner = { userId: "owner", domainId: "domain" };
    const result = await createAgentDefinition(id, input, owner, {});
    expect(result.id).toBe(id);
    expect(result.classNames).toEqual(["org"]);
    expect(await createAgentDefinition(id, input, owner, {})).toEqual(result);
    const stored = await state.pool!.query(`SELECT kind FROM "${state.schema}".assistant_agents WHERE id=$1`, [id]);
    expect(stored.rows[0].kind).toBe(id);
  });
  it("keeps stored order on an omitted update and accepts explicit order", async () => {
    const id = randomUUID(), owner = { userId: "owner", domainId: "ordering" };
    const input = assistantAgentInputSchema.parse({ name: "Ordered", description: "", icon: null,
      enabled: true, systemPrompt: "", skills: [] });
    expect((await createAgentDefinition(id, input, owner, {})).sortOrder).toBe(0);
    expect((await saveAgentDefinition(id, { ...input, sortOrder: 7 }, owner, {})).sortOrder).toBe(7);
    expect((await saveAgentDefinition(id, { ...input, name: "Renamed" }, owner, {})).sortOrder).toBe(7);
    expect((await saveAgentDefinition(id, { ...input, sortOrder: 0 }, owner, {})).sortOrder).toBe(0);
  });
  it("updates other fields without validating or writing the absent skills column", async () => {
    const id = randomUUID();
    expect((await write("POST", id, { ...form, skills: [savedSkill] })).status).toBe(201);
    state.validateSkills.mockClear();
    state.skillView.mockClear();
    state.hiddenSkills.mockClear();
    state.skillView.mockResolvedValueOnce({ hidden: true });
    const updated = await write("PUT", id, { ...form, name: "Renamed", systemPrompt: "After", modelSelection: { modelId: "test/configured" } });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ skills: [] });
    expect(await stored(id)).toMatchObject({
      name: "Renamed", system_prompt: "After", model_selection: { modelId: "test/configured" }, skills: [savedSkill],
    });
    expect(state.validateSkills).not.toHaveBeenCalled();
    expect(state.hiddenSkills).not.toHaveBeenCalled();
    expect(state.skillView).toHaveBeenCalledTimes(1);
    expect(await skillWrites(id)).toBe(0);
    expect((await write("POST", randomUUID(), form)).status).toBe(400);
  });
  it("keeps rejected draft values in a form result and returns field errors when saving", async () => {
    const id = randomUUID();
    expect((await write("POST", id, { ...form, skills: [] })).status).toBe(201);
    const target = { kind: "object" as const, objectType: AGENT_DEFINITION, primaryKey: id };
    const values = {
      ...form, name: "Unsaved name", modelSelection: { modelId: "test/missing" },
      skills: [], classNames: [], enabledMcpServiceIds: [],
    };
    const errors = [{
      field: "/modelSelection/modelId", code: "target_unavailable", message: "The selected model does not exist in this domain",
    }];
    const describeForm = (draft?: typeof values) => fetch(base + "/form", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, values: draft, changedField: null }),
    });

    const draft = await describeForm(values);
    expect(draft.status).toBe(200);
    expect(panelFormDescriptionSchema.parse(await draft.json())).toMatchObject({ values, errors });
    expect(panelFormDescriptionSchema.parse(await (await describeForm()).json()).errors).toEqual([]);

    const credentials = { token: "editor", locale: "en" };
    const actor = { owner, credentials };
    const host = {
      initiator: actor, executor: actor, skillView: await readAssistantSkillView(owner.domainId, credentials),
      requestWorkbench: (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) =>
        fetch(new URL(`/api${path}`, base), { ...init, headers: { "Content-Type": "application/json" } }),
      request: async () => { throw new Error("The definition owner is the Workbench Server"); },
    };
    const receipt = await agentDefinitionOperations[0].execute(host, target, { values }, id);
    expect(receipt).toMatchObject({ kind: "refusal", code: "INVALID_REQUEST", errors });
    expect((await stored(id)).name).toBe(form.name);
  });

  it("keeps visible skills in the display of an update draft that omits skills", async () => {
    const id = randomUUID();
    const hiddenSkill = { ...savedSkill, name: "hidden-page-skill" };
    expect((await write("POST", id, { ...form, skills: [savedSkill, hiddenSkill] })).status).toBe(201);
    state.validateSkills.mockClear();
    state.hiddenSkills.mockClear();

    const target = { kind: "object", objectType: AGENT_DEFINITION, primaryKey: id };
    const values = { ...form, name: "Draft name", modelSelection: { modelId: null },
      classNames: [], enabledMcpServiceIds: [], executionUserId: null };
    const describeForm = async (draft?: typeof values) => {
      state.skillView.mockResolvedValueOnce({ hidden: true });
      state.visibleSkills.mockImplementationOnce((refs: typeof savedSkill[]) => refs.filter(ref => ref.name !== hiddenSkill.name));
      const response = await fetch(base + "/form", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, values: draft, changedField: null }),
      });
      expect(response.status).toBe(200);
      return panelFormDescriptionSchema.parse(await response.json());
    };
    const baseline = await describeForm();
    const draft = await describeForm(values);
    expect(draft.values.name).toBe(values.name);
    expect(baseline.values.skills).toEqual([savedSkill]);
    expect(draft.values.skills).toEqual(baseline.values.skills);
    expect(state.validateSkills).not.toHaveBeenCalled();
    expect(state.hiddenSkills).not.toHaveBeenCalled();
    expect((await stored(id)).skills).toEqual([savedSkill, hiddenSkill]);
    expect(await skillWrites(id)).toBe(0);
  });
  it("clears an explicitly submitted empty skill array through the existing validator", async () => {
    const id = randomUUID();
    expect((await write("POST", id, { ...form, skills: [savedSkill] })).status).toBe(201);
    expect((await write("PUT", id, { ...form, skills: [] })).status).toBe(200);
    expect(state.validateSkills).toHaveBeenLastCalledWith(owner.domainId, [], expect.objectContaining({ token: "editor" }), expect.anything());
    expect((await stored(id)).skills).toEqual([]);
    expect(await skillWrites(id)).toBe(1);
  });
  it.each([
    { skills: [] }, { skills: [{ namespace: { kind: "domain", domainId: owner.domainId }, name: "other-skill" }] },
  ])(
    "rejects an explicit change with a valid hidden reference before writing or preparing a Key",
    async ({ skills }) => {
      const id = randomUUID();
      expect((await write("POST", id, { ...form, skills: [savedSkill] })).status).toBe(201);
      const before = await stored(id);
      state.prepare.mockClear();
      state.skillView.mockResolvedValueOnce({ hidden: true });
      const refusal = await write("PUT", id, { ...form, name: "Must not persist", executionUserId: "other", skills });
      expect(refusal.status).toBe(403);
      expect(await refusal.text()).not.toContain(savedSkill.name);
      expect(await stored(id)).toEqual(before);
      expect(await skillWrites(id)).toBe(0);
      expect(state.prepare).not.toHaveBeenCalled();
    },
  );
  it("defaults execution to self and preserves a selected user on an omitted update", async () => {
    const id = randomUUID(), owner = { userId: "owner", domainId: "execution" };
    const input = assistantAgentInputSchema.parse({ name: "Execution", description: "", icon: null,
      enabled: true, systemPrompt: "Prompt", skills: [] });
    expect((await createAgentDefinition(id, input, owner, {})).executionUserId).toBeNull();
    expect((await saveAgentDefinition(id, { ...input, executionUserId: "target" }, owner, {})).executionUserId).toBe("target");
    expect((await saveAgentDefinition(id, { ...input, name: "Updated" }, owner, {})).executionUserId).toBe("target");
  });
  it("rejects unauthorized execution changes before either the definition or Key changes", async () => {
    const id = randomUUID(), owner = { userId: "operator", domainId: "denied" };
    const input = assistantAgentInputSchema.parse({ name: "Protected", description: "", icon: null,
      enabled: true, systemPrompt: "Prompt", skills: [], executionUserId: "selected" });
    await createAgentDefinition(id, input, owner, { token: "original" });
    const before = (await state.pool!.query(`SELECT * FROM "${state.schema}".assistant_agents WHERE id=$1`, [id])).rows[0];
    state.prepare.mockClear();
    state.setting.mockImplementation(async (_owner, oldId, newId) => {
      if (oldId !== newId) throw new HttpError(403, "Denied", "FORBIDDEN");
    });
    for (const executionUserId of [null, "other"]) {
      await expect(saveAgentDefinition(id, { ...input, executionUserId }, owner, { token: "original" }))
        .rejects.toMatchObject({ status: 403 });
    }
    expect((await state.pool!.query(`SELECT * FROM "${state.schema}".assistant_agents WHERE id=$1`, [id])).rows[0]).toEqual(before);
    expect(state.prepare).not.toHaveBeenCalled();
    const { executionUserId: _omitted, ...otherFields } = input;
    await validateAgentDefinition({ target: { id }, form: otherFields }, owner, { token: "original" });
    expect(state.prepare).not.toHaveBeenCalled();
    state.setting.mockReset();
  });
  it("persists selection, accepts default and rejects a missing reference before writing", async () => {
    const id = randomUUID(), owner = { userId: "owner", domainId: "selection" };
    const input = assistantAgentInputSchema.parse({ name: "Selected", description: "", icon: null, enabled: true, systemPrompt: "Test", skills: [], modelSelection: { modelId: "test/configured" } });
    expect((await createAgentDefinition(id, input, owner, {})).modelSelection).toEqual({ modelId: "test/configured" });
    await expect(saveAgentDefinition(id, { ...input, modelSelection: { modelId: "test/missing" } }, owner, {})).rejects.toMatchObject({ status: 400 });
    expect((await saveAgentDefinition(id, { ...input, modelSelection: { modelId: null } }, owner, {})).modelSelection).toEqual({ modelId: null });
  });
  it("checks an agent operation's skill selection as the initiator and its execution settings as the executor", async () => {
    const id = randomUUID();
    expect((await write("POST", id, { ...form, skills: [savedSkill] })).status).toBe(201);
    const before = await stored(id);
    const executor = { ...owner, userId: "executor" }, executorCredentials = { apiKey: "executor-key", locale: "en" };
    const initiatorCredentials = { token: "initiator-token", locale: "en" };
    const selection = { credentials: initiatorCredentials, view: { hidden: true } as unknown as AgentDefinitionSkillSelection["view"] };
    const update = assistantAgentInputSchema.parse({ ...form, skills: [], executionUserId: "other" });
    state.prepare.mockClear();
    await expect(saveAgentDefinitionSnapshot(id, update, executor, executorCredentials, selection))
      .rejects.toMatchObject({ code: "SKILL_SELECTION_INCOMPLETE" });
    expect(state.setting).toHaveBeenLastCalledWith(executor, null, "other", executorCredentials);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(await stored(id)).toEqual(before);

    const visible = { ...selection, view: certainSkillView as unknown as AgentDefinitionSkillSelection["view"] };
    await saveAgentDefinitionSnapshot(id, update, executor, executorCredentials, visible);
    expect(state.validateSkills).toHaveBeenLastCalledWith(owner.domainId, [], initiatorCredentials, visible.view);
    expect(state.prepare).toHaveBeenLastCalledWith(executor, null, "other", executorCredentials);
    expect((await stored(id)).skills).toEqual([]);
  });

  it("filters reference candidates with the definition's read permission and visibility rule", async () => {
    const readable = randomUUID(), builder = randomUUID(), foreign = randomUUID();
    await state.pool!.query(`INSERT INTO "${state.schema}".assistant_agents (id, domain_id, kind)
      VALUES ($1,$2,'custom'), ($3,$2,'app-builder'), ($4,'foreign','custom')`,
      [readable, owner.domainId, builder, foreign]);
    state.assertPermission.mockResolvedValueOnce(undefined);
    const candidates = [readable, builder, foreign, randomUUID()];
    const credentials = { token: "editor" };
    expect(await filterReadableAgentDefinitions(owner, credentials, candidates)).toEqual(new Set([readable]));
    expect(state.assertPermission).toHaveBeenLastCalledWith(credentials, ["analysis-agent"]);

    state.assertPermission.mockRejectedValueOnce(new HttpError(403, "Denied"));
    expect(await filterReadableAgentDefinitions(owner, credentials, candidates)).toEqual(new Set());
    const unavailable = new HttpError(502, "Permission service unavailable");
    state.assertPermission.mockRejectedValueOnce(unavailable);
    await expect(filterReadableAgentDefinitions(owner, credentials, candidates)).rejects.toBe(unavailable);
  });
  it("keeps diagnosis selection domain-owned and validates changes", async () => {
    expect(await readDiagnosisModel("diagnosis-a")).toEqual({ modelSelection: { modelId: null } });
    await saveDiagnosisModel("diagnosis-a", { modelId: "test/configured" });
    expect(await readDiagnosisModel("diagnosis-a")).toEqual({ modelSelection: { modelId: "test/configured" } });
    expect(await readDiagnosisModel("diagnosis-b")).toEqual({ modelSelection: { modelId: null } });
    await expect(saveDiagnosisModel("diagnosis-a", { modelId: "test/missing" })).rejects.toMatchObject({ status: 400 });
  });
  it("replays the same definition and refuses the same id from another domain", async () => {
    const id = randomUUID();
    const input = assistantAgentInputSchema.parse({ name: "Shared id", description: "", icon: null,
      enabled: true, systemPrompt: "Scoped", skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 0 });
    await createAgentDefinition(id, input, { userId: "owner", domainId: "domain-a" }, {});
    const replayed = await createAgentDefinition(id, input, { userId: "owner", domainId: "domain-a" }, {});
    expect(replayed.id).toBe(id);
    await expect(createAgentDefinition(id, input, { userId: "other", domainId: "domain-b" }, {}))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    await expect(createAgentDefinition(id, { ...input, name: "Different" }, { userId: "owner", domainId: "domain-a" }, {}))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  });
});
