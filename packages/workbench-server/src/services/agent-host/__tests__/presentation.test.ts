import { expect, it, vi } from "vitest";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { presentationResultSchema, type ObservedPageTarget, type PresentationFrame } from "@ontomato/contracts/agent-presentation";
import { GENERAL_SETTINGS } from "@ontomato/contracts/platform-object-types";
import { panelOperationStore } from "../../product-panels/operation-store";
import {
  hasActivePresentationForRun,
  isLivePresentationEligibleRun,
  openPresentationView,
  presentationCallback,
  receivePresentation,
  releasePresentationRun,
  requestPresentation,
  visibilityReader,
} from "../presentation";

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
    expect(hasActivePresentationForRun("workbench", owner, runId)).toBe(true);
    expect(isLivePresentationEligibleRun({
      host: "workbench",
      owner,
      runId,
      sessionId: session.sessionId,
      channel: bound,
    })).toBe(true);
    expect(isLivePresentationEligibleRun({
      host: "workbench",
      owner,
      runId,
      sessionId: session.sessionId,
      channel: { ...bound, authority: { classNames: [], executionKind: "build-test" } },
    })).toBe(true);
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
    expect(hasActivePresentationForRun("workbench", owner, runId)).toBe(false);
    expect(issue(bound)).toBeUndefined();
  } finally {
    view.abort();
    releasePresentationRun("workbench", owner, runId);
    vi.unstubAllEnvs();
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
    // Establish an initial page observation for this run so fill_form and page_action have a platform-bound basis.
    const observePending = requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId,
        toolCallId: "obs-0",
        input: { mode: "observe" },
      },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    receivePresentation("workbench", owner, session.sessionId, runId, {
      connectionId,
      toolCallId: "obs-0",
      result: {
        status: "observed",
        reason: "current_display",
        current: {
          known: true,
          observedAt: new Date().toISOString(),
          placement: "side",
          target: { kind: "page", url: "/actions", label: "Actions", selection: [], pageInstanceId: "page-0" },
          load: { status: "ready" },
        },
      },
    });
    expect(await observePending).toMatchObject({ status: "observed" });

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
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({
      type: "presentation",
      toolCallId: "fill-1",
      target: {
        kind: "fill_form",
        member: "form",
        values: { "/name": "Remote Name" },
        expectedPageInstanceId: "page-0",
      },
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
          target: { kind: "page", url: "/actions", label: "Actions", selection: [], pageInstanceId: "page-0" },
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
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    callAbort.abort();
    expect(await actionPending).toMatchObject({
      status: "awaiting_confirmation",
      intentId,
      questionId,
      operation: "form.save",
    });

    // Dispatched intent whose outcome is not recorded yet must report unknown (never action_completed).
    const baseIntent = {
      intentId,
      source: { kind: "agent-page" as const, sessionId: session.sessionId, runId, toolCallId: "act-dispatched", autoMode: true, questionId: null },
      initiator: owner,
      use: { applicationId: "app", useId: "use" },
      panelId: "panel",
      projectionId: "proj",
      binding: { kind: "object-type" as const, id: "platform:Action" },
      operation: { id: "form.save", kind: "form.save" as const, slot: "form", effect: "write" as const, handlerRef: "form.save", label: "Save", target: { source: "draft" as const } },
      call: { input: {} },
      confirmation: { kind: "none" as const },
    };
    const abortRecover = async (toolCallId: string, intent: Record<string, unknown>) => {
      findSpy.mockResolvedValueOnce({ kind: "current", intent } as never);
      const signal = new AbortController();
      const pending = requestPresentation(
        service, "workbench", owner,
        { viewId: binding.viewId, sessionId: session.sessionId, runId, toolCallId, input: { mode: "page_action", operation: "form.save" } },
        signal.signal,
      );
      await vi.waitFor(() => expect(sent.some(frame => (frame as { toolCallId?: string }).toolCallId === toolCallId)).toBe(true));
      signal.abort();
      return pending;
    };

    expect(await abortRecover("act-null-outcome", { ...baseIntent, dispatched: true, outcome: null })).toMatchObject({
      status: "unknown",
      reason: "receipt_missing",
      intentId,
      error: { code: "ACTION_OUTCOME_UNKNOWN" },
    });
    expect(await abortRecover("act-refused", {
      ...baseIntent, dispatched: true, outcome: { kind: "refusal", code: "REVISION_CONFLICT", message: "Changed" },
    })).toMatchObject({
      status: "not_executed",
      reason: "failed",
      intentId,
      error: { code: "REVISION_CONFLICT", message: "Changed" },
    });
    expect(await abortRecover("act-task-running", {
      ...baseIntent, dispatched: true, outcome: { kind: "refusal", code: "TASK_RUNNING", message: "Already running" },
    })).toMatchObject({
      status: "not_executed",
      reason: "failed",
      intentId,
      error: { code: "TASK_RUNNING", message: "Already running" },
    });
    const settings = { objectType: GENERAL_SETTINGS, primaryKey: "general" };
    const partialSave = {
      kind: "refusal",
      code: "FORBIDDEN",
      message: "DSL timeout — This setting cannot be changed",
      savedFields: { "/knowledgeMaxResult": 18 },
      affected: { objects: [settings], objectTypes: [GENERAL_SETTINGS] },
      errors: [{ field: "/dslCookerTimeoutSeconds", code: "target_unavailable", message: "DSL timeout — This setting cannot be changed" }],
    };
    const recovered = await abortRecover("act-partial-save", {
      ...baseIntent, dispatched: true, outcome: partialSave,
      call: { target: { ...settings, kind: "object" }, input: { values: { knowledgeMaxResult: 18, dslCookerTimeoutSeconds: 40 } } },
    });
    expect(presentationResultSchema.parse(recovered)).toMatchObject({
      status: "partially_executed",
      reason: "partial_completion",
      intentId,
      savedFields: ["/knowledgeMaxResult"],
      outcome: partialSave,
      error: { code: "FORBIDDEN", message: "DSL timeout — This setting cannot be changed" },
    });
    const batchPartial = {
      kind: "batch",
      items: [
        { target: { objectType: "platform:ScheduledTask", primaryKey: "t1" }, outcome: { kind: "success" } },
        { target: { objectType: "platform:ScheduledTask", primaryKey: "t2" }, outcome: { kind: "refusal", code: "TASK_RUNNING", message: "Task t2 is running" } },
      ],
    };
    const recoveredBatch = await abortRecover("act-batch-partial", {
      ...baseIntent, dispatched: true, outcome: batchPartial,
    });
    expect(presentationResultSchema.parse(recoveredBatch)).toMatchObject({
      status: "partially_executed",
      reason: "partial_completion",
      intentId,
      outcome: batchPartial,
      error: { code: "TASK_RUNNING", message: "Task t2 is running" },
    });
    const batchSkipped = {
      kind: "batch",
      items: [
        { target: { objectType: "platform:ScheduledTask", primaryKey: "t1" }, outcome: { kind: "skipped", reason: "Already running" } },
      ],
    };
    expect(presentationResultSchema.parse(await abortRecover("act-batch-skipped", {
      ...baseIntent, dispatched: true, outcome: batchSkipped,
    }))).toMatchObject({ status: "executed", reason: "action_completed", outcome: batchSkipped });
    expect(await abortRecover("act-unknown", {
      ...baseIntent, dispatched: true, outcome: { kind: "unknown", message: "Upstream timed out" },
    })).toMatchObject({
      status: "unknown",
      reason: "receipt_missing",
      intentId,
      error: { code: "ACTION_OUTCOME_UNKNOWN", message: "Upstream timed out" },
    });
    expect(await abortRecover("act-success", {
      ...baseIntent, dispatched: true, outcome: { kind: "success", data: { id: "1" } },
    })).toMatchObject({
      status: "executed",
      reason: "action_completed",
      intentId,
      outcome: { kind: "success", data: { id: "1" } },
    });
    expect(await abortRecover("act-stale", {
      ...baseIntent, dispatched: false, invalidated: { code: "FORM_CONFIRMATION_STALE", message: "Already saved" },
    })).toMatchObject({
      status: "not_executed",
      reason: "stale",
      intentId,
      error: { code: "FORM_CONFIRMATION_STALE" },
    });
  } finally {
    findSpy.mockRestore();
    view.abort();
  }
});

