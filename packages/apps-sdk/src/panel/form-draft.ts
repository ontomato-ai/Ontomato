import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { PageHeaderDraft } from "../base/page-header-types";
import { usePanelContext } from "./context";

export interface UsePanelFormDraftOptions {
  /**
   * Optional reactive guard controlling whether the draft controls are shown (for example `() => detail.value.status === "ready"`).
   * Defaults to `true` whenever the form slot is mounted.
   */
  when?: MaybeRefOrGetter<boolean>;
  /**
   * Whether clicking Discard asks the platform's confirmation dialog before restoring the owner baseline.
   * Defaults to `true`.
   */
  confirmDiscard?: boolean;
}

export interface PanelFormDraftControls extends PageHeaderDraft {
  /** Refreshes the owner's fields and validation for the current values, preserving unsaved edits. */
  refreshDraft(): Promise<void>;
}

/**
 * Binds one mounted `ObjectForm` slot to `<page-header :draft="draft">`: returns `null` while the form slot is absent
 * (or `when` is false), and otherwise exposes the header's draft controls and `refreshDraft()` wired straight to
 * `instance.forms.handle(slot)`.
 */
export function usePanelFormDraft(
  slot: MaybeRefOrGetter<string | null | undefined>,
  options?: UsePanelFormDraftOptions,
): ComputedRef<PanelFormDraftControls | null> {
  const { instance } = usePanelContext();
  const confirmDiscard = options?.confirmDiscard ?? true;

  return computed<PanelFormDraftControls | null>(() => {
    if (options?.when !== undefined && !toValue(options.when)) return null;
    const slotName = toValue(slot);
    if (!slotName) return null;
    const handle = instance.forms.handle(slotName);
    if (!handle) return null;
    return {
      dirty: handle.dirty.value,
      saving: handle.submitting.value,
      canSave: handle.canSubmit.value,
      refreshDraft: () => handle.refreshDraft(),
      save: () => {
        // ObjectForm displays owner validation/refusal feedback inline on the form itself.
        void handle.submit().catch(() => undefined);
      },
      discard: () => {
        void handle.reset({ confirm: confirmDiscard });
      },
    };
  });
}
