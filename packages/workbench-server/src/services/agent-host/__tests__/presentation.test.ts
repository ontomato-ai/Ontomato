import { expect, it, vi } from "vitest";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { panelOperationStore } from "../../product-panels/operation-store";
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

it("supports read-only observe_display round-trips carrying live public state and form contents", async () => {
  const view = new AbortController();
  const binding = { viewId: "66666666-6666-4666-8666-666666666666" };
  const sent: unknown[] = [];
  const service = { ownRun: vi.fn(async () => {}), resolve: vi.fn() } as never;

  // Before any view connects, observe returns observed/view_unavailable.
  const unavailable = await requestPresentation(
    service,
    "workbench",
    owner,
    { viewId: binding.viewId, sessionId: session.sessionId, runId, toolCallId: "obs-0", input: { mode: "observe" } },
    new AbortController().signal,
  );
  expect(unavailable).toEqual({
    status: "observed",
    reason: "view_unavailable",
    current: { known: false, reason: "view_unavailable" },
  });

  const connectionId = openPresentationView("workbench", owner, binding.viewId, (frame) => sent.push(frame), view.signal);
  try {
    const pending = requestPresentation(
      service,
      "workbench",
      owner,
      { viewId: binding.viewId, sessionId: session.sessionId, runId, toolCallId: "obs-1", input: { mode: "observe" } },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ type: "presentation", toolCallId: "obs-1", target: { kind: "observe" } });
    receivePresentation("workbench", owner, session.sessionId, runId, {
      connectionId,
      toolCallId: "obs-1",
      result: {
        status: "observed",
        reason: "current_display",
        current: {
          known: true,
          observedAt: new Date().toISOString(),
          placement: "side",
          target: {
            kind: "page",
            url: "/ontology/assets/actions",
            label: "Actions",
            selection: [],
            state: { activeTab: "code" },
            forms: [{ member: "form", dirty: true, dirtyFields: ["/name"], values: { name: "Draft Name" } }],
          },
          load: { status: "ready" },
        },
      },
    });
    expect(await pending).toMatchObject({
      status: "observed",
      reason: "current_display",
      current: {
        target: {
          kind: "page",
          state: { activeTab: "code" },
          forms: [{ member: "form", dirty: true, values: { name: "Draft Name" } }],
        },
      },
    });
  } finally {
    view.abort();
  }
});

it("forwards fill_form and recovers page_action intent status when receipt is lost", async () => {
  const view = new AbortController();
  const binding = { viewId: "77777777-7777-4777-8777-777777777777" };
  const sent: unknown[] = [];
  const service = { ownRun: vi.fn(async () => {}), resolve: vi.fn() } as never;
  const connectionId = openPresentationView("workbench", owner, binding.viewId, (frame) => sent.push(frame), view.signal);
  const findSpy = vi.spyOn(panelOperationStore, "findByAgentToolCall");
  try {
    const fillPending = requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId,
        toolCallId: "fill-1",
        input: { mode: "fill_form", member: "form", values: { "/name": "Remote Name" } },
      },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      type: "presentation",
      toolCallId: "fill-1",
      target: { kind: "fill_form", member: "form", values: { "/name": "Remote Name" } },
    });
    receivePresentation("workbench", owner, session.sessionId, runId, {
      connectionId,
      toolCallId: "fill-1",
      result: {
        status: "filled",
        reason: "form_updated",
        member: "form",
        filledFields: ["/name"],
        current: {
          known: true,
          observedAt: new Date().toISOString(),
          placement: "side",
          target: { kind: "page", url: "/actions", label: "Actions", selection: [] },
          load: { status: "ready" },
        },
      },
    });
    expect(await fillPending).toMatchObject({ status: "filled", filledFields: ["/name"] });

    // Simulate connection abort after browser prepared an agent-page intent that awaits confirmation.
    const intentId = "88888888-8888-4888-8888-888888888888";
    const questionId = "99999999-9999-4999-8999-999999999999";
    findSpy.mockResolvedValueOnce({
      kind: "current",
      intent: {
        intentId,
        source: { kind: "agent-page", sessionId: session.sessionId, runId, toolCallId: "act-lost", autoMode: false, questionId },
        initiator: owner,
        use: { applicationId: "app", useId: "use" },
        panelId: "panel",
        projectionId: "proj",
        binding: { kind: "object-type", id: "platform:Action" },
        operation: { id: "form.save", kind: "form.save", slot: "form", effect: "write", handlerRef: "form.save", label: "Save", target: { source: "draft" } },
        call: { input: {} },
        confirmation: { kind: "none" },
        dispatched: false,
        outcome: null,
      },
    } as never);
    const callAbort = new AbortController();
    const actionPending = requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId,
        toolCallId: "act-lost",
        input: { mode: "page_action", operation: "form.save" },
      },
      callAbort.signal,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    callAbort.abort();
    expect(await actionPending).toMatchObject({
      status: "awaiting_confirmation",
      intentId,
      questionId,
      operation: "form.save",
    });
  } finally {
    findSpy.mockRestore();
    view.abort();
  }
});
