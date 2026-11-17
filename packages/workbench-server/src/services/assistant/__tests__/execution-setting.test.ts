import { afterEach, expect, it, vi } from "vitest";
import type { AgentRow } from "../store";
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://java" } } }));
vi.mock("../../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "service" }) } }));
import { resolveAgentExecution, validateExecutionSetting, prepareExecutionSetting } from "../execution-setting";
const owner = { domainId: "domain", userId: "alice" };
const original = { token: "original", locale: "en" };
afterEach(() => { vi.unstubAllGlobals(); });
it("carries original operator and service credentials to validation and preparation", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  await validateExecutionSetting(owner, "selected", "other", original);
  await prepareExecutionSetting(owner, "selected", "other", original);
  for (const [, init] of fetch.mock.calls) {
    expect(init.headers).toMatchObject({ tk: "original", "X-Ontomato-Query-Service-Token": "service" });
    expect(JSON.parse(init.body)).toEqual({ domainId: "domain", operatorId: "alice", oldExecutionUserId: "selected", executionUserId: "other" });
  }
});
it("reuses the initiator credential for self mode and replaces it for the selected user", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ executionUserId: "alice", apiKey: null }))
    .mockResolvedValueOnce(Response.json({ executionUserId: "selected", apiKey: "internal" }));
  vi.stubGlobal("fetch", fetch);
  const agent = { id: "stored-agent", execution_user_id: null } as AgentRow;
  expect((await resolveAgentExecution(agent, owner, original)).credentials).toBe(original);
  const selected = await resolveAgentExecution({ ...agent, execution_user_id: "selected" }, owner, original);
  expect(selected).toEqual({ executionUserId: "selected", credentials: { apiKey: "internal", locale: "en" } });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ domainId: "domain", initiatorId: "alice", agentId: "stored-agent", executionUserId: "selected" });
});
it("propagates a credential rejection without retrying or falling back", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code: "EXECUTION_CREDENTIAL_INVALID", message: "Invalid" } }, { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  await expect(resolveAgentExecution({ id: "stored-agent", execution_user_id: "selected" } as AgentRow, owner, original))
    .rejects.toMatchObject({ status: 409, code: "EXECUTION_CREDENTIAL_INVALID" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
