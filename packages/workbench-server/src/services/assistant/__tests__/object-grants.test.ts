import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { HttpError } from "../../../utils/errors";
import { beforeEach, expect, it, vi } from "vitest";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import { panelRecordListSchema } from "@ontomato/contracts/panel-projection";
import type { ProductGrantRecord } from "@ontomato/contracts/product-governance";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { tmpdir } from "node:os";
import { installContentLayout } from "../../../content/layout";
import type { PanelOperationHost } from "../../product-panels/server-operations";

const mocks = vi.hoisted(() => ({ post: vi.fn(), agent: vi.fn(), session: vi.fn(), builderAccess: vi.fn() }));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://query" } } }));
vi.mock("../../../utils/backend-client", () => ({ backendPost: mocks.post, buildBackendHeaders: () => ({}) }));
vi.mock("../store", () => ({ assistantStore: { agent: mocks.agent, findAgent: mocks.agent, session: mocks.session } }));

vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: mocks.builderAccess }));

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
const role = { principalKind: "role", principalId: "analyst" } as const;
const reply = (data: unknown) => ({ text: JSON.stringify(data) });

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });
beforeEach(() => {
  mocks.builderAccess.mockReset().mockResolvedValue(undefined);
  mocks.session.mockReset().mockResolvedValue({ agent_id: id });
  mocks.agent.mockReset().mockResolvedValue({
    id, kind: id, name: "Agent", description: "", icon: null, enabled: true,
    engine: "pi", class_names: [], enabled_mcp_service_ids: [], sort_order: 0,
    system_prompt: "Prompt", skills: [], model_selection: { modelId: null }, execution_user_id: null,
  });
  mocks.post.mockReset().mockImplementation(async (operation: string) =>
    reply(operation === "product-grant-check" ? { allowed: true } : { success: true }));
});

it.each([
  ["edit", ["use", "view", "edit"]],
  ["view", ["use", "view"]],
  ["use", ["use"]],
])("sets the complete %s grant with one owner mutation", async (verb, verbs) => {
  await expect(grant.execute(host, target, { ...role, verb })).resolves.toMatchObject({
    kind: "success", affected: { objects: [{ objectType: AGENT_DEFINITION, primaryKey: id }] },
  });
  const writes = mocks.post.mock.calls.filter(([operation]) => operation === "product-grant-set");
  expect(writes.map(call => call[2])).toEqual([{ id, ...role, verbs }]);
});

it("revokes the entire subject grant and writes domain sharing separately", async () => {
  await expect(revoke.execute(host, target, role)).resolves.toMatchObject({ kind: "success" });
  await expect(share.execute(host, target, { shared: false })).resolves.toMatchObject({ kind: "success" });
  expect(mocks.post.mock.calls.map(([operation, , body]) => [operation, body])).toEqual([
    ["product-grant-check", { id, verb: "edit" }],
    ["product-grant-set", { id, ...role, verbs: [] }],
    ["product-grant-check", { id, verb: "edit" }],
    ["product-grant-sharing", { id, shared: false }],
  ]);
});

it("refuses grant reads and mutations without edit authorization", async () => {
  mocks.post.mockResolvedValue(reply({ allowed: false }));
  const reads = createAgentDefinitionDirectory(owner, credentials);
  await expect(reads.grantRows(id)).rejects.toMatchObject({ status: 403, code: "PRODUCT_FORBIDDEN" });
  await expect(grant.execute(host, target, { ...role, verb: "use" })).resolves.toMatchObject({ kind: "refusal", code: "PRODUCT_FORBIDDEN" });
  expect(mocks.post.mock.calls.every(([operation]) => operation === "product-grant-check")).toBe(true);
  expect(mocks.agent).not.toHaveBeenCalled();
});

it("projects each subject at its highest tier while keeping principal kinds distinct", async () => {
  const grants: ProductGrantRecord[] = [
    { ...role, verb: "view" }, { ...role, verb: "use" }, { ...role, verb: "edit", principalName: "Analysts" },
    { principalKind: "principal", principalId: role.principalId, verb: "view" },
    { principalKind: "domain", principalId: "*", verb: "use" },
  ];
  mocks.post.mockImplementation(async (operation: string) =>
    reply(operation === "product-grant-records" ? { grants } : { allowed: true }));
  const reads = createAgentDefinitionDirectory(owner, credentials);
  await expect(reads.grants(id)).resolves.toEqual({ grants, shared: true });
  const rows = panelRecordListSchema.parse(await reads.grantRows(id));
  expect(rows).toHaveLength(3);
  expect(rows).toContainEqual(expect.objectContaining({
    primaryKey: "role:analyst", className: AGENT_DEFINITION, label: "Analysts", subtitle: "analyst",
    fields: expect.objectContaining({ level: "edit", verb: "edit", revocable: true }),
  }));
  expect(rows).toContainEqual(expect.objectContaining({
    primaryKey: "principal:analyst", fields: expect.objectContaining({ level: "view", revocable: true }),
  }));
  expect(rows).toContainEqual(expect.objectContaining({
    primaryKey: "domain:*", fields: expect.objectContaining({ level: "use", revocable: false }),
  }));
});

it("requires both application access and use to admit the app builder", async () => {
  mocks.agent.mockResolvedValue({ id, kind: "app-builder", enabled: true });
  await expect(assistantService.admitAgent(id, owner, credentials)).resolves.toMatchObject({ agent: { id } });

  mocks.builderAccess.mockRejectedValue(new HttpError(403, "Application access denied", "FORBIDDEN"));
  await expect(assistantService.admitAgent(id, owner, credentials)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
});

it("refuses app builder admission, creation, continuation and preparation after use is revoked", async () => {
  mocks.agent.mockResolvedValue({ id, kind: "app-builder", enabled: true });
  mocks.post.mockResolvedValue(reply({ allowed: false }));
  const run = { agent: { agentId: id } } as AgentPrepareRequest;
  const forbidden = { status: 403, code: "PRODUCT_FORBIDDEN" };
  await expect(assistantService.admitAgent(id, owner, credentials)).rejects.toMatchObject(forbidden);
  await expect(assistantService.create(id, owner, { agentId: id }, credentials)).rejects.toMatchObject(forbidden);
  await expect(assistantService.send(id, id, { message: "Continue" }, owner, credentials, "human")).rejects.toMatchObject(forbidden);
  await expect(assistantService.prepare(run, owner, credentials)).rejects.toMatchObject(forbidden);
  expect(mocks.post).toHaveBeenCalledWith("product-grant-check", expect.any(String), { id, verb: "use" }, expect.anything());
});
