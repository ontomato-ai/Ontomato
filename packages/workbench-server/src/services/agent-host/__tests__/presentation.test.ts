import { expect, it, vi } from "vitest";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { openPresentationView, presentationCallback, visibilityReader } from "../presentation";

const owner = { userId: "reader", domainId: "domain" };
const actor = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", domainId: owner.domainId };
const session = { providerId: "workbench", sessionId: "11111111-1111-4111-8111-111111111111" };
const runId = "22222222-2222-4222-8222-222222222222";
const direct: AgentPrepareRequest = {
  mode: "run", language: "en", agent: { providerId: session.providerId, agentId: "assistant" },
  sessionId: session.sessionId, runId, actor, inputId: runId,
  input: { role: "user", content: "Show this page", timestamp: 1 },
  authority: { classNames: [], executionKind: "live" }, requestedBy: null,
  root: { session, runId }, userRecipient: { session, actor },
};
const notification = {
  role: "notification", kind: "agent-result", source: direct.root,
  content: "Work finished", timestamp: 2,
} as const;

it("keeps the reader across a notification wakeup and distinguishes an inherited human recipient", () => {
  expect(visibilityReader(direct)).toBe("user");
  expect(visibilityReader({ ...direct, requestedBy: direct.root })).toBe("delegated");
  expect(visibilityReader({ ...direct, input: notification })).toBe("user");
  expect(visibilityReader({ ...direct, userRecipient: null })).toBeUndefined();
});

it("issues a callback only for the same host's directly admitted human run with a live bound view", () => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "presentation-test-only");
  const view = new AbortController();
  const binding = openPresentationView("workbench", owner, () => {}, view.signal);
  const bound = { ...direct, presentationBinding: binding };
  const issue = (body: AgentPrepareRequest, host: "workbench" | "observe" = "workbench") =>
    presentationCallback(host, body, owner, { token: "fixture" }, Date.now() + 60_000);

  try {
    expect(issue(bound)?.url).toContain(`/runs/${runId}/presentation-call/${binding.connectionId}`);
    expect(issue(direct)).toBeUndefined();
    expect(issue({ ...bound, requestedBy: direct.root })).toBeUndefined();
    expect(issue({ ...bound, input: notification })).toBeUndefined();
    expect(issue({ ...bound, mode: "steer" })).toBeUndefined();
    expect(issue({ ...bound, runId: "33333333-3333-4333-8333-333333333333" })).toBeUndefined();
    const observe = { ...session, providerId: "observe" };
    expect(issue({
      ...bound, agent: { ...bound.agent, providerId: "observe" },
      root: { session: observe, runId }, userRecipient: { session: observe, actor },
    }, "observe")).toBeUndefined();
    view.abort();
    expect(issue(bound)).toBeUndefined();
  } finally {
    view.abort();
    vi.unstubAllEnvs();
  }
});
