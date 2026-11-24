import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardAgentConfirmRequestSchema } from "@ontomato/contracts/dashboard";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";

const mocks = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  runForOwner: vi.fn(),
  settings: vi.fn(),
  runtimeRequest: vi.fn(),
}));

vi.mock("../store", () => ({
  getDashboard: mocks.getDashboard,
}));
vi.mock("../../assistant/execution", () => ({
  runForOwner: mocks.runForOwner,
}));
vi.mock("../../product-panels/operation-store", () => ({
  panelOperationStore: { settings: mocks.settings },
}));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    request = mocks.runtimeRequest;
  },
}));

import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { openPresentationView, presentationCallback, releasePresentationRun } from "../../agent-host/presentation";
import { prepareDashboardAgentConfirm } from "../agent-confirm";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: {
    en: { ...enLocaleMeta, messages: en },
  },
});

const owner = { userId: "reader", domainId: "domain" };
const actor = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", domainId: owner.domainId };
const credentials = { token: "tok", apiKey: "", locale: "en" };
const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const viewId = "44444444-4444-4444-8444-444444444444";

const activeRun = {
  id: runId,
  status: "running",
  sessionId,
  channel: {
    agent: { providerId: "workbench", agentId: "assistant" },
    actor,
    requestedBy: null,
    root: { session: { providerId: "workbench", sessionId }, runId },
    userRecipient: { session: { providerId: "workbench", sessionId }, actor },
    authority: { classNames: [], executionKind: "live" },
  },
};

let viewAbort: AbortController | null = null;

function bindActivePresentationView(targetRunId = runId) {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "agent-confirm-test-only");
  viewAbort?.abort();
  viewAbort = new AbortController();
  openPresentationView("workbench", owner, viewId, () => {}, viewAbort.signal);
  const prepareBody: AgentPrepareRequest = {
    mode: "run",
    language: "en",
    agent: { providerId: "workbench", agentId: "assistant" },
    sessionId,
    runId: targetRunId,
    actor,
    inputId: targetRunId,
    input: { role: "user", content: "Update the dashboard", timestamp: 1 },
    authority: { classNames: [], executionKind: "live" },
    requestedBy: null,
    root: { session: { providerId: "workbench", sessionId }, runId: targetRunId },
    userRecipient: { session: { providerId: "workbench", sessionId }, actor },
    presentationBinding: { viewId },
  };
  const cb = presentationCallback("workbench", prepareBody, owner, credentials, Date.now() + 60_000);
  expect(cb).toBeDefined();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDashboard.mockResolvedValue({
    id: "board-1",
    ownerId: "reader",
    name: "Sales Board",
    createdAt: 0,
    updatedAt: 0,
    groups: [],
  });
  mocks.runForOwner.mockResolvedValue(activeRun);
  mocks.settings.mockResolvedValue({
    rootSession: { providerId: "workbench", sessionId },
    confirmBeforeExecute: true,
  });
  mocks.runtimeRequest.mockResolvedValue({ ok: true });
  bindActivePresentationView();
});

afterEach(() => {
  viewAbort?.abort();
  viewAbort = null;
  releasePresentationRun("workbench", owner, runId);
  vi.unstubAllEnvs();
});

