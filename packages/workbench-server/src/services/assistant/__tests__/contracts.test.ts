import {
  agentHostCreateSessionSchema,
  agentHostAgentSchema,
} from "@ontomato/contracts/agent-host";
import { describe, it, expect } from "vitest";
import {
  agentHostStartRunSchema,
  agentHostMessageSchema,
  agentHostRunSchema,
} from "@ontomato/contracts/agent-host";
const id = "00000000-0000-4000-8000-000000000001";
describe("approved assistant HTTP boundary", () => {
  it("accepts a verbatim follow-up with no predecessor or structured clarification protocol", () => {
    expect(
      agentHostStartRunSchema.parse({ message: "  Use the current year.\n" }),
    ).toEqual({ message: "  Use the current year.\n" });
    expect(
      agentHostStartRunSchema.safeParse({
        message: "yes",
        expectedLatestRunId: id,
      }).success,
    ).toBe(false);
  });
  it("uses the runtime message record without a per-message artifact boundary", () => {
    const message = {
      id,
      runId: id,
      messageSeq: 1,
      message: { role: "user", content: "Show revenue", timestamp: 0 },
    };
    expect(agentHostMessageSchema.parse(message)).toEqual(message);
    expect(
      agentHostMessageSchema.safeParse({ ...message, artifactSeq: 9 }).success,
    ).toBe(false);
  });
  it("keeps PI stopping separate from business completion", () => {
    const run = {
      id,
      sessionId: id,
      status: "stopped",
      stopReason: "stop",
      errorMessage: null,
      createdAt: "2026-10-28T00:00:00Z",
      finishedAt: "2026-10-28T00:00:01Z",
      resolvedSkills: [],
    };
    expect(agentHostRunSchema.parse(run)).toEqual(run);
    expect(
      agentHostRunSchema.safeParse({ ...run, status: "needs_input" }).success,
    ).toBe(false);
    expect(
      agentHostRunSchema.safeParse({ ...run, status: "completed" }).success,
    ).toBe(false);
  });
  it("keeps host-specific selectors and business settings out of the shared proxy", () => {
    expect(agentHostCreateSessionSchema.parse({ agentId: id })).toEqual({
      agentId: id,
    });
    expect(
      agentHostCreateSessionSchema.safeParse({
        agentId: id,
        workbenchId: "business",
      }).success,
    ).toBe(false);
    expect(
      agentHostAgentSchema.safeParse({
        id,
        name: "Assistant",
        description: "",
        icon: null,
        enabled: true,
        skills: [],
      }).success,
    ).toBe(false);
  });
});
