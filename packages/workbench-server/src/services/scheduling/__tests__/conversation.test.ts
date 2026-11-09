import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { scheduledConversationStatus } from "../conversation";
import { scheduledSessionId } from "../application";
import { assistantService } from "../../assistant/service";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";

vi.mock("../../assistant/service", () => ({ assistantService: { ownRun: vi.fn() } }));
afterEach(() => { vi.restoreAllMocks(); });

it("reads lifecycle only until stopped and reads just the final reply on success", async () => {
  const owner = { domainId: "domain", userId: "owner" }, sessionId = randomUUID(), runId = randomUUID();
  const own = vi.spyOn(assistantService, "ownRun").mockResolvedValue();
  const status = vi.spyOn(RuntimeClient.prototype, "status");
  const base = { id: runId, sessionId, createdAt: "2026-11-05T00:00:00Z", finishedAt: null, resolvedSkills: [], errorMessage: null, workspaceCommit: null };
  status.mockResolvedValueOnce({ ...base, status: "running", stopReason: null })
    .mockResolvedValueOnce({ ...base, status: "stopped", stopReason: "stop" });
  const reply = vi.spyOn(RuntimeClient.prototype, "finalReply").mockResolvedValue({ role: "assistant", content: [{ type: "text", text: "Result" }] } as never);
  const snapshot = vi.spyOn(RuntimeClient.prototype, "run");
  const wait = vi.spyOn(RuntimeClient.prototype, "waitStopped");
  const read = () => scheduledConversationStatus(assistantService, owner, sessionId, runId, "agents", `/agents/chat?sessionId=${sessionId}`);
  expect(await read()).toMatchObject({ status: "running", result: null });
  expect(reply).not.toHaveBeenCalled();
  expect(await read()).toMatchObject({ status: "completed", result: "Result" });
  expect(reply).toHaveBeenCalledTimes(1);
  expect(reply).toHaveBeenCalledWith(runId);
  expect(own).toHaveBeenCalledWith(sessionId, runId, owner);
  expect(snapshot).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
});
it("derives a stable separate session identity for admission and recovery", () => {
  const runId = randomUUID();
  expect(scheduledSessionId(runId)).toBe(scheduledSessionId(runId));
  expect(scheduledSessionId(runId)).not.toBe(runId);
  expect(scheduledSessionId(randomUUID())).not.toBe(scheduledSessionId(runId));
});
