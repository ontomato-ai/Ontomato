import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { ElMessageBox } from "element-plus";
import { confirmDanger } from "../confirm-danger";
import { createPanelBackController, hasOpenOverlay, installPanelBackPopStateListener } from "../panel-back";
import { provideUnsavedChanges, useLeaveConfirmation, useUnsavedChanges } from "../unsaved-changes";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("createPanelBackController", () => {
  it("pushes a history entry, restores its marker after router.replace, and invokes onBack on browser Back", () => {
    window.history.replaceState({ current: "/apps/om/applications" }, "", "/apps/om/applications");
    const onBack = vi.fn();
    const controller = createPanelBackController({
      active: () => true,
      allowHistory: () => true,
      isDirty: () => false,
      confirmLeaveUnsaved: async () => true,
    });
    try {
      const stop = controller.register({ pushHistory: true, onBack });
      expect((window.history.state as Record<string, unknown>).__ontomatoPanelBack).toEqual(expect.any(String));

      // Simulate Vue Router's `router.replace` overwriting `history.state` when syncing `?state=`.
      window.history.replaceState({ current: "/apps/om/applications?state=app-1" }, "", "/apps/om/applications?state=app-1");
      expect((window.history.state as Record<string, unknown>).__ontomatoPanelBack).toBeUndefined();
      controller.syncHistorySnapshot();
      expect((window.history.state as Record<string, unknown>).__ontomatoPanelBack).toEqual(expect.any(String));

      // Simulate browser Back popping to the underlying list history entry.
      window.history.replaceState({ current: "/apps/om/applications" }, "", "/apps/om/applications");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      expect(onBack).toHaveBeenCalledOnce();
      stop();
    } finally {
      controller.dispose();
    }
  });

  it("guards dirty browser Back with confirmLeaveUnsaved, restoring the updated detail URL on cancel", async () => {
    window.history.replaceState({ current: "/apps/om/applications" }, "", "/apps/om/applications");
    let allow = false;
    const confirmLeaveUnsaved = vi.fn(async () => allow);
    const onBack = vi.fn();
    const controller = createPanelBackController({
      active: () => true,
      allowHistory: () => true,
      isDirty: () => true,
      confirmLeaveUnsaved,
    });
    try {
      controller.register({ pushHistory: true, onBack });
      window.history.replaceState({ current: "/apps/om/applications?state=app-1" }, "", "/apps/om/applications?state=app-1");
      controller.syncHistorySnapshot();

      // Cancel: URL and marker are restored to the detail address and onBack does not run.
      window.history.replaceState({ current: "/apps/om/applications" }, "", "/apps/om/applications");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      await vi.waitFor(() => expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1));
      await vi.waitFor(() =>
        expect(window.location.pathname + window.location.search).toBe("/apps/om/applications?state=app-1"),
      );
      expect(onBack).not.toHaveBeenCalled();
      expect((window.history.state as Record<string, unknown>).__ontomatoPanelBack).toEqual(expect.any(String));

      // Confirm: onBack runs once.
      allow = true;
      window.history.replaceState({ current: "/apps/om/applications" }, "", "/apps/om/applications");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      await vi.waitFor(() => expect(onBack).toHaveBeenCalledOnce());
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(2);
    } finally {
      controller.dispose();
    }
  });

  it("runs Escape in LIFO order, yields when an overlay is open, and guards dirty edits", async () => {
    let dirty = false;
    let allow = false;
    const confirmLeaveUnsaved = vi.fn(async () => allow);
    const outerBack = vi.fn();
    const innerBack = vi.fn();
    const controller = createPanelBackController({
      active: () => true,
      allowHistory: () => false,
      isDirty: () => dirty,
      confirmLeaveUnsaved,
    });
    try {
      controller.register({ pushHistory: true, onBack: outerBack });
      // History is disallowed (beside-conversation / custom frame mode).
      expect(window.history.state).toBeNull();
      controller.register({ pushHistory: false, onBack: innerBack });

      // While a dialog overlay is visible, Escape yields to the dialog.
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      document.body.append(dialog);
      expect(hasOpenOverlay()).toBe(true);
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(innerBack).not.toHaveBeenCalled();
      expect(outerBack).not.toHaveBeenCalled();
      dialog.remove();

      // Without overlays, Escape pops the LIFO top handler first.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(innerBack).toHaveBeenCalledOnce();
      expect(outerBack).not.toHaveBeenCalled();

      // Next Escape on the outer handler respects the dirty guard.
      dirty = true;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1));
      await confirmLeaveUnsaved.mock.results[0]!.value;
      await nextTick();
      expect(outerBack).not.toHaveBeenCalled();

      allow = true;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(outerBack).toHaveBeenCalledOnce());
    } finally {
      controller.dispose();
    }
  });

  it("intercepts dirty same-route popstate ahead of a later-registered router listener and lets cross-route popstate pass", async () => {
    installPanelBackPopStateListener();
    const routerPopListener = vi.fn();
    window.addEventListener("popstate", routerPopListener);
    window.history.replaceState({ current: "/ontology/relations" }, "", "/#/ontology/relations");

    let allow = false;
    const confirmLeaveUnsaved = vi.fn(async () => allow);
    const onBack = vi.fn();
    // Controller is created AFTER routerPopListener was added to window (matching PanelHost mounting after router boot).
    const controller = createPanelBackController({
      active: () => true,
      allowHistory: () => true,
      isDirty: () => true,
      confirmLeaveUnsaved,
    });
    try {
      controller.register({ pushHistory: true, onBack });
      window.history.replaceState(
        { current: "/ontology/relations?state=rel-1" },
        "",
        "/#/ontology/relations?state=rel-1",
      );
      controller.syncHistorySnapshot();

      // Same-route dirty browser Back: intercepted before routerPopListener so router cannot overwrite the list entry.
      window.history.replaceState({ current: "/ontology/relations" }, "", "/#/ontology/relations");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      expect(routerPopListener).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(window.location.hash).toBe("#/ontology/relations?state=rel-1"));
      expect(onBack).not.toHaveBeenCalled();

      // Cross-route popstate (e.g. history.go(-2) straight to #/home): passes through to routerPopListener.
      window.history.replaceState({ current: "/home" }, "", "/#/home");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      expect(routerPopListener).toHaveBeenCalledOnce();
      expect(confirmLeaveUnsaved).toHaveBeenCalledTimes(1);
      expect(onBack).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
      window.removeEventListener("popstate", routerPopListener);
    }
  });
});

