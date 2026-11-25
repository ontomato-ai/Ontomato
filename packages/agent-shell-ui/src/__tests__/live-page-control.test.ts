import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  presentationReceiptSchema,
  presentationResultSchema,
  type PageActionOutcome,
  type PresentationFrame,
} from "@ontomato/contracts/agent-presentation";
import { pageContextLine, writtenText } from "../page-context";
import { useConversationDisplay, type DisplayPage, type DisplayView } from "../conversation-display";

const SESSION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

function frame(target: PresentationFrame["target"]): PresentationFrame {
  return { type: "presentation", sessionId: SESSION, runId: RUN, toolCallId: `call-${Math.random()}`, target };
}

function setup(options: {
  admit?: Parameters<typeof useConversationDisplay>[0]["admit"];
  initial?: { page: DisplayPage; view: DisplayView };
  readinessTimeoutMs?: number;
  confirmLeave?: () => Promise<boolean>;
} = {}) {
  const serialized: { page: DisplayPage | null; view: DisplayView; history: string }[] = [];
  const pages: Record<string, string> = {
    "/actions": "Actions",
    "/dashboards": "Dashboards",
    "/graph": "Ontology Graph",
    "/admin/users": "Users",
    "/ontology/panels": "Panels",
  };
  const display = useConversationDisplay({
    features: () => [{ id: "panel", label: "Panel", icon: "pages", availability: "page", withConversation: true }],
    resolve: (address) => {
      const path = address.split("?")[0]!;
      return path in pages ? { featureId: "panel", address, instance: path } : null;
    },
    ...(options.admit ? { admit: options.admit } : {}),
    serialize: async (page, view, history) => {
      serialized.push({ page, view, history });
      return true;
    },
    context: (page, reported) => ({
      url: page.address,
      label: reported?.label || pages[page.instance] || "",
      selection: reported?.selection ?? [],
      ...(reported?.state ? { state: reported.state } : {}),
      ...(reported?.forms?.length ? { forms: reported.forms } : {}),
    }),
    leave: { leaves: () => false, confirm: options.confirmLeave ?? (async () => true) },
    ...(options.initial ? { initial: options.initial } : {}),
    ...(options.readinessTimeoutMs !== undefined ? { readinessTimeoutMs: options.readinessTimeoutMs } : {}),
  });
  display.placed(() => "side");
  return { display, serialized };
}

