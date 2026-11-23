import { beforeEach, describe, expect, it, vi } from "vitest";

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
const credentials = { token: "tok", apiKey: "", locale: "en" };
const activeRun = {
  status: "running",
  sessionId: "sess-1",
  channel: {
    agent: { providerId: "workbench", sessionId: "sess-1" },
    userRecipient: { session: { providerId: "workbench", sessionId: "root-1" } },
    authority: { executionKind: "live" },
  },
};

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
    rootSession: { providerId: "workbench", sessionId: "root-1" },
    confirmBeforeExecute: true,
  });
  mocks.runtimeRequest.mockResolvedValue({ ok: true });
});

describe("prepareDashboardAgentConfirm", () => {
  it("publishes a conversation confirmation question in default confirm mode", async () => {
    const result = await prepareDashboardAgentConfirm(
      owner,
      credentials,
      {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        impactSummary: "Dashboard name; Charts: Revenue (name, chart)",
        agentRun: { sessionId: "sess-1", runId: "run-1", toolCallId: "tc-1" },
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
        session: { providerId: "workbench", sessionId: "sess-1" },
        runId: "run-1",
      },
    });
    expect(payload.message).toContain("Save dashboard changes");
    expect(payload.message).toContain("Sales Board");
    expect(payload.message).toContain("Alice");
    expect(payload.message).toContain("Dashboard name; Charts: Revenue (name, chart)");
  });

  it("returns autoMode without publishing a user question when confirmBeforeExecute is false", async () => {
    mocks.settings.mockResolvedValue({
      rootSession: { providerId: "workbench", sessionId: "root-1" },
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
        agentRun: { sessionId: "sess-1", runId: "run-1", toolCallId: "tc-2" },
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

  it("rejects mismatched session, closed run, or non-live execution", async () => {
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId: "other-sess", runId: "run-1", toolCallId: "tc-3" },
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    mocks.runForOwner.mockResolvedValue({ ...activeRun, status: "completed" });
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId: "sess-1", runId: "run-1", toolCallId: "tc-4" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "RUN_CLOSED" });

    mocks.runForOwner.mockResolvedValue({
      ...activeRun,
      channel: { ...activeRun.channel, authority: { executionKind: "test" } },
    });
    await expect(
      prepareDashboardAgentConfirm(owner, credentials, {
        dashboardId: "board-1",
        operation: "board.save",
        targetLabel: "Sales Board",
        agentRun: { sessionId: "sess-1", runId: "run-1", toolCallId: "tc-5" },
      }),
    ).rejects.toMatchObject({ status: 422, code: "BUILD_TEST_UNSUPPORTED" });
  });
});
