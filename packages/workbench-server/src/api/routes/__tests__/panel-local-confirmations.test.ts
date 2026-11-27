import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installContentLayout } from "../../../content/layout";

const mocks = vi.hoisted(() => ({
  runForOwner: vi.fn(),
  runtimeRequest: vi.fn(),
  settings: vi.fn(),
  cancelPending: vi.fn(),
}));
vi.mock("../../../services/agent-host/presentation", async (original) => ({
  ...await original<typeof import("../../../services/agent-host/presentation")>(),
  hasActivePresentationForRun: () => true,
}));
vi.mock("../../../services/assistant/execution", () => ({ runForOwner: mocks.runForOwner }));
vi.mock("../../../services/product-panels/operation-store", () => ({ panelOperationStore: {
  settings: mocks.settings, cancelPendingAgentPageQuestion: mocks.cancelPending,
} }));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    request = mocks.runtimeRequest;
  },
}));
vi.mock("../../../services/skills/view", () => ({}));
vi.mock("../../../utils/request-identity", async (original) => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const session = { providerId: "workbench", sessionId };
let server: Server;
let endpoint: string;

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: false,
    packs: { en: { messages: en, ...enLocaleMeta } },
  });
  installContentLayout({ runtimeRoot: tmpdir(), publicSkillsRoot: tmpdir(), prompts: [], runtimeResources: [] });
  const { panelOperationsRouter } = await import("../product-panels");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { userId: "reader", token: "reader-token", locale: "en" });
    next();
  });
  app.use("/api", panelOperationsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/panel-operations/local-confirmations`;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runForOwner.mockResolvedValue({
    status: "running",
    sessionId,
    channel: { agent: { providerId: session.providerId }, userRecipient: { session }, authority: { executionKind: "live" } },
  });
  mocks.settings.mockResolvedValue({ rootSession: session, confirmBeforeExecute: false });
  mocks.runtimeRequest.mockResolvedValue({ ok: true });
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function post(url: string, body: object) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

it.each([
  { executionKind: "live", requireConfirmation: true },
  { executionKind: "live", requireConfirmation: undefined },
  { executionKind: "preview", requireConfirmation: false },
])("handles local action confirmation in full-auto mode (%j)", async ({ executionKind, requireConfirmation }) => {
  const actor = { id: "reader", domainId: "domain" };
  mocks.runForOwner.mockResolvedValue({
    status: "running",
    sessionId,
    channel: {
      agent: { providerId: session.providerId }, actor, root: { session, runId }, requestedBy: null,
      userRecipient: { session, actor }, authority: { executionKind },
    },
  });
  const response = await post(endpoint, {
    agentRun: { sessionId, runId, toolCallId: "discard" },
    operationLabel: "Discard",
    targetLabel: "Task",
    ...(requireConfirmation === undefined ? {} : { requireConfirmation }),
  });
  expect(response.status).toBe(200);
  const result = await response.json();

  if (executionKind === "preview" || requireConfirmation) {
    expect(result).toMatchObject({ autoMode: false, questionId: expect.any(String) });
    expect(mocks.runtimeRequest).toHaveBeenCalledWith(
      "/v1/channel/user-questions", "POST",
      expect.objectContaining({ source: { session, runId } }), result.questionId,
    );
    const claim = await post(`${endpoint}/${result.questionId}/claim`, {});
    expect(await claim.json()).toEqual({ ok: true, intentId: result.intentId });
  } else {
    expect(result).toMatchObject({ autoMode: true, questionId: null });
    expect(mocks.runtimeRequest).not.toHaveBeenCalled();
  }
});

it("lets a preview claim or cancel a live run's pending confirmation: it is the platform's record, not a business write", async () => {
  const actor = { id: "reader", domainId: "domain" };
  mocks.runForOwner.mockResolvedValue({
    status: "running", sessionId,
    channel: { agent: { providerId: session.providerId }, actor, root: { session, runId }, requestedBy: null,
      userRecipient: { session, actor }, authority: { executionKind: "live" } },
  });
  const ask = async () => (await (await post(endpoint, { agentRun: { sessionId, runId, toolCallId: "discard" }, operationLabel: "Discard",
    targetLabel: "Task", requireConfirmation: true })).json()) as { intentId: string; questionId: string };
  const preview = { "X-Ontomato-Execution-Context": 'preview' };
  const claimed = await ask();
  expect(await (await fetch(`${endpoint}/${claimed.questionId}/claim`, { method: "POST", headers: { "Content-Type": "application/json", ...preview }, body: "{}" })).json())
    .toEqual({ ok: true, intentId: claimed.intentId });
  const cancelled = await ask();
  mocks.cancelPending.mockResolvedValue(null);
  const response = await fetch(`${endpoint.replace("local-confirmations", "questions")}/${cancelled.questionId}/cancel-if-pending`, {
    method: "POST", headers: { "Content-Type": "application/json", ...preview }, body: JSON.stringify({ code: "STALE", message: "The page changed" }),
  });
  expect(await response.json()).toEqual({ stale: true, intentId: cancelled.intentId });
});
