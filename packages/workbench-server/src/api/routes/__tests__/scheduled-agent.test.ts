import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { scheduledAgentStatus } from "../scheduled-agent";
import { assistantService } from "../../../services/assistant/service";
import { RuntimeClient } from "../../../infrastructure/agent-runtime/client";

vi.mock("../../../services/assistant/service", () => ({
  assistantService: { ownRun: vi.fn() },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("reads lifecycle only until stopped and reads just the final reply on success", async () => {
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "test-service");
  const owner = { domainId: "domain", userId: "owner" },
    sessionId = randomUUID(),
    runId = randomUUID();
  const request = {
    header: () => "test-service",
    body: { owner, sessionId, runId },
  } as unknown as Request;
  const own = vi.spyOn(assistantService, "ownRun").mockResolvedValue();
  const status = vi.spyOn(RuntimeClient.prototype, "status");
  const base = {
    id: runId,
    sessionId,
    createdAt: "2026-11-05T00:00:00Z",
    finishedAt: null,
    resolvedSkills: [],
    errorMessage: null,
  };
  status
    .mockResolvedValueOnce({ ...base, status: "running", stopReason: null })
    .mockResolvedValueOnce({ ...base, status: "stopped", stopReason: "stop" });
  const finalReply = vi
    .spyOn(RuntimeClient.prototype, "finalReply")
    .mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "Result" }],
    } as never);
  const snapshot = vi.spyOn(RuntimeClient.prototype, "run");
  const wait = vi.spyOn(RuntimeClient.prototype, "waitStopped");
  const call = () =>
    new Promise((resolve) => {
      scheduledAgentStatus(
        request,
        { json: resolve } as unknown as Response,
        () => {},
      );
    });
  expect(await call()).toMatchObject({ status: "running", answer: null });
  expect(finalReply).not.toHaveBeenCalled();
  expect(await call()).toMatchObject({ status: "completed", answer: "Result" });
  expect(finalReply).toHaveBeenCalledTimes(1);
  expect(finalReply).toHaveBeenCalledWith(runId);
  expect(own).toHaveBeenCalledWith(sessionId, runId, owner);
  expect(snapshot).not.toHaveBeenCalled();
  expect(wait).not.toHaveBeenCalled();
});
