import { beforeEach, expect, it, vi } from "vitest";
import { analysisTask, startAnalysis } from "../mcp";
import { assistantStore } from "../store";
import { assistantService } from "../service";
import { HttpError } from "../../../utils/errors";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";
import { getPostgresPool } from "../../../infrastructure/postgres";

vi.mock("../store", () => ({ assistantStore: { session: vi.fn(), turn: vi.fn() } }));
vi.mock("../service", () => ({ assistantService: { send: vi.fn(), readRun: vi.fn(), content: vi.fn() } }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: vi.fn(),
  qualifiedTable: (name: string) => name,
}));

const threadId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const inputId = "33333333-3333-4333-8333-333333333333";
const owner = { domainId: "domain", userId: "user" };
const otherOwner = { domainId: "domain", userId: "other-user" };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(assistantStore.session).mockReset();
  vi.mocked(assistantStore.turn).mockReset();
  vi.mocked(assistantService.send).mockReset();
  vi.mocked(assistantService.readRun).mockReset();
  vi.mocked(getPostgresPool).mockReturnValue({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as ReturnType<typeof getPostgresPool>);
});

it("acknowledges queued external analysis before the host has a turn to read", async () => {
  const credentials = { token: "token" };
  vi.mocked(assistantStore.session).mockResolvedValue({ id: threadId, agent_id: "analyst", title: "Analysis" } as Awaited<ReturnType<typeof assistantStore.session>>);
  vi.mocked(assistantStore.turn).mockRejectedValue(new HttpError(404, "Run not found", "NOT_FOUND"));
  vi.mocked(assistantService.send).mockResolvedValue({
    delivery: { runId: taskId, messageId: taskId, sessionRef: { sessionId: threadId, providerId: "workbench" }, status: "starting", delivery: "run" },
    input: { id: taskId, runId: null, messageSeq: 2, contextSeq: null, message: { role: "user", content: "Analyze this", timestamp: 1 } },
    pendingQuestions: [], replayed: false, snapshot: null,
  });

  await expect(startAnalysis("analyst", "Analyze this", threadId, owner, credentials))
    .resolves.toMatchObject({ id: taskId, agentId: "analyst", threadId, question: "Analyze this", status: "starting" });
  expect(assistantService.send).toHaveBeenCalledWith(threadId, expect.any(String), { message: "Analyze this" }, owner, credentials, "external");
});

it("reads a queued starting analysis task truthfully before a workbench turn row exists", async () => {
  const createdAt = "2026-11-24T05:00:00.000Z";
  vi.mocked(assistantStore.turn).mockRejectedValue(new HttpError(404, "Run not found", "NOT_FOUND"));
  vi.mocked(assistantStore.session).mockImplementation(async (sid, caller) => {
    if (sid === threadId && caller.domainId === owner.domainId && caller.userId === owner.userId) {
      return { id: threadId, agent_id: "analyst", title: "Queued Analysis" } as Awaited<ReturnType<typeof assistantStore.session>>;
    }
    throw new HttpError(404, "Conversation not found", "NOT_FOUND");
  });
  vi.spyOn(RuntimeClient.prototype, "channelIntent").mockResolvedValue({
    id: taskId,
    session: { providerId: "workbench", sessionId: threadId },
    channel: {
      agent: { providerId: "workbench", agentId: "analyst" },
      actor: { id: "44444444-4444-4444-8444-444444444444", domainId: owner.domainId },
      authority: { classNames: [], executionKind: "live" },
      requestedBy: null,
      root: { session: { providerId: "workbench", sessionId: threadId }, runId: taskId },
      userRecipient: null,
    },
    language: "en",
    inputId,
    status: "starting",
    createdAt,
    error: null,
    cancelled: false,
  });
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({
    session: { id: threadId, domainId: owner.domainId, workspaceId: null, activeRunId: null, latestRunId: null, createdAt, updatedAt: createdAt },
    messages: [{ id: inputId, runId: null, messageSeq: 2, contextSeq: null, message: { role: "user", content: "Queued question", timestamp: 2 } }],
    pendingQuestions: [],
    latestRun: null,
  });

  await expect(analysisTask(taskId, owner)).resolves.toMatchObject({
    id: taskId,
    agentId: "analyst",
    userId: owner.userId,
    name: "Queued Analysis",
    status: "starting",
    threadId,
    question: "Queued question",
    resultSummary: "",
    finalAnswer: "",
    reportDeliverableEnabled: false,
  });

  // Another user in the same domain cannot inspect this queued task.
  await expect(analysisTask(taskId, otherOwner)).rejects.toMatchObject({ status: 404 });
});