it.each([
  { action: { mode: "fill_form", member: "form", values: { "/name": "Updated" } }, refresh: { mode: "observe" } },
  { action: { mode: "page_action", operation: "form.save" }, refresh: { target: "/contacts" } },
] as const)("binds the first $action.mode to the sent page and replaces the basis after $refresh", async ({ action, refresh }) => {
  vi.stubEnv("AGENT_RUNTIME_SERVICE_TOKEN", "presentation-test-only");
  const view = new AbortController();
  const viewId = "44444444-4444-4444-8444-444444444444";
  const initialPage: ObservedPageTarget = {
    kind: "page", url: "/contacts", label: "Contacts", selection: [],
    pageInstanceId: "page-at-send", panelInstanceId: "panel-at-send",
    entryInstances: { "form.save": "save-at-send" },
    forms: [{
      member: "form", formInstanceId: "form-at-send", dirty: false, values: { name: "Alice" },
      target: { kind: "object", objectType: "crm:Contact", primaryKey: "alice" },
    }],
  };
  const latest: ObservedPageTarget = {
    ...initialPage,
    pageInstanceId: "page-latest",
    forms: [{ ...initialPage.forms![0]!, formInstanceId: "form-latest" }],
    entryInstances: { "form.save": "save-latest" },
  };
  const targets: PresentationFrame["target"][] = [];
  const connectionId = openPresentationView("workbench", owner, viewId, (frame) => {
    if (frame.type !== "presentation") return;
    targets.push(frame.target);
    const current = {
      known: true as const, observedAt: new Date().toISOString(), placement: "side" as const,
      target: frame.target.kind === "observe" || frame.target.kind === "page" ? latest : initialPage,
      load: { status: "ready" as const },
    };
    const target = frame.target;
    receivePresentation("workbench", owner, session.sessionId, runId, {
      connectionId, toolCallId: frame.toolCallId,
      result: target.kind === "observe" ? { status: "observed", reason: "current_display", current }
        : target.kind === "page" ? { status: "opened", reason: "target_selected", current }
        : target.kind === "fill_form" ? { status: "filled", reason: "form_updated", member: "form", filledFields: ["/name"], current }
        : { status: "executed", reason: "action_completed", operation: "form.save", current },
    });
  }, view.signal);
  const service = { ownRun: vi.fn(async () => {}) } as unknown as Parameters<typeof requestPresentation>[0];
  const request = (toolCallId: string, input: Parameters<typeof requestPresentation>[3]["input"]) =>
    requestPresentation(service, "workbench", owner, { viewId, sessionId: session.sessionId, runId, toolCallId, input }, view.signal);
  const bind = (presentationBinding: AgentPrepareRequest["presentationBinding"]) =>
    presentationCallback("workbench", { ...direct, presentationBinding }, owner, { token: "fixture" }, Date.now() + 60_000);

  try {
    expect(bind({ viewId, initialPage })).toBeDefined();
    expect(await request("first", action)).toMatchObject({
      status: action.mode === "fill_form" ? "filled" : "executed",
    });
    expect(targets[0]).toMatchObject({
      kind: action.mode,
      expectedPageInstanceId: "page-at-send",
      expectedPanelInstanceId: "panel-at-send",
      expectedTarget: { kind: "object", objectType: "crm:Contact", primaryKey: "alice" },
      ...(action.mode === "fill_form" ? { expectedFormInstanceId: "form-at-send" } : { expectedEntryInstanceId: "save-at-send" }),
    });

    await request("refresh", refresh);
    await request("after-refresh", action);
    expect(targets[2]).toMatchObject({
      expectedPageInstanceId: "page-latest",
      ...(action.mode === "fill_form" ? { expectedFormInstanceId: "form-latest" } : { expectedEntryInstanceId: "save-latest" }),
    });

    expect(bind({ viewId })).toBeDefined();
    expect(await request("unobserved", action)).toMatchObject({
      status: action.mode === "fill_form" ? "not_filled" : "not_executed",
      reason: "stale", current: { known: false, reason: "no_prior_observation" },
    });
    expect(targets).toHaveLength(3);
  } finally {
    view.abort();
    releasePresentationRun("workbench", owner, runId);
    vi.unstubAllEnvs();
  }
});

