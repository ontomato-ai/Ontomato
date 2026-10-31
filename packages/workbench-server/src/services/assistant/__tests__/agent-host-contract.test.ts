import { describe, expect, it } from "vitest";
import { agentHostSessionSchema } from "@ontomato/contracts/agent-host";
import { runOutcome, runStatusView } from "../../../platform/agent-runtime/projection";

describe("session row projection", () => {
  it("names the latest run without carrying its body", () => {
    const view = runStatusView({
      id: "11111111-1111-4111-8111-111111111111",
      status: "stopped",
      stopReason: "stop",
      errorMessage: null,
      finishedAt: "2026-10-30T00:00:01.000Z",
    } as never);
    expect(view).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      status: "stopped",
      stopReason: "stop",
    });
    expect(() =>
      agentHostSessionSchema.parse({
        id: "11111111-1111-4111-8111-111111111111",
        agentId: "22222222-2222-4222-8222-222222222222",
        title: "Session",
        createdAt: "2026-10-30T00:00:00.000Z",
        updatedAt: "2026-10-30T00:00:00.000Z",
        latestRun: { ...view, errorMessage: null },
      }),
    ).toThrow();
  });

  it("counts a length-limited run as completed because it still delivered an answer", () => {
    expect(runOutcome({ status: "stopped", stopReason: "length" })).toBe("completed");
    expect(runOutcome({ status: "stopped", stopReason: "stop" })).toBe("completed");
    expect(runOutcome({ status: "stopped", stopReason: "aborted" })).toBe("cancelled");
    expect(runOutcome({ status: "stopped", stopReason: "error" })).toBe("failed");
    expect(runOutcome({ status: "running", stopReason: null })).toBe("running");
  });
});
