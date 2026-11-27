import { beforeEach, expect, it, vi } from "vitest";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { assistantService } from "../service";
import { assistantStore, type AgentRow, type SessionRow } from "../store";

const mocks = vi.hoisted(() => ({ query: vi.fn(), grant: vi.fn(), prepare: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({ getPostgresPool: () => ({ query: mocks.query }), qualifiedTable: (name: string) => name }));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (run: (client: { query: typeof mocks.query }) => unknown) => run({ query: mocks.query }),
}));
vi.mock("../../agent-host/session-claim", () => ({ lockSessionClaim: async () => {}, assertUnclaimedSession: async () => {} }));
vi.mock("../authorization", () => ({ requireAgent: mocks.grant }));
vi.mock("../../agent-host/caller", () => ({ openAgentCaller: async () => ({ id: "caller", domainId: "domain" }) }));
vi.mock("../execution", async original => ({
  ...await original<typeof import("../execution")>(),
  agentExecutionCredentials: async (_agent: string, _executor: unknown, _owner: unknown, credentials: unknown) => credentials,
}));
vi.mock("../prepare", () => ({ prepareAnalystRun: mocks.prepare }));
vi.mock("../../skills/operations", () => ({ withDomainSkills: (_domain: string, run: () => unknown) => run() }));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));

const owner = { domainId: "domain", userId: "owner" };
const live = { token: "user-token", locale: "en" };
const preview = { ...live, executionKind: "preview" as const };
const sessionId = "11111111-1111-4111-8111-111111111111";
const agentId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-11-27T00:00:00Z");
let persisted: SessionRow | undefined;

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  persisted = undefined;
  vi.spyOn(assistantStore, "agent").mockResolvedValue({ id: agentId, enabled: true, kind: "analyst", class_names: [] } as unknown as AgentRow);
  vi.spyOn(assistantStore, "session").mockImplementation(async () => persisted!);
  mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("SELECT id FROM assistant_sessions")) return { rowCount: persisted ? 1 : 0 };
    if (sql.includes("INSERT INTO assistant_sessions")) {
      persisted = {
        id: sessionId, domain_id: owner.domainId, owner_id: owner.userId, agent_id: agentId, workspace_id: params[5],
        preview: params[6], title: "", origin: "user", latest_run_id: null, created_at: now, updated_at: now,
      } as SessionRow;
      return { rowCount: 1 };
    }
    throw new Error(sql);
  });
  vi.spyOn(RuntimeClient.prototype, "createSession").mockResolvedValue({
    session: { id: sessionId, domainId: owner.domainId, workspaceId: null, activeRunId: null, latestRunId: null,
      createdAt: now.toISOString(), updatedAt: now.toISOString() }, replayed: false,
  } as never);
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({ latestRun: null } as Awaited<ReturnType<RuntimeClient["session"]>>);
});

/** The authority of the run `send` asks the runtime to start; the test stops there. */
async function sentAuthority(credentials: typeof live) {
  const started = new Error("run start captured");
  const request = vi.spyOn(RuntimeClient.prototype, "request").mockImplementation(async (path: string) => {
    if (path.endsWith("/bind")) return {};
    throw started;
  });
  await expect(assistantService.send(sessionId, runId, { message: "What changed?" }, owner, credentials, "human")).rejects.toBe(started);
  const start = request.mock.calls.find(([path]) => String(path).endsWith(`/sessions/${sessionId}/runs`));
  return (start?.[2] as { channel: { authority: { executionKind: string } } }).channel.authority.executionKind;
}

it("keeps a conversation a preview opens as the preview's, wherever its runs are sent from", async () => {
  await assistantService.create(sessionId, owner, { agentId }, preview);
  expect(persisted?.preview).toBe(true);
  // The person later continuing it from a live page still runs it as the preview.
  expect(await sentAuthority(live)).toBe("preview");
});

it("runs a message a preview sends as the preview, and a live conversation sent live as live", async () => {
  await assistantService.create(sessionId, owner, { agentId }, live);
  expect(persisted?.preview).toBe(false);
  expect(await sentAuthority(preview)).toBe("preview");
  expect(await sentAuthority(live)).toBe("live");
});

const authority = { classNames: [], executionKind: "preview" as const };
const parent = { session: { providerId: "workbench", sessionId: "55555555-5555-4555-8555-555555555555" }, runId: "66666666-6666-4666-8666-666666666666" };

it("admits a person's own preview run of any agent, and still refuses a preview run delegating to a live one", async () => {
  await expect(assistantService.admitAgent(agentId, owner, live, authority)).resolves.toMatchObject({ agent: { id: agentId } });
  await expect(assistantService.admitAgent(agentId, owner, live, authority, parent))
    .rejects.toMatchObject({ status: 403, code: "PREVIEW_EXECUTION_FORBIDDEN" });
});

it("prepares a person's preview run as the preview, so the runtime never sees it turn live", async () => {
  vi.spyOn(assistantStore, "reserve").mockResolvedValue({ row: { id: runId } } as never);
  vi.spyOn(assistantStore, "admitted").mockResolvedValue(undefined as never);
  vi.spyOn(assistantStore, "create").mockResolvedValue({ row: { id: sessionId, workspace_id: null }, replayed: true } as never);
  mocks.prepare.mockResolvedValue({});
  const body = {
    mode: "run", sessionId, runId, inputId: runId, agent: { providerId: "workbench", agentId }, actor: { id: "caller", domainId: "domain" },
    input: { role: "user", content: "What changed?", timestamp: 1 }, language: "en", authority, requestedBy: null,
    root: { session: { providerId: "workbench", sessionId }, runId }, userRecipient: null,
  } as unknown as AgentPrepareRequest;
  expect((await assistantService.prepare(body, owner, live)).authority).toMatchObject({ executionKind: "preview" });
  const liveBody = { ...body, authority: { classNames: [], executionKind: "live" as const } };
  expect((await assistantService.prepare(liveBody, owner, live)).authority).toMatchObject({ executionKind: "live" });
});