it("rejects fill_form and page_action without prior observation and auto-injects binding basis from the last snapshot", async () => {
  const view = new AbortController();
  const binding = { viewId: "55555555-5555-4555-8555-555555555555" };
  const freshRunId = "66666666-6666-4666-8666-666666666666";
  const frames: unknown[] = [];
  const selected = {
    known: true as const,
    observedAt: new Date().toISOString(),
    placement: "side" as const,
    target: {
      kind: "page" as const,
      url: "/actions",
      label: "Actions",
      selection: [],
      pageInstanceId: "page-inst-1",
      panelInstanceId: "panel-inst-1",
      memberInstances: { detail: "nested-inst-1" },
      entryInstances: {
        "row:list.batchDelete": "list-entry-1",
        "list.batchDelete": "batch-entry-1",
        "detail.form.save": "form-entry-1",
      },
      checkedKeys: { checked: ["platform:ScheduledTask:task-1", "platform:ScheduledTask:task-2"] },
      dashboardId: "dash-a",
      cardId: "card-1",
      forms: [
        {
          member: "form",
          memberPath: [{ member: "detail" }] as [{ member: string }],
          formInstanceId: "form-inst-1",
          target: { kind: "object" as const, objectType: "platform:ScheduledTask", primaryKey: "task-1" },
          dirty: false,
          values: {},
        },
      ],
    },
    load: { status: "ready" as const },
  };
  const service = {
    ownRun: vi.fn(async () => {}),
    resolve: vi.fn(async () => ({ artifact: null })),
  } as unknown as Parameters<typeof requestPresentation>[0];
  const connectionId = openPresentationView("workbench", owner, binding.viewId, (frame) => {
    if (frame.type !== "presentation") return;
    frames.push(frame);
    if (frame.target.kind === "observe") {
      receivePresentation("workbench", owner, session.sessionId, freshRunId, {
        connectionId,
        toolCallId: frame.toolCallId,
        result: { status: "observed", reason: "current_display", current: selected },
      });
    } else if (frame.target.kind === "fill_form") {
      receivePresentation("workbench", owner, session.sessionId, freshRunId, {
        connectionId,
        toolCallId: frame.toolCallId,
        result: {
          status: "filled",
          reason: "form_updated",
          member: "form",
          filledFields: ["/name"],
          current: selected,
        },
      });
    } else if (frame.target.kind === "page_action") {
      receivePresentation("workbench", owner, session.sessionId, freshRunId, {
        connectionId,
        toolCallId: frame.toolCallId,
        result: {
          status: "executed",
          reason: "action_completed",
          operation: frame.target.operation,
          current: selected,
        },
      });
    }
  }, view.signal);
  try {
    // 1. Without a prior page observation in this run, fill_form and page_action are rejected before sending any frame.
    const noObsFill = await requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId: freshRunId,
        toolCallId: "call-fill-unobserved",
        input: { mode: "fill_form", member: "form", values: { "/name": "Blocked" } },
      },
      new AbortController().signal,
    );
    expect(noObsFill).toMatchObject({ status: "not_filled", reason: "stale" });

    const noObsAction = await requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId: freshRunId,
        toolCallId: "call-action-unobserved",
        input: { mode: "page_action", operation: "list.batchDelete" },
      },
      new AbortController().signal,
    );
    expect(noObsAction).toMatchObject({ status: "not_executed", reason: "stale" });
    expect(frames).toHaveLength(0);

    // 2. Observe the page first so the platform records the latest snapshot for this run.
    await requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId: freshRunId,
        toolCallId: "call-observe",
        input: { mode: "observe" },
      },
      new AbortController().signal,
    );

    // 3. Subsequent fill_form & page_action automatically receive platform-injected expected* basis fields.
    await requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId: freshRunId,
        toolCallId: "call-fill-bound",
        input: {
          mode: "fill_form",
          member: "form",
          memberPath: ["detail"],
          values: { "/name": "Bound" },
        },
      },
      new AbortController().signal,
    );
    await requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId: freshRunId,
        toolCallId: "call-action-bound",
        input: {
          mode: "page_action",
          operation: "list.batchDelete",
        },
      },
      new AbortController().signal,
    );
    await requestPresentation(
      service,
      "workbench",
      owner,
      {
        viewId: binding.viewId,
        sessionId: session.sessionId,
        runId: freshRunId,
        toolCallId: "call-row-action-bound",
        input: {
          mode: "page_action",
          operation: "list.batchDelete",
          rowKey: "platform:ScheduledTask:task-1",
        },
      },
      new AbortController().signal,
    );
    expect(frames.slice(1)).toEqual([
      expect.objectContaining({
        toolCallId: "call-fill-bound",
        target: {
          kind: "fill_form",
          member: "form",
          memberPath: ["detail"],
          values: { "/name": "Bound" },
          expectedPageInstanceId: "page-inst-1",
          expectedPanelInstanceId: "panel-inst-1",
          expectedMemberInstanceId: "nested-inst-1",
          expectedFormInstanceId: "form-inst-1",
          expectedTarget: { kind: "object", objectType: "platform:ScheduledTask", primaryKey: "task-1" },
          expectedDashboardId: "dash-a",
          expectedCardId: "card-1",
        },
      }),
      expect.objectContaining({
        toolCallId: "call-action-bound",
        target: {
          kind: "page_action",
          operation: "list.batchDelete",
          expectedPageInstanceId: "page-inst-1",
          expectedPanelInstanceId: "panel-inst-1",
          expectedEntryInstanceId: "batch-entry-1",
          expectedCheckedKeys: ["platform:ScheduledTask:task-1", "platform:ScheduledTask:task-2"],
          expectedDashboardId: "dash-a",
          expectedCardId: "card-1",
        },
      }),
      expect.objectContaining({
        toolCallId: "call-row-action-bound",
        target: {
          kind: "page_action",
          operation: "list.batchDelete",
          rowKey: "platform:ScheduledTask:task-1",
          expectedPageInstanceId: "page-inst-1",
          expectedPanelInstanceId: "panel-inst-1",
          expectedEntryInstanceId: "list-entry-1",
          expectedDashboardId: "dash-a",
          expectedCardId: "card-1",
        },
      }),
    ]);
  } finally {
    view.abort();
  }
});
