import { expect, it, vi } from "vitest";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { openPresentationView, presentationCallback, receivePresentation, requestPresentation, visibilityReader } from "../presentation";

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
  const binding = { viewId: "44444444-4444-4444-8444-444444444444" };
  openPresentationView("workbench", owner, binding.viewId, () => {}, view.signal);
  const bound = { ...direct, presentationBinding: binding };
  const issue = (body: AgentPrepareRequest, host: "workbench" | "observe" = "workbench") =>
    presentationCallback(host, body, owner, { token: "fixture" }, Date.now() + 60_000);

  try {
    expect(issue(bound)?.url).toContain(`/runs/${runId}/presentation-call/${binding.viewId}`);
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

it("forwards overwriteUnsavedDraft in the live page presentation frame", async () => {
  const view = new AbortController();
  const binding = { viewId: "55555555-5555-4555-8555-555555555555" };
  const sent: unknown[] = [];
  const connectionId = openPresentationView("workbench", owner, binding.viewId, (frame) => sent.push(frame), view.signal);
  try {
    const service = {
      ownRun: vi.fn(async () => {}),
      resolve: vi.fn(),
    } as never;
    const pending = requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId,
        toolCallId: "call-overwrite",
        input: {
          target: "/ontology/assets/actions?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json",
          overwriteUnsavedDraft: true,
        },
      },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      type: "presentation",
      toolCallId: "call-overwrite",
      target: {
        kind: "page",
        overwriteUnsavedDraft: true,
      },
    });
    receivePresentation("workbench", owner, session.sessionId, runId, {
      connectionId,
      toolCallId: "call-overwrite",
      result: {
        status: "opened",
        reason: "target_selected",
        current: {
          known: true,
          observedAt: new Date().toISOString(),
          placement: "side",
          target: { kind: "page", url: "/ontology/assets/actions", label: "Actions", selection: [], state: { activeTab: "definition" } },
          load: { status: "ready" },
        },
      },
    });
    expect(await pending).toMatchObject({
      status: "opened",
      current: { target: { kind: "page", state: { activeTab: "definition" } } },
    });
  } finally {
    view.abort();
  }
});
