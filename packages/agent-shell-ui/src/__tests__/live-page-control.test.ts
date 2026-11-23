import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PageActionOutcome, PresentationFrame } from "@ontomato/contracts/agent-presentation";
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
} = {}) {
  const serialized: { page: DisplayPage | null; view: DisplayView; history: string }[] = [];
  const pages: Record<string, string> = {
    "/actions": "Actions",
    "/graph": "Ontology Graph",
    "/admin/users": "Users",
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
    leave: { leaves: () => false, confirm: async () => true },
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
    expect(fillForm).toHaveBeenLastCalledWith({ member: "form", values: request.values });
    expect(await display.present(frame({ ...request, overwriteUnsaved: true }))).toMatchObject({
      status: "filled", member: "form", filledFields: ["/name"],
    });
    expect(fillForm).toHaveBeenLastCalledWith({ member: "form", values: request.values, overwriteUnsaved: true });
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

  it("executes fill_form and page_action through the mounted page controller and invalidates pending confirmation on navigation", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));

    const fillForm = vi.fn(async () => ({
      ok: true as const,
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

    // page_action returns awaiting_confirmation and binds the confirmation to this live page instance.
    const awaiting = await display.present(frame({ kind: "page_action", operation: "form.save" }));
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
    expect(fillForm).toHaveBeenLastCalledWith({
      member: "form",
      values: { "/name": "OK" },
      expectedPageInstanceId: firstPageInstanceId,
      expectedMemberInstanceId: "nested-1",
      expectedTarget: { kind: "object", objectType: "platform:Action", primaryKey: "act-1" },
    });

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
});
