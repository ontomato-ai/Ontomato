import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assistantAgentInputSchema } from "@ontomato/contracts/assistant-chat";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", setting: vi.fn(), prepare: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({ RuntimeClient: class { async modelOptions() { return { models: [{ ref: "test/configured", type: "chat", displayName: "Configured" }], defaultModelId: "test/configured" }; } } }));
vi.mock("../execution-setting", () => ({ validateExecutionSetting: state.setting, prepareExecutionSetting: state.prepare }));
vi.mock("../skills", () => ({ validateAssistantSkills: vi.fn().mockResolvedValue([]) }));
vi.mock("../../skills/operations", () => ({ withDomainSkills: async (_domain: string, work: () => Promise<unknown>) => work() }));
import { HttpError } from "../../../utils/errors";
import { createAgentDefinition, saveAgentDefinition, validateAgentDefinition } from "../definitions";
import { readDiagnosisModel, saveDiagnosisModel } from "../../ops-diagnosis/model-settings";

const database = process.env.RUNTIME_TEST_DATABASE_URL;
// A database-backed suite never skips silently: the integration command requires a disposable database.
if (!database)
  throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

describe("agent creation on PostgreSQL", () => {
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
  });
  afterAll(async () => {
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
