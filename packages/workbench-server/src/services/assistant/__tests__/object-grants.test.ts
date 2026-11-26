import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { HttpError } from "../../../utils/errors";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import { panelRecordListSchema } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { tmpdir } from "node:os";
import { installContentLayout } from "../../../content/layout";
import type { PanelOperationHost } from "../../product-panels/server-operations";

const mocks = vi.hoisted(() => ({ post: vi.fn(), agent: vi.fn(), session: vi.fn(), builderAccess: vi.fn(), managementAccess: vi.fn() }));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://query" } } }));
vi.mock("../../../utils/backend-client", () => ({ backendPost: mocks.post, buildBackendHeaders: () => ({}) }));
vi.mock("../store", () => ({ assistantStore: { agent: mocks.agent, findAgent: mocks.agent, session: mocks.session } }));

vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: mocks.builderAccess }));
vi.mock("../../../identity/management", () => ({
  assertManagement: mocks.managementAccess,
}));

installContentLayout({ runtimeRoot: tmpdir(), prompts: [], publicSkillsRoot: tmpdir(), runtimeResources: [] });
const { assistantService } = await import("../service");
const { agentDefinitionOperations } = await import("../../product-panels/agent-definition-operations");
const { createAgentDefinitionDirectory } = await import("../../product-panels/agent-definition-directory");

const id = "11111111-1111-4111-8111-111111111111";
const owner = { domainId: "domain", userId: "editor" };
const credentials = { token: "editor", locale: "en" };
const actor = { owner, credentials };
const target = { kind: "object", objectType: AGENT_DEFINITION, primaryKey: id } as const;
const host: PanelOperationHost = {
  initiator: actor, executor: actor,
  request: vi.fn(), requestWorkbench: vi.fn(),
};
const [, , grant, revoke, share] = agentDefinitionOperations;
const policy = { policyId: "analyst-policy" };
const definition = {
  target: { domainId: owner.domainId, kind: "AGENT", id },
  ownerFacts: { ownerId: "author", state: "PUBLISHED" },
};
const decideBatch = "object-authorization-decide-batch";
const agentLevel = "object-authorization-agent-level";
const agentAccess = "object-authorization-agent-access";
const domainUse = "object-authorization-domain-use";
const forbidden = { status: 403, code: "OBJECT_FORBIDDEN" };
const reply = (data: unknown) => ({ text: JSON.stringify(data) });

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });
beforeEach(() => {
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "workbench-test-token");
  mocks.builderAccess.mockReset().mockResolvedValue(undefined);
  mocks.managementAccess.mockReset().mockResolvedValue(undefined);
  mocks.session.mockReset().mockResolvedValue({ agent_id: id });
  mocks.agent.mockReset().mockResolvedValue({
    id, domain_id: owner.domainId, owner_id: "author", kind: id, name: "Agent", description: "", icon: null, enabled: true,
    engine: "pi", class_names: [], enabled_mcp_service_ids: [], sort_order: 0,
    system_prompt: "Prompt", skills: [], model_selection: { modelId: null }, execution_user_id: null,
  });
  mocks.post.mockReset().mockImplementation(async (operation: string) => {
    if (operation === decideBatch) return reply({ decisions: [{ allowed: true, code: null, reason: null }] });
    if (operation === agentLevel || operation === domainUse) return { text: "" };
    throw new Error(`Unexpected authorization operation: ${operation}`);
  });
});

afterEach(() => { vi.unstubAllEnvs(); });

it.each([
  ["edit", "EDIT"],
  ["view", "VIEW"],
  ["use", "USE"],
])("sends the %s level as one policy replacement", async (verb, level) => {
  await expect(grant.execute(host, target, { ...policy, verb })).resolves.toMatchObject({
    kind: "success", affected: { objects: [{ objectType: AGENT_DEFINITION, primaryKey: id }] },
  });
  expect(mocks.post.mock.calls).toEqual([
    [agentLevel, "http://query/authorization/objects/agent-level", { ...definition, ...policy, level }, expect.anything()],
  ]);
});

it("revokes the complete policy level and writes domain sharing separately", async () => {
  await expect(revoke.execute(host, target, policy)).resolves.toMatchObject({ kind: "success" });
  await expect(share.execute(host, target, { shared: false })).resolves.toMatchObject({ kind: "success" });
  expect(mocks.post.mock.calls.map(([operation, , body]) => [operation, body])).toEqual([
    [agentLevel, { ...definition, ...policy, level: null }],
    [domainUse, { ...definition, shared: false }],
  ]);
});

