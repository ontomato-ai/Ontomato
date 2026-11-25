import { beforeEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { assistantService } from "../service";
import { assistantStore, type AgentRow, type SessionRow } from "../store";

const mocks = vi.hoisted(() => ({ query: vi.fn(), grant: vi.fn(), materialize: vi.fn() }));
vi.mock("../../app-builder/project-service", () => ({ ensureMaterializedWorkspace: mocks.materialize }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({ query: mocks.query }), qualifiedTable: (name: string) => name }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (run: (client: { query: typeof mocks.query }) => unknown) => run({ query: mocks.query }),
}));
vi.mock("../../agent-host/session-claim", () => ({ lockSessionClaim: async () => {}, assertUnclaimedSession: async () => {} }));
vi.mock("../authorization", () => ({ requireAgent: mocks.grant }));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));

const owner = { domainId: "domain", userId: "owner" };
const credentials = { token: "user-token", locale: "en" };
const sessionId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-11-25T00:00:00Z");
let persisted: SessionRow | undefined;
let sessionRuntime: RuntimeClient;

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  persisted = undefined;
  mocks.materialize.mockResolvedValue({ appId: "app-demo", workspaceId });
  vi.spyOn(assistantStore, "agent").mockResolvedValue({ id: agentId, enabled: true, kind: "app-builder" } as AgentRow);
  vi.spyOn(assistantStore, "session").mockImplementation(async () => persisted!);
  mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("SELECT id FROM assistant_sessions")) return { rowCount: persisted ? 1 : 0 };
    if (sql.includes("INSERT INTO assistant_sessions")) {
      persisted = {
        id: sessionId, domain_id: owner.domainId, owner_id: owner.userId, agent_id: agentId, workspace_id: params[5],
        title: "", origin: "user", created_at: now, updated_at: now,
      } as SessionRow;
      return { rowCount: 1 };
    }
    throw new Error(sql);
  });
  vi.spyOn(RuntimeClient.prototype, "request").mockResolvedValue({
    id: workspaceId, name: "App workspace", activeRunId: null, headCommit: "a".repeat(40),
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  const recordRuntime = (client: RuntimeClient) => { sessionRuntime = client; };
  vi.spyOn(RuntimeClient.prototype, "createSession").mockImplementation(async function (this: RuntimeClient) {
    recordRuntime(this);
    return { session: { id: sessionId, domainId: owner.domainId, workspaceId, activeRunId: null,
      latestRunId: null, createdAt: now.toISOString(), updatedAt: now.toISOString() }, replayed: false };
  });
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({ latestRun: null } as Awaited<ReturnType<RuntimeClient["session"]>>);
});

it("persists the workspace UUID and uses the application slot for runtime session creation and replay", async () => {
  const input = { agentId, context: { appId: "app-demo", clientContext: { tab: "files" } } };
  const created = await assistantService.create(sessionId, owner, input, credentials);
  expect(created).toMatchObject({ session: { id: sessionId, workspaceId }, replayed: false });
  expect(persisted?.workspace_id).toBe(workspaceId);
  expect(mocks.materialize).toHaveBeenCalledWith(owner, credentials, "app-demo");
  expect(RuntimeClient.prototype.createSession).toHaveBeenCalledWith(sessionId, workspaceId);
  expect(sessionRuntime).toMatchObject({
    domainId: owner.domainId, userId: owner.userId, workspaceOwnerId: "app:app-demo",
  });
  await expect(assistantService.create(sessionId, owner, input, credentials))
    .resolves.toMatchObject({ session: { workspaceId }, replayed: true });
});

it("requires an authorized application and rejects an explicit mismatched workspace", async () => {
  await expect(assistantService.create(sessionId, owner, { agentId, workspaceId }, credentials))
    .rejects.toMatchObject({ status: 400, code: "CONTEXT_REQUIRED" });
  await expect(assistantService.create(sessionId, owner, {
    agentId, context: { appId: "app-demo" }, workspaceId: sessionId,
  }, credentials)).rejects.toMatchObject({ status: 409, code: "WORKSPACE_CHANGED" });
  mocks.materialize.mockRejectedValueOnce(new HttpError(404, "not owned", "NOT_FOUND"));
  await expect(assistantService.create(sessionId, owner, { agentId, context: { appId: "app-private" } }, credentials))
    .rejects.toHaveProperty("status", 404);
  expect(persisted).toBeUndefined();
  expect(RuntimeClient.prototype.createSession).not.toHaveBeenCalled();
});

it("allocates no workspace when agent use is denied", async () => {
  mocks.grant.mockRejectedValueOnce(new HttpError(403, "grant", "FORBIDDEN"));
  await expect(assistantService.create(sessionId, owner, { agentId }, credentials)).rejects.toHaveProperty("status", 403);
  expect(RuntimeClient.prototype.request).not.toHaveBeenCalled();
  expect(persisted).toBeUndefined();
});
