import { inject, onScopeDispose, toValue, watch, type MaybeRefOrGetter } from "vue";
import { panelContextKey } from "./context";

export interface UsePanelBackOptions {
  /**
   * Whether activating this back layer pushes a browser history entry so browser Back invokes `onBack`.
   * Defaults to `true`.
   */
  pushHistory?: MaybeRefOrGetter<boolean>;
}

export interface PanelBackHandle {
  /**
   * Runs the same guarded back step as Escape or browser Back (for example from a "Back to list" button): asks the
   * host's unified unsaved-changes confirmation first and calls `onBack` only if allowed. Resolves `true` when `onBack`
   * ran, `false` when cancelled or when `active` is currently `false`.
   */
  back: () => Promise<boolean>;
}

/**
 * Registers a panel-local back/close layer with the enclosing host (LIFO). While `active` is truthy:
 * - Browser Back (when `pushHistory` is true, the default) runs `onBack` after the host's unified unsaved-changes guard.
 * - Pressing Escape (when no modal dialog, drawer, dropdown, or popover is open) runs `onBack` after the same guard.
 * - Calling the returned `back()` runs the same guard and then `onBack`, keeping UI back buttons and browser Back in sync.
 */
export function usePanelBack(
  active: MaybeRefOrGetter<boolean>,
  onBack: () => void,
  options?: UsePanelBackOptions,
): PanelBackHandle {
  const panel = inject(panelContextKey, null);
  let unregister: (() => void) | null = null;
  let runningBack = false;

  const release = () => {
    if (!unregister) return;
    const stop = unregister;
    unregister = null;
    stop();
  };

  const stopWatch = watch(
    () => [Boolean(toValue(active)), Boolean(toValue(options?.pushHistory ?? true))] as const,
    ([isActive, pushHistory]) => {
      release();
      if (!isActive || !panel?.registerBackHandler) return;
      unregister = panel.registerBackHandler({ pushHistory, onBack });
    },
    { immediate: true, flush: "sync" },
  );

  onScopeDispose(() => {
    stopWatch();
    release();
  });

  async function back(): Promise<boolean> {
    if (runningBack || !toValue(active)) return false;
    runningBack = true;
    try {
      if (panel?.confirmLeaveUnsaved) {
        const allowed = await panel.confirmLeaveUnsaved();
        if (!allowed) return false;
      }
      if (!toValue(active)) return false;
      release();
      onBack();
      return true;
    } finally {
      runningBack = false;
    }
  }

  return { back };
}