describe("confirmDanger and unified unsaved-changes confirmation", () => {
  it("applies danger styling to confirm and moves initial focus to Cancel", async () => {
    const cancel = document.createElement("button");
    cancel.className = "ontomato-danger-confirm-cancel";
    document.body.append(cancel);

    let resolveConfirm!: (value: never) => void;
    const spy = vi.spyOn(ElMessageBox, "confirm").mockImplementation(
      () => new Promise<never>((resolve) => { resolveConfirm = resolve; }),
    );
    const pending = confirmDanger("Discard edits?", "Unsaved changes", {
      confirmButtonText: "Leave",
      cancelButtonText: "Cancel",
    });
    expect(spy).toHaveBeenCalledWith(
      "Discard edits?",
      "Unsaved changes",
      expect.objectContaining({
        type: "warning",
        closeOnHashChange: false,
        confirmButtonClass: "el-button--danger",
        cancelButtonClass: "ontomato-danger-confirm-cancel",
        autofocus: false,
      }),
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(cancel));
    resolveConfirm("confirm" as never);
    expect(await pending).toBe(true);
  });

  it("asks at most once across confirm() and allows() in the same leave turn, then resets for later edits", async () => {
    const ask = vi.fn(async () => true);
    let check!: ReturnType<typeof provideUnsavedChanges>;
    let leave!: ReturnType<typeof useLeaveConfirmation>;
    const child = defineComponent({
      setup() {
        useUnsavedChanges({ dirty: () => true, paths: () => ["/apps/om/applications"] });
        leave = useLeaveConfirmation();
        return () => h("div");
      },
    });
    const app = createApp(defineComponent({
      setup() {
        check = provideUnsavedChanges(ask);
        return () => h(child);
      },
    }));
    const root = document.createElement("div");
    app.mount(root);
    try {
      expect(await leave.confirm()).toBe(true);
      expect(await check.allows("/apps/om/object-types")).toBe(true);
      expect(ask).toHaveBeenCalledTimes(1);

      // After the leave turn settles, a subsequent leave asks again.
      await nextTick();
      await nextTick();
      expect(await check.allows("/apps/om/object-types")).toBe(true);
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      app.unmount();
    }
  });
});
