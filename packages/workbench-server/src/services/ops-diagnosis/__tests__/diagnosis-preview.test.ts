import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { EXECUTION_CONTEXT_HEADER, PREVIEW_WRITE_FORBIDDEN, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { HttpError } from "../../../utils/errors";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { messages: en, ...enLocaleMeta } } });

/*
 * The legacy `/api/observe/agent` conversations, through their real routes: a conversation a preview opens is stored as
 * the preview's and every run in it runs as the preview; a preview stops only a preview's run.
 */
const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>() }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT * FROM ops_sessions")) return { rows: state.rows.has(String(params[0])) ? [state.rows.get(String(params[0]))] : [] };
    if (sql.startsWith("SELECT session_id FROM ops_run_intents")) return { rows: [{ session_id: sessionId }] };
    throw new Error(sql);
  } }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../infrastructure/postgres-transaction", () => ({
  transaction: (run: (client: unknown) => unknown) => run({ query: async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT id FROM ops_sessions")) return { rowCount: state.rows.has(String(params[0])) ? 1 : 0 };
    if (sql.startsWith("INSERT INTO ops_sessions")) {
      state.rows.set(String(params[0]), { id: params[0], domain_id: params[1], owner_id: params[2], target: params[3], preview: params[4],
        title: "", created_at: new Date(0), updated_at: new Date(0) });
      return { rowCount: 1 };
    }
    throw new Error(sql);
  } }),
}));
vi.mock("../../agent-host/session-claim", () => ({ lockSessionClaim: async () => {}, assertUnclaimedSession: async () => {} }));
vi.mock("../../assistant/store", () => ({ assistantStore: { opsDiagnosis: vi.fn(async () => ({ id: DIAGNOSIS_AGENT_ID })) } }));
vi.mock("../../assistant/authorization", () => ({ agentAllowed: async () => true, requireAgent: async () => {} }));
vi.mock("../../agent-host/caller", () => ({ openAgentCaller: async () => ({ id: "caller", domainId: "domain" }) }));
vi.mock("../../../core/skills/registry/manager", () => ({ skillRegistryManager: {} }));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(), requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const { default: opsDiagnosisRouter } = await import("../../../api/routes/ops-diagnosis");
let server: Server;
let base: string;
const sent: { path: string; body: unknown }[] = [];
let runIdentity = "live";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { userId: "U", domainId: "domain", token: "tk", apiKey: "", locale: "en" }); next(); });
  app.use("/api/observe", opsDiagnosisRouter);
  app.use((error: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: { code: error.code, message: error.message } });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/observe/agent`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  state.rows.clear(); sent.length = 0; runIdentity = "live";
  vi.spyOn(RuntimeClient.prototype, "createSession").mockResolvedValue({} as never);
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({ latestRun: null } as never);
  vi.spyOn(RuntimeClient.prototype, "run").mockRejectedValue(new HttpError(404, "Run not found", "NOT_FOUND"));
  vi.spyOn(RuntimeClient.prototype, "request").mockImplementation(async (path: string, _method?: string, body?: unknown) => {
    sent.push({ path, body });
    if (path.includes("/intents/")) return { channel: { authority: { classNames: [], executionKind: runIdentity } } };
    if (path.endsWith("/runs")) throw Object.assign(new Error("captured"), { status: 418 });
    return {};
  });
});

const preview = { [EXECUTION_CONTEXT_HEADER]: previewExecutionContextHeader };
const post = (path: string, headers: Record<string, string> = {}, body: unknown = {}) => fetch(`${base}${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": sessionId, ...headers }, body: JSON.stringify(body),
});
const startedAuthority = () =>
  (sent.find(entry => entry.path.endsWith(`/sessions/${sessionId}/runs`))?.body as { channel: { authority: { executionKind: string } } })
    .channel.authority.executionKind;

it("stores a conversation a preview opens as the preview's, and runs every message in it as the preview", async () => {
  expect((await post("/sessions", preview, { agentId: DIAGNOSIS_AGENT_ID })).status).toBe(201);
  expect(state.rows.get(sessionId)?.preview).toBe(true);
  // Replaying the same key as a live create names another conversation.
  expect((await post("/sessions", {}, { agentId: DIAGNOSIS_AGENT_ID })).status).toBe(409);
  await post(`/sessions/${sessionId}/runs`, { "Idempotency-Key": runId }, { message: "Why did it fail?" });
  expect(startedAuthority()).toBe("preview");
});

it("runs a live conversation live, a preview's message in it as the preview, and refuses a preview replaying it", async () => {
  expect((await post("/sessions", {}, { agentId: DIAGNOSIS_AGENT_ID })).status).toBe(201);
  expect((await post("/sessions", preview, { agentId: DIAGNOSIS_AGENT_ID })).status).toBe(409);
  await post(`/sessions/${sessionId}/runs`, { "Idempotency-Key": runId }, { message: "Why did it fail?" });
  expect(startedAuthority()).toBe("live");
  sent.length = 0;
  await post(`/sessions/${sessionId}/runs`, { ...preview, "Idempotency-Key": runId }, { message: "And now?" });
  expect(startedAuthority()).toBe("preview");
});

it("lets a preview stop only a preview's run", async () => {
  await post("/sessions", {}, { agentId: DIAGNOSIS_AGENT_ID });
  const refused = await post(`/sessions/${sessionId}/runs/${runId}/cancel`, preview);
  expect(refused.status).toBe(422);
  expect(await refused.json()).toMatchObject({ error: { code: PREVIEW_WRITE_FORBIDDEN } });
  expect(sent.some(entry => entry.path.endsWith(`/run-intents/${runId}/cancel`))).toBe(false);
  runIdentity = "preview";
  expect((await post(`/sessions/${sessionId}/runs/${runId}/cancel`, preview)).status).toBe(200);
  expect(sent.some(entry => entry.path.endsWith(`/run-intents/${runId}/cancel`))).toBe(true);
});
