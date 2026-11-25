import { beforeEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { assistantService } from "../service";
import { assistantStore, type AgentRow, type SessionRow } from "../store";

const mocks = vi.hoisted(() => ({ query: vi.fn(), access: vi.fn(), grant: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({ query: mocks.query }), qualifiedTable: (name: string) => name }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (run: (client: { query: typeof mocks.query }) => unknown) => run({ query: mocks.query }),
}));
vi.mock("../../agent-host/session-claim", () => ({ lockSessionClaim: async () => {}, assertUnclaimedSession: async () => {} }));
vi.mock("../../app-builder/access", () => ({ assertAppBuilderAccess: mocks.access }));
vi.mock("../../product-governance/grants", () => ({ requireProductGrant: mocks.grant }));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));

const owner = { domainId: "domain", userId: "owner" };
const credentials = { token: "user-token", locale: "en" };
const sessionId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-11-25T00:00:00Z");
let persisted: SessionRow | undefined;

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  persisted = undefined;
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
  vi.spyOn(RuntimeClient.prototype, "createSession").mockResolvedValue(undefined as never);
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({ latestRun: null } as Awaited<ReturnType<RuntimeClient["session"]>>);
});

it("creates one owned workspace for an unbound first conversation and reuses it on replay", async () => {
  const created = await assistantService.create(sessionId, owner, { agentId }, credentials);
  expect(created).toMatchObject({ session: { id: sessionId, workspaceId }, replayed: false });
  expect(persisted?.workspace_id).toBe(workspaceId);
  expect(RuntimeClient.prototype.createSession).toHaveBeenCalledWith(sessionId, workspaceId);
  expect(RuntimeClient.prototype.request).toHaveBeenCalledWith("/v1/workspaces", "POST", expect.objectContaining({ name: expect.any(String) }));
  expect(vi.mocked(RuntimeClient.prototype.request).mock.instances[0]).toMatchObject({
    domainId: owner.domainId, userId: owner.userId,
  });

  await expect(assistantService.create(sessionId, owner, { agentId }, credentials))
    .resolves.toMatchObject({ session: { workspaceId }, replayed: true });
  expect(RuntimeClient.prototype.request).toHaveBeenCalledTimes(1);
});

it.each([{ workspaceId }, { context: { workspaceId } }])(
  "verifies an explicit workspace before persisting the binding and never allocates another (%j)", async (workspace) => {
  const input = { agentId, ...workspace };
  vi.mocked(RuntimeClient.prototype.request).mockRejectedValueOnce(new HttpError(404, "not owned", "NOT_FOUND"));
  await expect(assistantService.create(sessionId, owner, input, credentials)).rejects.toHaveProperty("status", 404);
  expect(persisted).toBeUndefined();

  await expect(assistantService.create(sessionId, owner, input, credentials)).resolves.toMatchObject({ session: { workspaceId } });
  expect(RuntimeClient.prototype.request).toHaveBeenLastCalledWith(`/v1/workspaces/${workspaceId}`);
  expect(RuntimeClient.prototype.createSession).toHaveBeenCalledWith(sessionId, workspaceId);
  expect(vi.mocked(RuntimeClient.prototype.request).mock.calls.some(([, method]) => method === "POST")).toBe(false);
});

it("allocates no workspace when the builder entry or product grant is denied", async () => {
  mocks.access.mockRejectedValueOnce(new HttpError(403, "entry", "FORBIDDEN"));
  await expect(assistantService.create(sessionId, owner, { agentId }, credentials)).rejects.toHaveProperty("status", 403);
  mocks.grant.mockRejectedValueOnce(new HttpError(403, "grant", "FORBIDDEN"));
  await expect(assistantService.create(sessionId, owner, { agentId }, credentials)).rejects.toHaveProperty("status", 403);
  expect(RuntimeClient.prototype.request).not.toHaveBeenCalled();
  expect(persisted).toBeUndefined();
});
