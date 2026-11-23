import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PresentationFrame } from "@ontomato/contracts/agent-presentation";
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

  it("blocks draft fill on a dirty form without silently overwriting, and allows it only after overwriteUnsavedDraft: true", async () => {
    const { display } = setup();
    await display.present(frame({ kind: "page", address: "/actions" }));
    display.dirty(true);

    const applyAddress = vi.fn();
    const unregister = display.registerPageController("/actions", { applyState: vi.fn(), applyAddress });

    const draftAddress = "/actions?draftSessionId=s1&draftRunId=r1&draftPath=outputs%2Fdrafts%2Fedit.page-draft.json";
    const blocked = await display.present(frame({ kind: "page", address: draftAddress }));
    expect(blocked).toMatchObject({
      status: "not_opened",
      reason: "blocked_unsaved",
      error: { code: "UNSAVED_FORM_CONFLICT" },
      current: { target: { kind: "page", url: "/actions" } },
    });
    expect(display.page.value?.address).toBe("/actions");
    expect(applyAddress).not.toHaveBeenCalled();

    // After user explicitly confirms in chat, agent calls present again with overwriteUnsavedDraft: true.
    const overwritten = await display.present(frame({ kind: "page", address: draftAddress, overwriteUnsavedDraft: true }));
    await nextTick();
    expect(overwritten).toMatchObject({
      status: "opened",
      reason: "target_selected",
      current: { target: { kind: "page", url: draftAddress } },
    });
    expect(applyAddress).toHaveBeenCalledWith(draftAddress, { overwriteUnsavedDraft: true });
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
});
