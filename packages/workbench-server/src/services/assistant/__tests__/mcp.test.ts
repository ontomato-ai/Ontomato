import { expect, it, vi } from "vitest";
import { startAnalysis } from "../mcp";
import { assistantStore } from "../store";
import { assistantService } from "../service";
import { HttpError } from "../../../utils/errors";

vi.mock("../store", () => ({ assistantStore: { session: vi.fn(), turn: vi.fn() } }));
vi.mock("../service", () => ({ assistantService: { send: vi.fn() } }));

it("acknowledges queued external analysis before the host has a turn to read", async () => {
  const threadId = "11111111-1111-4111-8111-111111111111";
  const taskId = "22222222-2222-4222-8222-222222222222";
  const owner = { domainId: "domain", userId: "user" };
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
