import { inject, onScopeDispose, toValue, watch, type MaybeRefOrGetter } from "vue";
import { panelContextKey } from "./context";

export interface UsePanelBackOptions {
  /**
   * Whether activating this back layer pushes a browser history entry so browser Back invokes `onBack`.
   * Defaults to `true`.
   */
  pushHistory?: MaybeRefOrGetter<boolean>;
  /**
   * Form slot(s) owned by this back layer (for example `"attributeForm"` when closing an inline sub-editor while
   * another form on the same panel stays open). When provided, only those form slots are checked for unsaved changes
   * and discarded on confirmation, leaving other forms on the panel untouched. Pass `[]` for a purely local view layer
   * that owns no forms. Omit to guard and discard all dirty forms in the panel.
   */
  forms?: MaybeRefOrGetter<string | readonly string[] | undefined>;
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

  const scopedForms = (): readonly string[] | undefined => {
    const raw = toValue(options?.forms);
    if (raw === undefined) return undefined;
    return typeof raw === "string" ? [raw] : raw;
  };

  const isScopeDirty = (): boolean => {
    const slots = scopedForms();
    if (!panel) return false;
    if (slots === undefined) return panel.instance.dirty();
    if (slots.length === 0) return false;
    if (panel.instance.forms.dirty(slots)) return true;
    const activeDraft = panel.instance.draft.value;
    return activeDraft !== null && slots.includes(activeDraft.slot);
  };

  const runBack = () => {
    const slots = scopedForms();
    if (panel) {
      if (slots === undefined) {
        panel.instance.forms.discardAll();
      } else if (slots.length > 0) {
        panel.instance.forms.discardAll(slots);
        const activeDraft = panel.instance.draft.value;
        if (activeDraft !== null && slots.includes(activeDraft.slot)) {
          panel.instance.forms.discard(activeDraft.slot);
        }
      }
    }
    onBack();
  };

  const stopWatch = watch(
    () => [Boolean(toValue(active)), Boolean(toValue(options?.pushHistory ?? true))] as const,
    ([isActive, pushHistory]) => {
      release();
      if (!isActive || !panel?.registerBackHandler) return;
      const registration = options?.forms !== undefined
        ? { pushHistory, isDirty: isScopeDirty, onBack: runBack }
        : { pushHistory, onBack: runBack };
      unregister = panel.registerBackHandler(registration);
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
      const shouldGuard = scopedForms() === undefined ? true : isScopeDirty();
      if (shouldGuard && panel?.confirmLeaveUnsaved) {
        const allowed = await panel.confirmLeaveUnsaved();
        if (!allowed) return false;
      }
      if (!toValue(active)) return false;
      release();
      runBack();
      return true;
    } finally {
      runningBack = false;
    }
  }

  return { back };
}