describe("prepareDashboardAgentConfirm", () => {
  it("publishes a conversation confirmation question in default confirm mode for a direct live root run with an active view", async () => {
    const result = await prepareDashboardAgentConfirm(
      owner,
      credentials,
      {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        impactSummary: "Dashboard name; Charts: Revenue (name, chart)",
        agentRun: { sessionId, runId, toolCallId: "tc-1" },
      },
      "Alice",
    );

    expect(result.autoMode).toBe(false);
    expect(result.intentId).toBeTruthy();
    expect(result.questionId).toBeTruthy();
    expect(result.label).toBe("Save dashboard changes");
    expect(mocks.runtimeRequest).toHaveBeenCalledTimes(1);
    const [path, method, payload, questionId] = mocks.runtimeRequest.mock.calls[0]!;
    expect(path).toBe("/v1/channel/user-questions");
    expect(method).toBe("POST");
    expect(questionId).toBe(result.questionId);
    expect(payload).toMatchObject({
      source: {
        session: { providerId: "workbench", sessionId },
        runId,
      },
    });
    expect(payload.message).toContain("Save dashboard changes");
    expect(payload.message).toContain("Sales Board");
    expect(payload.message).toContain("Alice");
    expect(payload.message).toContain("Dashboard name; Charts: Revenue (name, chart)");
  });

  it("returns autoMode without publishing a user question when confirmBeforeExecute is false", async () => {
    mocks.settings.mockResolvedValue({
      rootSession: { providerId: "workbench", sessionId },
      confirmBeforeExecute: false,
    });

    const result = await prepareDashboardAgentConfirm(
      owner,
      credentials,
      {
        dashboardId: "board-1",
        operation: "card.parameters.save",
        targetLabel: "Revenue",
        impactSummary: "Fields: Year",
        agentRun: { sessionId, runId, toolCallId: "tc-2" },
      },
      "Alice",
    );

    expect(result).toMatchObject({
      autoMode: true,
      questionId: null,
      label: "Save card parameters",
    });
    expect(result.intentId).toBeTruthy();
    expect(mocks.runtimeRequest).not.toHaveBeenCalled();
  });

  it.each([true, undefined])("honors requireConfirmation=%s for parameter discard in full-auto mode", async (requireConfirmation) => {
    mocks.settings.mockResolvedValue({
      rootSession: { providerId: "workbench", sessionId },
      confirmBeforeExecute: false,
    });
    const input = dashboardAgentConfirmRequestSchema.parse({
      dashboardId: "board-1",
      operation: "card.parameters.discard",
      targetLabel: "Revenue",
      impactSummary: "Fields: Year",
      ...(requireConfirmation === undefined ? {} : { requireConfirmation }),
      agentRun: { sessionId, runId, toolCallId: "tc-discard" },
    });

    const result = await prepareDashboardAgentConfirm(owner, credentials, input);

    if (requireConfirmation) {
      expect(result).toMatchObject({ autoMode: false, questionId: expect.any(String) });
      expect(mocks.runtimeRequest).toHaveBeenCalledWith(
        "/v1/channel/user-questions",
        "POST",
        expect.objectContaining({ source: { session: { providerId: "workbench", sessionId }, runId } }),
        result.questionId,
      );
    } else {
      expect(result).toMatchObject({ autoMode: true, questionId: null });
      expect(mocks.runtimeRequest).not.toHaveBeenCalled();
    }
  });

  it("rejects mismatched session, closed run, or non-live execution", async () => {
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId: "other-sess", runId, toolCallId: "tc-3" },
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    mocks.runForOwner.mockResolvedValue({ ...activeRun, status: "completed" });
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId, runId, toolCallId: "tc-4" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "RUN_CLOSED" });

    mocks.runForOwner.mockResolvedValue({
      ...activeRun,
      channel: { ...activeRun.channel, authority: { classNames: [], executionKind: "build-test" } },
    });
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId, runId, toolCallId: "tc-5" },
      }),
    ).rejects.toMatchObject({ status: 422, code: "BUILD_TEST_UNSUPPORTED" });
  });

  it("rejects delegated child runs, non-root runs, wrong host, actor mismatch, and runs without a connected live view", async () => {
    // 1. Delegated child run (requestedBy set).
    mocks.runForOwner.mockResolvedValue({
      ...activeRun,
      channel: {
        ...activeRun.channel,
        requestedBy: { session: { providerId: "workbench", sessionId }, runId: "parent-run" },
      },
    });
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId, runId, toolCallId: "tc-delegated" },
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    // 2. Non-root run (root.runId differs from run.id).
    mocks.runForOwner.mockResolvedValue({
      ...activeRun,
      channel: {
        ...activeRun.channel,
        root: { session: { providerId: "workbench", sessionId }, runId: "other-root-run" },
      },
    });
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId, runId, toolCallId: "tc-nonroot" },
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    // 3. Initiator/recipient actor mismatch.
    mocks.runForOwner.mockResolvedValue({
      ...activeRun,
      channel: {
        ...activeRun.channel,
        userRecipient: {
          session: { providerId: "workbench", sessionId },
          actor: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", domainId: owner.domainId },
        },
      },
    });
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId, runId, toolCallId: "tc-actor" },
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    // 4. Direct user root run whose presentation view disconnected.
    mocks.runForOwner.mockResolvedValue(activeRun);
    viewAbort?.abort();
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId, runId, toolCallId: "tc-disconnected" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "VIEW_UNAVAILABLE" });

    // 5. Direct user root run that never had a bound presentation view (e.g., background/CLI run).
    const unboundRunId = "33333333-3333-4333-8333-333333333333";
    mocks.runForOwner.mockResolvedValue({
      ...activeRun,
      id: unboundRunId,
      channel: {
        ...activeRun.channel,
        root: { session: { providerId: "workbench", sessionId }, runId: unboundRunId },
      },
    });
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId, runId: unboundRunId, toolCallId: "tc-unbound" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "VIEW_UNAVAILABLE" });
  });
});