it("still returns starting when the turn is reserved but not yet admitted to runtime runs", async () => {
  const createdAt = "2026-11-24T05:00:00.000Z";
  vi.mocked(assistantStore.turn).mockResolvedValue({
    id: taskId, session_id: threadId, created_at: new Date(createdAt),
  } as Awaited<ReturnType<typeof assistantStore.turn>>);
  vi.mocked(assistantStore.session).mockResolvedValue({
    id: threadId, agent_id: "analyst", title: "Preparing Analysis",
  } as Awaited<ReturnType<typeof assistantStore.session>>);
  vi.mocked(assistantService.readRun).mockRejectedValue(new HttpError(404, "Run not found", "NOT_FOUND"));
  vi.spyOn(RuntimeClient.prototype, "channelIntent").mockResolvedValue({
    id: taskId,
    session: { providerId: "workbench", sessionId: threadId },
    channel: {
      agent: { providerId: "workbench", agentId: "analyst" },
      actor: { id: "44444444-4444-4444-8444-444444444444", domainId: owner.domainId },
      authority: { classNames: [], executionKind: "live" },
      requestedBy: null,
      root: { session: { providerId: "workbench", sessionId: threadId }, runId: taskId },
      userRecipient: null,
    },
    language: "en",
    inputId,
    status: "starting",
    createdAt,
    error: null,
    cancelled: false,
  });
  vi.spyOn(RuntimeClient.prototype, "session").mockResolvedValue({
    session: { id: threadId, domainId: owner.domainId, workspaceId: null, activeRunId: null, latestRunId: null, createdAt, updatedAt: createdAt },
    messages: [{ id: inputId, runId: null, messageSeq: 2, contextSeq: null, message: { role: "user", content: "Preparing question", timestamp: 2 } }],
    pendingQuestions: [],
    latestRun: null,
  });

  await expect(analysisTask(taskId, owner)).resolves.toMatchObject({
    id: taskId,
    status: "starting",
    question: "Preparing question",
  });
});

it("rejects unknown or non-workbench queued intents with 404", async () => {
  vi.mocked(assistantStore.turn).mockRejectedValue(new HttpError(404, "Run not found", "NOT_FOUND"));
  vi.spyOn(RuntimeClient.prototype, "channelIntent").mockRejectedValueOnce(new HttpError(404, "Agent execution not found", "NOT_FOUND"));
  await expect(analysisTask(taskId, owner)).rejects.toMatchObject({ status: 404 });

  vi.spyOn(RuntimeClient.prototype, "channelIntent").mockResolvedValueOnce({
    id: taskId,
    session: { providerId: "observe", sessionId: threadId },
    channel: {
      agent: { providerId: "observe", agentId: "diagnosis" },
      actor: { id: "44444444-4444-4444-8444-444444444444", domainId: owner.domainId },
      authority: { classNames: [], executionKind: "live" },
      requestedBy: null,
      root: { session: { providerId: "observe", sessionId: threadId }, runId: taskId },
      userRecipient: null,
    },
    language: "en",
    inputId,
    status: "starting",
    createdAt: "2026-11-24T05:00:00.000Z",
    error: null,
    cancelled: false,
  });
  await expect(analysisTask(taskId, owner)).rejects.toMatchObject({ status: 404 });
});
