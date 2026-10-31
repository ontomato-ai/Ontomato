import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assistantAgentInputSchema } from "@ontomato/contracts/assistant-chat";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "" }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../skills", () => ({ validateAssistantSkills: vi.fn().mockResolvedValue([]) }));
vi.mock("../../skills/operations", () => ({ withDomainSkills: async (_domain: string, work: () => Promise<unknown>) => work() }));
import { createAgentDefinition } from "../definitions";

describe.skipIf(!process.env.RUNTIME_TEST_DATABASE_URL)("agent creation on PostgreSQL", () => {
  beforeAll(async () => {
    state.schema = `agent_definition_${randomUUID().replaceAll("-", "")}`;
    state.pool = new pg.Pool({ connectionString: process.env.RUNTIME_TEST_DATABASE_URL });
    await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
    await state.pool.query(`CREATE TABLE "${state.schema}".assistant_agents (
      id uuid PRIMARY KEY, domain_id text, kind text, name text, description text, enabled boolean,
      system_prompt text, model_role text, skills jsonb, icon text, class_names jsonb,
      enabled_mcp_service_ids jsonb, sort_order integer)`);
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
    const result = await createAgentDefinition(id, input, owner);
    expect(result.id).toBe(id);
    expect(result.classNames).toEqual(["org"]);
    expect(await createAgentDefinition(id, input, owner)).toEqual(result);
    const stored = await state.pool!.query(`SELECT kind FROM "${state.schema}".assistant_agents WHERE id=$1`, [id]);
    expect(stored.rows[0].kind).toBe(id);
  });
  it("replays the same definition and refuses the same id from another domain", async () => {
    const id = randomUUID();
    const input = assistantAgentInputSchema.parse({ name: "Shared id", description: "", icon: null,
      enabled: true, systemPrompt: "Scoped", skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 0 });
    await createAgentDefinition(id, input, { userId: "owner", domainId: "domain-a" });
    const replayed = await createAgentDefinition(id, input, { userId: "owner", domainId: "domain-a" });
    expect(replayed.id).toBe(id);
    await expect(createAgentDefinition(id, input, { userId: "other", domainId: "domain-b" }))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
    await expect(createAgentDefinition(id, { ...input, name: "Different" }, { userId: "owner", domainId: "domain-a" }))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
  });
});
