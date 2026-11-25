import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import type { PageHeaderDraft } from "../base/page-header-types";
import { usePanelContext } from "./context";

export interface UsePanelFormDraftOptions {
  /**
   * Optional reactive guard controlling whether the draft controls are shown (for example `() => detail.value.status === "ready"`).
   * Defaults to `true` whenever the form slot is mounted or holds a stashed unsaved draft on this panel instance.
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
 * Binds one `ObjectForm` slot to `<page-header :draft="draft">`: returns `null` while the form slot is absent with no
 * stashed draft (or `when` is false), and otherwise exposes the header's draft controls and `refreshDraft()` wired
 * straight to `instance.forms`. When a dirty form is temporarily hidden (for example on another tab), the header
 * continues to display its unsaved indicator and Discard action until the form is remounted, saved, or discarded.
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
    if (handle) {
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
    }
    if (instance.forms.hasStashedDraft(slotName)) {
      return {
        dirty: true,
        saving: false,
        canSave: false,
        refreshDraft: async () => {},
        save: () => {},
        discard: () => {
          void instance.forms.reset(slotName, { confirm: confirmDiscard });
        },
      };
    }
    return null;
  });
}