describe("live agent page control (requirement-64995244)", () => {
  it("preserves all three layout states (none -> side, side -> side, full -> full) and writes navigation to address", async () => {
    // 1. Conversation only -> opens in side-by-side and writes to address.
    const { display, serialized } = setup();
    expect(display.target.value).toBeNull();
    const opened = await display.present(frame({ kind: "page", address: "/actions" }));
    expect(opened).toMatchObject({ status: "opened", reason: "target_selected" });
    expect(display.view.value).toBe("side");
    expect(display.restorable.value).toBe(true);
    expect(serialized.at(-1)).toMatchObject({ page: { address: "/actions" }, view: "side", history: "push" });

    // 2. Already side-by-side -> stays side-by-side when switching pages.
    await display.present(frame({ kind: "page", address: "/graph" }));
    expect(display.view.value).toBe("side");
    expect(display.page.value?.address).toBe("/graph");
    expect(serialized.at(-1)).toMatchObject({ page: { address: "/graph" }, view: "side", history: "push" });

    // 3. Already full-page -> stays full-page when switching pages (only user collapse returns to side).
    await display.setView("full");
    expect(display.view.value).toBe("full");
    await display.present(frame({ kind: "page", address: "/actions" }));
    expect(display.view.value).toBe("full");
    expect(display.page.value?.address).toBe("/actions");
    expect(serialized.at(-1)).toMatchObject({ page: { address: "/actions" }, view: "full", history: "push" });
  });

  it("rejects unauthorized entries without opening or replacing the right pane and returns the refusal reason", async () => {
    const admit = vi.fn(async (address: string) =>
      address.startsWith("/admin/")
        ? { ok: false as const, reason: "forbidden" as const, error: { code: "FORBIDDEN", message: "No access to Users" } }
        : { ok: true as const },
    );
    const { display, serialized } = setup({ admit });
    await display.present(frame({ kind: "page", address: "/actions" }));
    const beforeWrites = serialized.length;

    const denied = await display.present(frame({ kind: "page", address: "/admin/users" }));
    expect(denied).toMatchObject({
      status: "not_opened",
      reason: "forbidden",
      error: { code: "FORBIDDEN", message: "No access to Users" },
      current: { known: true, target: { kind: "page", url: "/actions" } },
    });
    expect(display.page.value?.address).toBe("/actions");
    expect(serialized).toHaveLength(beforeWrites);
  });

  it("updates non-deepLink declared public state in place without reloading and returns updated public state in receipt", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    const liveValues: Record<string, RuntimeJsonValue> = { activeTab: "definition", keyword: "", checked: [] };
    display.context({ url: "/actions", label: "Actions", selection: [], state: { ...liveValues } });

    const applyState = vi.fn((patch: Readonly<Record<string, RuntimeJsonValue>>) => {
      Object.assign(liveValues, patch);
      display.context({ url: "/actions", label: "Actions", selection: [], state: { ...liveValues } });
    });
    const unregister = display.registerPageController("/actions", { applyState });

    const receipt = await display.present(frame({
      kind: "page",
      address: "/actions",
      state: { activeTab: "code", checked: [{ className: "platform:Action", primaryKey: "act-1" }] },
    }));
    expect(applyState).toHaveBeenCalledWith({
      activeTab: "code",
      checked: [{ className: "platform:Action", primaryKey: "act-1" }],
    });
    expect(receipt).toMatchObject({
      status: "opened",
      reason: "target_selected",
      current: {
        target: {
          kind: "page",
          url: "/actions",
          state: { activeTab: "code", keyword: "", checked: [{ className: "platform:Action", primaryKey: "act-1" }] },
        },
      },
    });
    unregister();
  });

  it("passes explicit overwrite permission only to the mounted form", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    const fillForm = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: "blocked_unsaved", code: "UNSAVED_FORM_CONFLICT", message: "Unsaved edits" })
      .mockResolvedValueOnce({ ok: true, member: "form", filledFields: ["/name"] });
    const unregister = display.registerPageController("/actions", { applyState: vi.fn(), fillForm });
    const request = { kind: "fill_form" as const, member: "form", values: { "/name": "New name" } };

    expect(await display.present(frame(request))).toMatchObject({ status: "not_filled", reason: "blocked_unsaved" });
    expect(fillForm).toHaveBeenLastCalledWith({
      member: "form", values: request.values, agentRun: { sessionId: SESSION, runId: RUN, toolCallId: expect.any(String) },
    });
    expect(await display.present(frame({ ...request, overwriteUnsaved: true }))).toMatchObject({
      status: "filled", member: "form", filledFields: ["/name"],
    });
    expect(fillForm).toHaveBeenLastCalledWith(expect.objectContaining({
      member: "form", values: request.values, overwriteUnsaved: true,
    }));
    unregister();
  });

  it("supports mid-round observe_display re-reads capturing latest public state and unsaved form edits without navigating or changing layout", async () => {
    const { display, serialized } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    await display.setView("full");
    const writesBefore = serialized.length;

    display.context({
      url: "/actions",
      label: "Actions",
      selection: [],
      state: { activeTab: "definition" },
      forms: [{
        member: "actionForm",
        target: { kind: "object", objectType: "platform:Action", primaryKey: "act-1" },
        dirty: false,
        values: { name: "Original" },
      }],
    });
    const firstRead = await display.present(frame({ kind: "observe" }));
    expect(firstRead).toMatchObject({
      status: "observed",
      reason: "current_display",
      current: {
        known: true,
        placement: "full-page",
        target: {
          kind: "page",
          url: "/actions",
          state: { activeTab: "definition" },
          forms: [{ member: "actionForm", dirty: false, values: { name: "Original" } }],
        },
      },
    });

    // User switches tab and types unsaved edits into the form mid-round; re-reading returns the freshest snapshot.
    display.context({
      url: "/actions",
      label: "Actions",
      selection: [],
      state: { activeTab: "code" },
      forms: [{
        member: "actionForm",
        target: { kind: "object", objectType: "platform:Action", primaryKey: "act-1" },
        dirty: true,
        dirtyFields: ["/name"],
        values: { name: "User Mid-Round Edit" },
      }],
    });
    const secondRead = await display.present(frame({ kind: "observe" }));
    expect(secondRead).toMatchObject({
      status: "observed",
      reason: "current_display",
      current: {
        known: true,
        placement: "full-page",
        target: {
          kind: "page",
          url: "/actions",
          state: { activeTab: "code" },
          forms: [{ member: "actionForm", dirty: true, dirtyFields: ["/name"], values: { name: "User Mid-Round Edit" } }],
        },
      },
    });
    expect(display.view.value).toBe("full");
    expect(serialized).toHaveLength(writesBefore);
  });

  it("carries declared public state on every user message even when the page address did not change", () => {
    const prompts = {
      page: (p: { label: string; url: string }) => `Current page: ${p.label} (${p.url})`,
      pageAddress: (url: string) => `Current page: ${url}`,
      selection: (s: string) => `Selected: ${s}`,
      state: (s: string) => `State: ${s}`,
      file: (f: { label: string; path: string }) => `Current file: ${f.label} (${f.path})`,
      closed: "Current page: closed",
    };
    const context = {
      url: "/graph",
      label: "Ontology Graph",
      selection: [],
      state: { filter: "relations", search: "order" },
    };
    const line = pageContextLine(context, prompts, false);
    expect(line).toBe('State: {"filter":"relations","search":"order"}');
    expect(writtenText(`What is shown here?\n\n${line}`, prompts)).toBe("What is shown here?");
  });

  it("defers state patches when no page controller is mounted yet instead of writing non-deepLink state into the URL", async () => {
    const { display, serialized } = setup();
    // Open the page first without registering a page controller yet (e.g. while the panel component is mounting).
    await display.present(frame({ kind: "page", address: "/actions" }));
    const receipt = await display.present(frame({
      kind: "page",
      address: "/actions",
      state: { tab: "entries", creating: true },
    }));
    expect(receipt).toMatchObject({ status: "opened", reason: "target_selected" });
    // Neither the display address nor serialized URL contains raw/non-deepLink state (`creating=true`).
    expect(display.page.value?.address).toBe("/actions");
    expect(serialized.every((entry) => !entry.page?.address.includes("creating"))).toBe(true);

    // Once the panel mounts and registers its controller, the buffered state is applied immediately and the panel
    // itself writes only its deepLink fields (`tab=entries`) back into the address.
    const applied: Readonly<Record<string, RuntimeJsonValue>>[] = [];
    const unregister = display.registerPageController("/actions", {
      applyState(patch) {
        applied.push(patch);
        if (typeof patch.tab === "string") {
          display.address({ kind: "state", address: `/actions?tab=${patch.tab}` });
        }
      },
    });
    expect(applied).toEqual([{ tab: "entries", creating: true }]);
    expect(display.page.value?.address).toBe("/actions?tab=entries");
    expect(display.page.value?.address).not.toContain("creating");
    unregister();
  });

  it.each(["page_action", "fill_form"] as const)("binds a write requested by %s and invalidates it on navigation", async (kind) => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));

    const fillForm = vi.fn(async (): Promise<import("@ontomato/contracts/agent-presentation").FormFillOutcome> => ({
      ok: true,
      member: "form",
      filledFields: ["/name"],
    }));
    const cancel = vi.fn(async () => {});
    const dispatch = vi.fn(async () => ({
      ok: true as const,
      intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      outcome: { kind: "success", data: {} },
      summary: "Saved",
    }));
    const executeAction = vi.fn(async () => ({
      ok: true as const,
      kind: "awaiting_confirmation" as const,
      operation: "form.save",
      intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      questionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      label: "Save",
      confirmation: {
        intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        questionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        operationId: "form.save",
        label: "Save",
        isStillValid: () => ({ ok: true as const }),
        dispatch,
        cancel,
      },
    }));
    const unregister = display.registerPageController("/actions", {
      applyState() {},
      fillForm,
      executeAction,
    });

    // Rejecting via verifyActive guard never leaks another session's snapshot.
    const rejected = await display.present(
      frame({ kind: "fill_form", member: "form", values: { "/name": "X" } }),
      () => "not_viewing_session",
    );
    expect(rejected).toEqual({
      status: "not_filled",
      reason: "not_viewing_session",
      current: { known: false, reason: "not_viewing_session" },
    });
    expect(fillForm).not.toHaveBeenCalled();

    // Live fill_form updates the mounted form.
    const filled = await display.present(frame({ kind: "fill_form", member: "form", values: { "/name": "Action A" } }));
    expect(filled).toMatchObject({ status: "filled", reason: "form_updated", member: "form", filledFields: ["/name"] });

    const writeFrame = kind === "page_action"
      ? frame({ kind, operation: "form.save" })
      : frame({ kind, member: "form", values: { "/name": "Action B" } });
    if (kind === "fill_form") {
      fillForm.mockResolvedValueOnce({ ok: true, member: "form", filledFields: [], write: await executeAction() });
    }
    const awaiting = await display.present(writeFrame);
    expect(awaiting).toMatchObject({
      status: "awaiting_confirmation",
      intentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      questionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });

    // Navigating away cancels the pending confirmation and drops it from memory.
    await display.present(frame({ kind: "page", address: "/graph" }));
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ code: "FORM_CONFIRMATION_STALE" }));
    expect(display.takePendingActionConfirmation("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBeNull();
    unregister();
  });

  it("returns the write receipt for an automatic field saved without a question", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    const unregister = display.registerPageController("/actions", {
      applyState() {},
      async fillForm() {
        return {
          ok: true, member: "form", filledFields: [],
          write: { ok: true, kind: "executed", operation: "form.save", intentId: "saved-intent" },
        };
      },
    });
    expect(await display.present(frame({ kind: "fill_form", member: "form", values: { "/name": "Saved" } })))
      .toMatchObject({ status: "executed", intentId: "saved-intent" });
    unregister();
  });

  it("includes pageInstanceId, memberInstances, and checkedKeys in snapshots and rejects stale expectedPageInstanceId on remount or navigation (Item 1.1)", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    const fillForm = vi.fn(async () => ({ ok: true as const, member: "form", filledFields: ["/name"] }));
    const executeAction = vi.fn(async () => ({ ok: true as const, kind: "executed" as const, operation: "form.save" }));
    const unregister1 = display.registerPageController("/actions", {
      applyState() {},
      fillForm,
      executeAction,
      snapshotMeta: () => ({
        memberInstances: { detail: "nested-1" },
        checkedKeys: { checked: ["platform:Action:act-1", "platform:Action:act-2"] },
      }),
    });

    const obs1 = await display.present(frame({ kind: "observe" }));
    expect(obs1).toMatchObject({
      status: "observed",
      current: {
        known: true,
        target: {
          kind: "page",
          url: "/actions",
          memberInstances: { detail: "nested-1" },
          checkedKeys: { checked: ["platform:Action:act-1", "platform:Action:act-2"] },
        },
      },
    });
    const firstPageInstanceId =
      obs1.current.known && obs1.current.target?.kind === "page" ? obs1.current.target.pageInstanceId : undefined;
    expect(firstPageInstanceId).toBeTruthy();

    // Matching expectedPageInstanceId succeeds and forwards nested/target/checked expectations.
    const okFill = await display.present(frame({
      kind: "fill_form",
      member: "form",
      values: { "/name": "OK" },
      expectedPageInstanceId: firstPageInstanceId,
      expectedMemberInstanceId: "nested-1",
      expectedTarget: { kind: "object", objectType: "platform:Action", primaryKey: "act-1" },
    }));
    expect(okFill).toMatchObject({ status: "filled", member: "form" });
    expect(fillForm).toHaveBeenLastCalledWith(expect.objectContaining({
      member: "form",
      values: { "/name": "OK" },
      expectedPageInstanceId: firstPageInstanceId,
      expectedMemberInstanceId: "nested-1",
      expectedTarget: { kind: "object", objectType: "platform:Action", primaryKey: "act-1" },
    }));

    // Remounting the page controller at the same path rotates pageInstanceId.
    unregister1();
    const unregister2 = display.registerPageController("/actions", {
      applyState() {},
      fillForm,
      executeAction,
    });
    const obs2 = await display.present(frame({ kind: "observe" }));
    const secondPageInstanceId =
      obs2.current.known && obs2.current.target?.kind === "page" ? obs2.current.target.pageInstanceId : undefined;
    expect(secondPageInstanceId).toBeTruthy();
    expect(secondPageInstanceId).not.toBe(firstPageInstanceId);

    // Stale expectedPageInstanceId is immediately rejected with the latest current snapshot without touching the controller.
    fillForm.mockClear();
    executeAction.mockClear();
    const staleFill = await display.present(frame({
      kind: "fill_form",
      member: "form",
      values: { "/name": "Wrong" },
      expectedPageInstanceId: firstPageInstanceId,
    }));
    expect(staleFill).toMatchObject({
      status: "not_filled",
      reason: "stale",
      current: { known: true, target: { kind: "page", pageInstanceId: secondPageInstanceId } },
    });
    expect(fillForm).not.toHaveBeenCalled();

    const staleAction = await display.present(frame({
      kind: "page_action",
      operation: "form.save",
      expectedPageInstanceId: firstPageInstanceId,
    }));
    expect(staleAction).toMatchObject({
      status: "not_executed",
      reason: "stale",
      current: { known: true, target: { kind: "page", pageInstanceId: secondPageInstanceId } },
    });
    expect(executeAction).not.toHaveBeenCalled();
    unregister2();
  });

  it("waits for an in-flight page_action preparation before answering a confirmation question (Item 3.5 frontend)", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));

    let resolvePrepare!: (value: PageActionOutcome) => void;
    const questionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const intentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const dispatch = vi.fn(async () => ({ ok: true as const, intentId, outcome: { kind: "success" }, summary: "Executed" }));
    const cancel = vi.fn(async () => {});

    const unregister = display.registerPageController("/actions", {
      applyState() {},
      executeAction: () => new Promise<PageActionOutcome>((resolve) => { resolvePrepare = resolve; }),
    });

    // Start page_action preparation; SSE question arrives and user clicks Approve BEFORE prepare returns.
    const actionPromise = display.present(frame({ kind: "page_action", operation: "form.save" }));
    const waiter = display.waitPendingActionConfirmation(questionId);
    await vi.waitFor(() => expect(resolvePrepare).toBeTypeOf("function"));

    // Prepare HTTP response now finishes and registers the confirmation closure.
    resolvePrepare({
      ok: true,
      kind: "awaiting_confirmation",
      operation: "form.save",
      intentId,
      questionId,
      label: "Save",
      confirmation: {
        intentId,
        questionId,
        operationId: "form.save",
        label: "Save",
        isStillValid: () => ({ ok: true }),
        dispatch,
        cancel,
      },
    });

    const [bound, actionReceipt] = await Promise.all([waiter, actionPromise]);
    expect(actionReceipt).toMatchObject({ status: "awaiting_confirmation", intentId, questionId });
    expect(bound).not.toBeNull();
    expect(bound!.confirmation.intentId).toBe(intentId);
    expect(await bound!.confirmation.dispatch()).toEqual({ ok: true, intentId, outcome: { kind: "success" }, summary: "Executed" });
    expect(dispatch).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("waits within timeout for loading page/form/action to become ready in the same round and stops on error or session switch (Item 4)", async () => {
    const { display } = setup({ readinessTimeoutMs: 400 });
    await display.present(frame({ kind: "page", address: "/actions" }));

    // 1. Page is still loading and controller has not registered yet -> fill_form waits and succeeds once ready.
    display.loaded({ status: "loading" });
    let fillAttempts = 0;
    const fillPromise = display.present(frame({
      kind: "fill_form",
      member: "form",
      values: { "/name": "Ready soon" },
    }));
    setTimeout(() => {
      display.registerPageController("/actions", {
        applyState() {},
        fillForm: async () => {
          fillAttempts += 1;
          if (fillAttempts === 1) return { ok: false, reason: "form_not_ready", message: "Still loading form" };
          return { ok: true, member: "form", filledFields: ["/name"] };
        },
        executeAction: async () => ({ ok: false, reason: "action_not_ready", operation: "form.save", message: "Still loading" }),
      });
      display.loaded({ status: "ready" });
    }, 30);

    const filled = await fillPromise;
    expect(filled).toMatchObject({ status: "filled", member: "form", filledFields: ["/name"] });
    expect(fillAttempts).toBe(2);

    // 2. If session switches away during readiness wait -> aborts immediately with not_viewing_session.
    let activeSession = true;
    const switchedPromise = display.present(
      frame({ kind: "page_action", operation: "form.save" }),
      () => (activeSession ? null : "not_viewing_session"),
    );
    setTimeout(() => { activeSession = false; }, 20);
    const switched = await switchedPromise;
    expect(switched).toEqual({
      status: "not_executed",
      reason: "not_viewing_session",
      operation: "form.save",
      current: { known: false, reason: "not_viewing_session" },
    });

    // 3. If permanently action_not_ready -> stops at readinessTimeoutMs and reports honest action_not_ready.
    const timedOut = await display.present(frame({ kind: "page_action", operation: "form.save" }));
    expect(timedOut).toMatchObject({ status: "not_executed", reason: "action_not_ready", operation: "form.save" });

    // 4. If page load enters error state while waiting -> stops immediately without waiting for full timeout.
    display.loaded({ status: "error", error: { code: "PANEL_ERROR", message: "Load failed" } });
    const errored = await display.present(frame({ kind: "page_action", operation: "form.save" }));
    expect(errored).toMatchObject({
      status: "not_executed",
      reason: "action_not_ready",
      error: { code: "PANEL_ERROR", message: "Load failed" },
    });
  });

  it("preserves applyState deepLink address when presenting same instance with bare base path and state (C2-3)", async () => {
    const { display, serialized } = setup();
    await display.present(frame({ kind: "page", address: "/ontology/panels?selected=panel-a" }));
    expect(display.page.value?.address).toBe("/ontology/panels?selected=panel-a");

    const liveValues: Record<string, RuntimeJsonValue> = {
      selected: { className: "platform:ProductPanel", primaryKey: "panel-a" },
      detailMode: "view",
    };
    display.context({
      url: "/ontology/panels?selected=panel-a",
      label: "Panels",
      selection: [],
      state: { ...liveValues },
    });

    const unregister = display.registerPageController("/ontology/panels", {
      applyState(patch) {
        Object.assign(liveValues, patch);
        const sel = liveValues.selected as { primaryKey?: string } | null;
        const nextUrl = sel?.primaryKey
          ? `/ontology/panels?selected=${sel.primaryKey}`
          : "/ontology/panels";
        // Simulate reactive Vue watcher reporting the updated deepLink address on nextTick (as PanelApplicationRoute does).
        void nextTick(() => {
          display.address({ kind: "state", address: nextUrl });
          display.context({ url: nextUrl, label: "Panels", selection: [], state: { ...liveValues } });
        });
      },
    });

    const panelB = { className: "platform:ProductPanel", primaryKey: "panel-b" };
    const receipt = await display.present(frame({
      kind: "page",
      address: "/ontology/panels",
      state: { selected: panelB, detailMode: "edit" },
    }));

    expect(display.page.value?.address).toBe("/ontology/panels?selected=panel-b");
    expect(serialized.at(-1)?.page?.address).toBe("/ontology/panels?selected=panel-b");
    expect(receipt).toMatchObject({
      status: "opened",
      reason: "target_selected",
      current: {
        target: {
          kind: "page",
          url: "/ontology/panels?selected=panel-b",
          state: { selected: panelB, detailMode: "edit" },
        },
      },
    });

    // Explicit query navigation without state still updates the address normally on the same instance.
    const queryReceipt = await display.present(frame({
      kind: "page",
      address: "/ontology/panels?selected=panel-c",
    }));
    expect(display.page.value?.address).toBe("/ontology/panels?selected=panel-c");
    expect(queryReceipt).toMatchObject({
      status: "opened",
      reason: "target_selected",
      current: { target: { kind: "page", url: "/ontology/panels?selected=panel-c" } },
    });

    unregister();
  });

  it("reports owner unknown outcome honestly as status 'unknown' instead of 'executed' (C2-2)", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    const intentId = "33333333-3333-4333-8333-333333333333";
    const unknownOutcome = {
      kind: "batch",
      items: [
        { target: { objectType: "platform:Action", primaryKey: "a-1" }, outcome: { kind: "unknown", message: "Owner stream dropped" } },
      ],
    };
    const unregister = display.registerPageController("/actions", {
      applyState: vi.fn(),
      executeAction: async (): Promise<PageActionOutcome> => ({
        ok: false,
        kind: "unknown",
        reason: "outcome_unknown",
        operation: "list.batchUpdate",
        intentId,
        outcome: unknownOutcome,
        message: "Owner stream dropped",
      }),
    });

    const result = await display.present(frame({ kind: "page_action", operation: "list.batchUpdate" }));
    expect(result).toMatchObject({
      status: "unknown",
      reason: "outcome_unknown",
      operation: "list.batchUpdate",
      intentId,
      outcome: unknownOutcome,
      current: { known: true, target: { kind: "page", url: "/actions" } },
      error: { code: "ACTION_OUTCOME_UNKNOWN", message: "Owner stream dropped" },
    });
    expect(presentationResultSchema.safeParse(result).success).toBe(true);
    expect(presentationReceiptSchema.safeParse({
      connectionId: SESSION,
      toolCallId: "call-unknown",
      result,
    }).success).toBe(true);
    unregister();
  });

  it("blocks same-instance navigation when controller.blocksNavigation returns true without rewriting address or calling applyState", async () => {
    const { display, serialized } = setup();
    await display.present(frame({ kind: "page", address: "/dashboards?dashboardId=board-a" }));
    serialized.length = 0;

    const applyState = vi.fn();
    let dirty = true;
    const unregister = display.registerPageController("/dashboards", {
      blocksNavigation(next) {
        if (!dirty) return false;
        const fromState = typeof next.state?.dashboardId === "string" ? next.state.dashboardId : "";
        const fromQuery = new URLSearchParams(next.address.split("?")[1] ?? "").get("dashboardId") ?? "";
        const targetId = fromState || fromQuery;
        return Boolean(targetId && targetId !== "board-a");
      },
      applyState,
    });
    display.dirty(true);
    expect(display.isDirty.value).toBe(true);

    // Navigating to another board on the same mounted page instance is blocked before URL write or applyState.
    const blockedByQuery = await display.present(frame({
      kind: "page",
      address: "/dashboards?dashboardId=board-b",
    }));
    expect(blockedByQuery).toMatchObject({
      status: "not_opened",
      reason: "blocked_unsaved",
      error: { code: "UNSAVED_CHANGES" },
    });
    expect(display.page.value?.address).toBe("/dashboards?dashboardId=board-a");
    expect(serialized).toEqual([]);
    expect(applyState).not.toHaveBeenCalled();

    const blockedByState = await display.present(frame({
      kind: "page",
      address: "/dashboards",
      state: { dashboardId: "board-b" },
    }));
    expect(blockedByState).toMatchObject({
      status: "not_opened",
      reason: "blocked_unsaved",
      error: { code: "UNSAVED_CHANGES" },
    });
    expect(applyState).not.toHaveBeenCalled();

    // Selecting a card on the SAME board is NOT blocked.
    const sameBoardCard = await display.present(frame({
      kind: "page",
      address: "/dashboards?dashboardId=board-a",
      state: { cardId: "c2" },
    }));
    expect(sameBoardCard).toMatchObject({ status: "opened", reason: "target_selected" });
    expect(applyState).toHaveBeenCalledWith({ cardId: "c2" });

    // Once clean, navigating to board-b succeeds.
    dirty = false;
    display.dirty(false);
    expect(display.isDirty.value).toBe(false);
    const allowed = await display.present(frame({
      kind: "page",
      address: "/dashboards?dashboardId=board-b",
    }));
    expect(allowed).toMatchObject({ status: "opened", reason: "target_selected" });
    expect(display.page.value?.address).toBe("/dashboards?dashboardId=board-b");

    unregister();
  });

  it("prompts leave confirmation when a human clicks a same-instance link to another board and blocks bare /dashboards present while dirty", async () => {
    const confirmLeave = vi.fn<[], Promise<boolean>>();
    const { display, serialized } = setup({ confirmLeave });
    await display.present(frame({ kind: "page", address: "/dashboards?dashboardId=board-a" }));
    serialized.length = 0;

    const applyState = vi.fn();
    const unregister = display.registerPageController("/dashboards", {
      blocksNavigation(next) {
        const query = next.address.split("?")[1] ?? "";
        const queryId = new URLSearchParams(query).get("dashboardId") ?? "";
        const stateId = typeof next.state?.dashboardId === "string" ? next.state.dashboardId : "";
        if (stateId) return stateId !== "board-a";
        if (queryId) return queryId !== "board-a";
        const isCardPatch =
          Boolean(next.state && Object.keys(next.state).length === 1 && typeof next.state.cardId === "string")
          && !next.address.includes("?");
        return !isCardPatch;
      },
      applyState,
    });
    display.dirty(true);

    // 1. Human clicks a conversation link to another board -> triggers leave confirmation; choosing Stay preserves board-a.
    confirmLeave.mockResolvedValueOnce(false);
    const stayed = await display.navigate("/dashboards?dashboardId=board-b", { view: "side", history: "push" });
    expect(stayed).toBe(false);
    expect(confirmLeave).toHaveBeenCalledTimes(1);
    expect(display.page.value?.address).toBe("/dashboards?dashboardId=board-a");
    expect(serialized).toEqual([]);

    // 2. Human clicks a link to a card on the SAME board -> does not prompt leave confirmation.
    const sameBoard = await display.navigate("/dashboards?dashboardId=board-a&cardId=c1", { view: "side", history: "push" });
    expect(sameBoard).toBe(true);
    expect(confirmLeave).toHaveBeenCalledTimes(1);
    expect(display.page.value?.address).toBe("/dashboards?dashboardId=board-a&cardId=c1");
    serialized.length = 0;

    // 3. Agent calling present({ target: "/dashboards" }) without dashboardId is blocked as blocked_unsaved.
    const bareBlocked = await display.present(frame({ kind: "page", address: "/dashboards" }));
    expect(bareBlocked).toMatchObject({
      status: "not_opened",
      reason: "blocked_unsaved",
      error: { code: "UNSAVED_CHANGES" },
    });
    expect(display.page.value?.address).toBe("/dashboards?dashboardId=board-a&cardId=c1");
    expect(serialized).toEqual([]);
    expect(applyState).not.toHaveBeenCalled();

    // 4. Bare /dashboards with only a cardId state patch still passes through on the same board.
    const cardPatch = await display.present(frame({
      kind: "page",
      address: "/dashboards",
      state: { cardId: "c2" },
    }));
    expect(cardPatch).toMatchObject({ status: "opened", reason: "target_selected" });
    expect(applyState).toHaveBeenCalledWith({ cardId: "c2" });
    expect(display.page.value?.address).toBe("/dashboards?dashboardId=board-a&cardId=c1");

    // 5. Human clicks link to board-b and confirms Leave -> switches to board-b.
    confirmLeave.mockResolvedValueOnce(true);
    const left = await display.navigate("/dashboards?dashboardId=board-b", { view: "side", history: "push" });
    expect(left).toBe(true);
    expect(confirmLeave).toHaveBeenCalledTimes(2);
    expect(display.page.value?.address).toBe("/dashboards?dashboardId=board-b");

    unregister();
  });

  it("validates state before mutating URL or selection when present carries query + invalid state (C2 review II.2)", async () => {
    const { display, serialized } = setup();
    await display.present(frame({ kind: "page", address: "/ontology/panels?selected=panel-a" }));
    expect(display.page.value?.address).toBe("/ontology/panels?selected=panel-a");
    const serializedCountBefore = serialized.length;

    const applyState = vi.fn();
    const unregister = display.registerPageController("/ontology/panels", {
      validateState(patch) {
        for (const key of Object.keys(patch)) {
          if (key !== "selected" && key !== "detailMode") {
            throw new Error(`Panel state has no declared public field '${key}'`);
          }
        }
      },
      applyState,
    });

    const rejected = await display.present(frame({
      kind: "page",
      address: "/ontology/panels?selected=panel-b",
      state: { detailMod: "edit" },
    }));

    expect(rejected).toMatchObject({
      status: "not_opened",
      reason: "unsupported_target",
      error: { code: "invalid_state" },
    });
    expect(display.page.value?.address).toBe("/ontology/panels?selected=panel-a");
    expect(serialized).toHaveLength(serializedCountBefore);
    expect(applyState).not.toHaveBeenCalled();
    unregister();
  });

  it("rotates pageInstanceId on in-place mountId replacement and preserves owner error codes & partial completion", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    let currentMountId = "mount-v1";
    const intentId = "44444444-4444-4444-8444-444444444444";

    let mode: "refusal" | "partial" = "refusal";
    const unregister = display.registerPageController("/actions", {
      applyState() {},
      snapshotMeta: () => ({ mountId: currentMountId, panelInstanceId: `panel-${currentMountId}` }),
      executeAction: async (): Promise<PageActionOutcome> => {
        if (mode === "refusal") {
          return {
            ok: false,
            reason: "failed",
            operation: "opRunNow.runNow",
            intentId,
            code: "TASK_RUNNING",
            message: "Task is already running.",
          };
        }
        return {
          ok: false,
          kind: "partially_executed",
          reason: "partial_completion",
          operation: "form.save",
          intentId,
          code: "FORBIDDEN",
          message: "Protected field rejected.",
          savedFields: ["/name"],
          outcome: { kind: "refusal", code: "FORBIDDEN", message: "Protected field rejected.", savedFields: { "/name": "OK" } },
        };
      },
    });

    const initialSnap = display.snapshot();
    const initialPageId = initialSnap.known && initialSnap.target?.kind === "page" ? initialSnap.target.pageInstanceId : undefined;
    expect(initialPageId).toContain(":mount-v1");

    // 1. Owner refusal preserves TASK_RUNNING error code instead of flattening to FAILED.
    const refused = await display.present(frame({
      kind: "page_action",
      operation: "opRunNow.runNow",
      expectedPageInstanceId: initialPageId,
    }));
    expect(refused).toMatchObject({
      status: "not_executed",
      reason: "failed",
      operation: "opRunNow.runNow",
      error: { code: "TASK_RUNNING", message: "Task is already running." },
    });

    // 2. Partial completion reports status 'partially_executed' with savedFields and owner code.
    mode = "partial";
    const partial = await display.present(frame({
      kind: "page_action",
      operation: "form.save",
      expectedPageInstanceId: initialPageId,
    }));
    expect(partial).toMatchObject({
      status: "partially_executed",
      reason: "partial_completion",
      operation: "form.save",
      savedFields: ["/name"],
      error: { code: "FORBIDDEN", message: "Protected field rejected." },
    });
    expect(presentationResultSchema.safeParse(partial).success).toBe(true);

    // 3. In-place panel definition update rotates mountId -> stale expectedPageInstanceId is rejected.
    currentMountId = "mount-v2";
    const stale = await display.present(frame({
      kind: "page_action",
      operation: "form.save",
      expectedPageInstanceId: initialPageId,
    }));
    expect(stale).toMatchObject({
      status: "not_executed",
      reason: "stale",
    });
    const refreshedSnap = display.snapshot();
    expect(refreshedSnap.known && refreshedSnap.target?.kind === "page" ? refreshedSnap.target.pageInstanceId : undefined).toContain(":mount-v2");

    unregister();
  });
});