it("propagates the policy owner's edit refusal on reads and mutations", async () => {
  mocks.post.mockRejectedValue(new HttpError(403, "Edit permission required", "FORBIDDEN"));
  const reads = createAgentDefinitionDirectory(owner, credentials);
  await expect(reads.grantRows(id)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  await expect(grant.execute(host, target, { ...policy, verb: "use" })).resolves.toMatchObject({ kind: "refusal", code: "FORBIDDEN" });
  await expect(revoke.execute(host, target, policy)).resolves.toMatchObject({ kind: "refusal", code: "FORBIDDEN" });
  await expect(share.execute(host, target, { shared: true })).resolves.toMatchObject({ kind: "refusal", code: "FORBIDDEN" });
  expect(mocks.post.mock.calls.map(([operation, , body]) => [operation, body])).toEqual([
    [agentAccess, definition],
    [agentLevel, { ...definition, ...policy, level: "USE" }],
    [agentLevel, { ...definition, ...policy, level: null }],
    [domainUse, { ...definition, shared: true }],
  ]);
});

it("projects the three policy levels and a separate non-revocable domain row", async () => {
  const grants = [
    { ...policy, name: "Analysts", level: "EDIT" },
    { policyId: "viewer-policy", name: "Analysts", level: "VIEW" },
    { policyId: "operator-policy", name: "Operators", level: "USE" },
  ];
  mocks.post.mockResolvedValue(reply({ grants, shared: true }));
  const reads = createAgentDefinitionDirectory(owner, credentials);
  await expect(reads.grants(id)).resolves.toEqual({ grants, shared: true });
  const rows = panelRecordListSchema.parse(await reads.grantRows(id));
  expect(rows).toHaveLength(4);
  for (const { policyId, name, level } of grants) {
    expect(rows).toContainEqual(expect.objectContaining({
      primaryKey: policyId, className: AGENT_DEFINITION, label: name,
      fields: expect.objectContaining({ policyId, level: level.toLowerCase(), verb: level.toLowerCase(), revocable: true }),
    }));
  }
  expect(rows).toContainEqual(expect.objectContaining({
    primaryKey: "domain", fields: expect.objectContaining({ level: "use", revocable: false }),
  }));
});

it.each(["app-builder", "ops-diagnosis"])("admits %s with an object use grant alone", async kind => {
  mocks.agent.mockResolvedValue({ id, domain_id: owner.domainId, owner_id: null, kind, enabled: true });
  const gateRefusal = new HttpError(403, "Management denied", "FORBIDDEN");
  mocks.builderAccess.mockRejectedValue(gateRefusal);
  mocks.managementAccess.mockRejectedValue(gateRefusal);
  await expect(assistantService.admitAgent(id, owner, credentials)).resolves.toMatchObject({ agent: { id } });
  expect(mocks.post).toHaveBeenCalledWith(decideBatch, "http://query/authorization/objects/decide-batch", {
    requests: [{ ...definition, ownerFacts: { ownerId: null, state: "PUBLISHED" }, verb: "USE" }],
  }, expect.anything());
  expect(mocks.builderAccess).not.toHaveBeenCalled();
  expect(mocks.managementAccess).not.toHaveBeenCalled();
});

it.each(["app-builder", "ops-diagnosis"])("refuses %s admission, creation, continuation and preparation after use is revoked", async kind => {
  mocks.agent.mockResolvedValue({ id, domain_id: owner.domainId, owner_id: null, kind, enabled: true });
  mocks.post.mockResolvedValue(reply({ decisions: [{ allowed: false, code: forbidden.code, reason: "Use permission required" }] }));
  const run = { agent: { agentId: id } } as AgentPrepareRequest;
  await expect(assistantService.admitAgent(id, owner, credentials)).rejects.toMatchObject(forbidden);
  await expect(assistantService.create(id, owner, { agentId: id }, credentials)).rejects.toMatchObject(forbidden);
  await expect(assistantService.send(id, id, { message: "Continue" }, owner, credentials, "human")).rejects.toMatchObject(forbidden);
  await expect(assistantService.prepare(run, owner, credentials)).rejects.toMatchObject(forbidden);
  expect(mocks.post).toHaveBeenCalledWith(decideBatch, "http://query/authorization/objects/decide-batch", {
    requests: [{ ...definition, ownerFacts: { ownerId: null, state: "PUBLISHED" }, verb: "USE" }],
  }, expect.anything());
  expect(mocks.builderAccess).not.toHaveBeenCalled();
  expect(mocks.managementAccess).not.toHaveBeenCalled();
});
