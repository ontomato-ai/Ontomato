import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import express from "express";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installContentLayout } from "../../../content/layout";
import { EXECUTION_CONTEXT_HEADER, PREVIEW_WRITE_FORBIDDEN, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";

const mocks = vi.hoisted(() => ({
  runForOwner: vi.fn(),
  runtimeRequest: vi.fn(),
  settings: vi.fn(),
  get: vi.fn(),
  findAgentPageQuestion: vi.fn(),
  cancelIntent: vi.fn(),
  cancelPendingAgentPageQuestion: vi.fn(),
}));
vi.mock("../../../services/agent-host/presentation", async (original) => ({
  ...await original<typeof import("../../../services/agent-host/presentation")>(),
  hasActivePresentationForRun: () => true,
}));
vi.mock("../../../services/assistant/execution", () => ({ runForOwner: mocks.runForOwner }));
vi.mock("../../../services/product-panels/operation-store", () => ({ panelOperationStore: {
  settings: mocks.settings, get: mocks.get, findAgentPageQuestion: mocks.findAgentPageQuestion,
  cancelIntent: mocks.cancelIntent, cancelPendingAgentPageQuestion: mocks.cancelPendingAgentPageQuestion,
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

function post(url: string, body: object, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const preview = { [EXECUTION_CONTEXT_HEADER]: previewExecutionContextHeader };
const reason = { code: "STALE", message: "The page changed" };
async function refused(response: Response) {
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: PREVIEW_WRITE_FORBIDDEN } });
}
function askingRun(executionKind: "live" | "preview") {
  const actor = { id: "reader", domainId: "domain" };
  mocks.runForOwner.mockResolvedValue({
    status: "running", sessionId,
    channel: { agent: { providerId: session.providerId }, actor, root: { session, runId }, requestedBy: null,
      userRecipient: { session, actor }, authority: { executionKind } },
  });
}
async function confirmation(executionKind: "live" | "preview") {
  askingRun(executionKind);
  const response = await post(endpoint, { agentRun: { sessionId, runId, toolCallId: "discard" }, operationLabel: "Discard",
    targetLabel: "Task", requireConfirmation: true });
  return await response.json() as { intentId: string; questionId: string };
}
const stored = (executionKind?: "preview") => ({ kind: "current", intent: { source: { kind: "agent-page", ...(executionKind && { executionKind }) } } });

it("lets a preview claim or cancel only a confirmation a preview run asked for, before it is consumed", async () => {
  const live = await confirmation("live");
  await refused(await post(`${endpoint}/${live.questionId}/claim`, {}, preview));
  await refused(await post(`${endpoint.replace("local-confirmations", "questions")}/${live.questionId}/cancel-if-pending`, reason, preview));
  // Still pending for the live page that owns it.
  expect(await (await post(`${endpoint}/${live.questionId}/claim`, {})).json()).toEqual({ ok: true, intentId: live.intentId });
  const previews = await confirmation("preview");
  expect(await (await post(`${endpoint}/${previews.questionId}/claim`, {}, preview)).json()).toEqual({ ok: true, intentId: previews.intentId });
});

it("lets a preview cancel only a pending page operation a preview run prepared, before the intent is changed", async () => {
  const intentId = "33333333-3333-4333-8333-333333333333";
  const questionId = "44444444-4444-4444-8444-444444444444";
  const operations = endpoint.replace("/local-confirmations", "");
  mocks.get.mockResolvedValue(stored());
  mocks.findAgentPageQuestion.mockResolvedValue(stored());
  await refused(await post(`${operations}/intents/${intentId}/cancel`, reason, preview));
  await refused(await post(`${operations}/questions/${questionId}/cancel-if-pending`, reason, preview));
  expect(mocks.cancelIntent).not.toHaveBeenCalled();
  expect(mocks.cancelPendingAgentPageQuestion).not.toHaveBeenCalled();
  // The person on the live page cancels as before; a preview cancels a preview run's operation.
  mocks.cancelIntent.mockResolvedValue(true);
  mocks.cancelPendingAgentPageQuestion.mockResolvedValue({ intentId });
  expect((await post(`${operations}/intents/${intentId}/cancel`, reason)).status).toBe(200);
  mocks.get.mockResolvedValue(stored("preview"));
  mocks.findAgentPageQuestion.mockResolvedValue(stored("preview"));
  expect((await post(`${operations}/intents/${intentId}/cancel`, reason, preview)).status).toBe(200);
  expect(await (await post(`${operations}/questions/${questionId}/cancel-if-pending`, reason, preview)).json())
    .toEqual({ stale: true, intentId });
  expect(mocks.cancelIntent).toHaveBeenCalledTimes(2);
});

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
