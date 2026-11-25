import { inject, type ComputedRef, type InjectionKey } from "vue";
import type { PanelFormField } from "@ontomato/contracts/panel-projection";

/** How `ObjectForm` arranges its field groups while keeping one shared form state and draft. */
export type ObjectFormPresentation = "default" | "cards" | "tabs" | "steps";

/** How `ObjectForm` guards switching away from an edited form with unsaved changes. */
export type ObjectFormUnsavedSwitchMode = "discard-or-cancel" | "save-discard-cancel";

/** Declarative group assigning top-level owner fields (or owner sections) to one card, tab, or wizard step. */
export interface ObjectFormGroup {
  /** Stable identifier for this card, tab, or step (used for `activeGroup`, slots, and `data-form-group`). */
  readonly key: string;
  /** Fallback heading shown on the card, tab, or step. */
  readonly title?: string;
  /** Panel message key (resolved via `panel.t`) or platform i18n key for the heading. */
  readonly titleKey?: string;
  /** Locale-keyed headings (for example `{ en: "Identity", "zh-CN": "基础信息" }`). */
  readonly titles?: Readonly<Record<string, string>>;
  /** Optional fallback supporting description shown inside the card, tab, or step. */
  readonly description?: string;
  /** Panel or platform i18n key for the supporting description. */
  readonly descriptionKey?: string;
  /** Locale-keyed supporting descriptions. */
  readonly descriptions?: Readonly<Record<string, string>>;
  /** Top-level owner field JSON Pointer paths assigned to this group (for example `["/name", "/displayName"]`). */
  readonly fields?: readonly string[];
  /** Owner `description.sections` keys assigned to this group. */
  readonly sections?: readonly string[];
  /** Column placement when `presentation` is `"cards"` with two columns (`"main"`, `"side"`, or `"full"`). */
  readonly column?: "main" | "side" | "full";
}

/** Resolved runtime metadata for one group in `ObjectForm`, exposed to `#default` slot callers. */
export interface ObjectFormResolvedGroup {
  readonly key: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly column: "main" | "side" | "full";
  readonly fields: readonly PanelFormField[];
  readonly plain: readonly PanelFormField[];
  readonly advanced: readonly PanelFormField[];
  readonly changed: boolean;
  readonly dirty: boolean;
  readonly errorCount: number;
}

/** Slot scope passed to `ObjectForm`'s `#default` slot for custom multi-card, multi-tab, or multi-step layouts. */
export interface ObjectFormSlotScope {
  /** Resolved field groups derived from `config.groups` or owner `description.sections`. */
  readonly groups: readonly ObjectFormResolvedGroup[];
  /** Active group key in `"tabs"` or `"steps"` mode (or `null` when no groups exist). */
  readonly activeGroup: string | null;
  /** Switches the active group key in `"tabs"` or `"steps"` mode. */
  readonly setActiveGroup: (key: string) => void;
  /** Whether the shared form currently has unsaved edits or an active draft to settle. */
  readonly dirty: boolean;
  /** Whether the shared form can currently be submitted. */
  readonly canSave: boolean;
  /** Whether a save request is currently in flight. */
  readonly saving: boolean;
  /** Whether the form is currently in create mode (`createForm`). */
  readonly isCreate: boolean;
  /** Count of distinct modified top-level fields across all cards, tabs, and steps. */
  readonly changedCount: number;
  /** Distinct top-level field paths modified in the shared draft. */
  readonly dirtyFields: ReadonlySet<string>;
  /** Current owner and local validation errors keyed by JSON Pointer path. */
  readonly errors: Readonly<Record<string, string>>;
  /** Returns `true` if any field assigned to the named group is dirty or draft-changed. */
  readonly groupDirty: (key: string) => boolean;
  /** Returns the number of validation/refusal errors targeting fields in the named group. */
  readonly groupErrorCount: (key: string) => number;
  /** Returns `true` if any of the given top-level field paths is dirty or draft-changed. */
  readonly fieldsDirty: (paths: readonly string[]) => boolean;
  /** Returns the number of validation/refusal errors targeting any of the given top-level field paths. */
  readonly fieldsErrorCount: (paths: readonly string[]) => number;
  /** Submits the shared form through the platform coordinator. */
  readonly save: () => Promise<void>;
  /** Prompts to discard unsaved changes and restores the owner baseline. */
  readonly discard: () => Promise<boolean>;
  /** Cancels create mode (confirming first when dirty). */
  readonly cancel: () => Promise<void>;
}

export interface FormFieldPlacement {
  readonly field: PanelFormField;
  readonly path: string;
  readonly disabled: boolean;
}

/** Internal context provided by `ObjectForm` to child `<object-form-fields>` slices. */
export interface FormFieldsContext {
  readonly drawn: ComputedRef<readonly PanelFormField[]>;
  readonly groups: ComputedRef<readonly ObjectFormResolvedGroup[]>;
  resolveField(path: string): FormFieldPlacement | undefined;
  childFields(parent: string): readonly FormFieldPlacement[];
  registerClaim(token: symbol, paths: ReadonlySet<string>): void;
  unregisterClaim(token: symbol): void;
  readonly claimedPaths: ComputedRef<ReadonlySet<string>>;
}

export const formFieldsContextKey: InjectionKey<FormFieldsContext> = Symbol("form-fields-context");

export function useFormFieldsContext(): FormFieldsContext {
  const ctx = inject(formFieldsContextKey, null);
  if (!ctx) {
    throw new Error("<object-form-fields> must be rendered inside an ObjectForm (<Projection> or <object-form>)");
  }
  return ctx;
}
