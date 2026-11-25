import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDanger, confirmUnsavedSwitch } from "@ontomato/platform-shell";
import type { PageHeaderDraft } from "../base/page-header-types";
import { usePanelContext } from "./context";

export type UnsavedSwitchMode = "discard-or-cancel" | "save-discard-cancel";

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
  /**
   * Guards switching away from this form while it has unsaved edits.
   * In `"save-discard-cancel"` mode, presents Save and switch / Discard changes / Cancel: Save submits and proceeds
   * only if submission succeeds, Discard resets without re-confirming, and Cancel aborts.
   */
  confirmSwitch?: (mode?: UnsavedSwitchMode) => Promise<boolean>;
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
  const i18n = (() => {
    try {
      return useI18n();
    } catch {
      return null;
    }
  })();
  const tr = (key: string, fallback: string) => (i18n && i18n.te(key) ? i18n.t(key) : fallback);

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
      confirmSwitch: async (mode: UnsavedSwitchMode = "discard-or-cancel") => {
        if (!handle.dirty.value) return true;
        if (mode === "save-discard-cancel") {
          const decision = await confirmUnsavedSwitch(
            tr("platform.formLeaveUnsavedSwitch", "This form has unsaved changes. Save before switching, or discard them?"),
            tr("platform.unsavedChanges", "Unsaved changes"),
            {
              saveButtonText: tr("platform.formSaveAndSwitch", "Save and switch"),
              discardButtonText: tr("platform.formDiscardChanges", "Discard changes"),
            },
          );
          if (decision === "cancel") return false;
          if (decision === "discard") {
            await handle.reset({ confirm: false });
            return true;
          }
          try {
            const outcome = await handle.submit();
            return outcome !== null && outcome !== false;
          } catch {
            return false;
          }
        }
        const confirmed = await confirmDanger(
          tr("platform.formLeaveUnsaved", "This form has changes you have not saved. Discard them and open the other item?"),
          tr("platform.unsavedChanges", "Unsaved changes"),
          {
            confirmButtonText: tr("platform.discard", "Discard"),
            cancelButtonText: tr("common.cancel", "Cancel"),
          },
        );
        if (!confirmed) return false;
        await handle.reset({ confirm: false });
        return true;
      },
    };
  });
}
