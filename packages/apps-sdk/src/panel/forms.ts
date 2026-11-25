import { shallowReactive, type Ref } from "vue";
import { confirmDanger } from "@ontomato/platform-shell";
import type { ExpectedPageTarget, FormFieldRejection, FormFillOutcome, PageActionOutcome } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PageFormSnapshot } from "@ontomato/contracts/page-context";
import type { PanelFormTarget, PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { PanelFormDescription, PanelFormField, PanelFormValues, ProjectionOperationBinding } from "@ontomato/contracts/panel-projection";
import type { ObjectFormUnsavedSwitchMode } from "../base/object-form-types";
import type { PanelAgentActionContext } from "./instance";

/*
 * Live form adapters registered by mounted form projections in one panel instance. Each mounted `ObjectForm` registers
 * its handle and live editing, submission, discard, and snapshot entries under its member slot so `#field-*` slots,
 * `<page-header>`, panel operations, and assistant `fill_form` / `page_action` calls all operate on the single form.
 */

/**
 * What one form holds, as the projections placed in its `#field-*` Vue slots read and write it: the owner's
 * fields, the values, the field errors and changed marks by path, and whether the form is busy. Every one of them is the
 * form's own; a field projection never keeps a copy.
 */
export interface PanelFormHandle {
  readonly fields: Readonly<Ref<readonly PanelFormField[]>>;
  readonly values: Readonly<Ref<PanelFormValues>>;
  readonly errors: Readonly<Ref<Readonly<Record<string, string>>>>;
  readonly changed: Readonly<Ref<ReadonlySet<string>>>;
  readonly busy: Readonly<Ref<boolean>>;
  /** Whether this form currently holds unsaved edits or explicitly modified fields. */
  readonly dirty: Readonly<Ref<boolean>>;
  /** Distinct top-level field paths currently modified relative to the opened baseline. */
  readonly dirtyFields: Readonly<Ref<ReadonlySet<string>>>;
  /** Whether a save is currently in flight (alias of `busy`). */
  readonly submitting: Readonly<Ref<boolean>>;
  /** Whether the form is ready and has unsaved edits that can currently be submitted. */
  readonly canSubmit: Readonly<Ref<boolean>>;
  /** Sets one field's value; a field the owner marks `refreshOnChange` has the owner asked again. */
  set(path: string, value: RuntimeJsonValue): void;
  setFromControl?(path: string, value: RuntimeJsonValue): void;
  blurFromControl?(path: string): void;
  /** Refreshes the owner's fields and validation for the current values, preserving unsaved edits. */
  refreshDraft(): Promise<void>;
  /** Submits the form through its owner. */
  submit(): Promise<unknown>;
  /**
   * Discards unsaved edits and restores the owner baseline. Pass `{ confirm: true }` to ask the platform's
   * confirmation dialog first; resolves `true` when discarded, `false` when cancelled.
   */
  reset(options?: { confirm?: boolean }): Promise<boolean>;
}

/** Cross-member write operation submitting a form member's current values through its own bound operation. */
export interface FormSubmitOverride {
  readonly operationId: string;
  readonly descriptor: PanelOwnerOperationDescriptor;
  readonly binding?: ProjectionOperationBinding;
  readonly memberInputs?: Readonly<Record<string, unknown>>;
  /** Live reader for the originating member's inputs so pre-dispatch / confirmation verification checks live values. */
  readonly readMemberInputs?: () => Readonly<Record<string, unknown>> | undefined;
  /** Checks whether the originating button / menu entry is still mounted, visible, and enabled. */
  readonly evaluateOrigin?: () => { readonly ok: true } | { readonly ok: false; readonly message: string };
  readonly agentContext?: PanelAgentActionContext;
}

/** Outcome of filling explicit fields on a single mounted form adapter. */
export type PanelFormAdapterFillResult =
  | {
      readonly ok: true;
      readonly filledFields: readonly string[];
      readonly write?: PageActionOutcome;
      readonly rejectedFields?: readonly FormFieldRejection[];
    }
  | {
      readonly ok: false;
      readonly reason: "form_not_ready" | "blocked_unsaved" | "all_fields_rejected" | "stale";
      readonly rejectedFields?: readonly FormFieldRejection[];
      readonly message?: string;
    };

export interface FormFillOptions {
  readonly overwriteUnsaved?: boolean;
  readonly expectedFormInstanceId?: string;
  readonly expectedTarget?: ExpectedPageTarget;
  readonly executeWrite?: (operation: string, submit: (context: PanelAgentActionContext) => Promise<unknown>) => Promise<PageActionOutcome>;
}

export interface InvalidFormText {
  readonly message: string;
  readonly source: string;
}

export interface PanelFormDraft {
  readonly ownerOpened: PanelFormDescription;
  readonly ownerShown: PanelFormDescription;
  readonly values: PanelFormValues;
  readonly changed: ReadonlySet<string>;
  readonly submitted: ReadonlySet<string>;
  readonly invalid: Readonly<Record<string, InvalidFormText>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly refusal: Error | null;
  readonly editedPaths: ReadonlySet<string>;
  readonly userEditedPaths: ReadonlySet<string>;
  readonly agentFilledPaths: ReadonlySet<string>;
}

/** Draft capture and restore hooks registered by a form adapter so hiding a form preserves unsaved edits in the panel instance. */
export interface PanelFormAdapterDraft<TDraft = PanelFormDraft> {
  identity(): string;
  inputStateKeys(): Iterable<string>;
  capture(): TDraft | null;
  restore(draft: TDraft): void;
  /** Optional cleanup for persisted localStorage draft when a stashed (unmounted) draft is discarded. */
  clearLocalDraft?(): void;
}

/** One dirty form draft retained on the panel instance while its component is hidden/unmounted (for example on another tab). */
export interface StashedFormDraft {
  readonly slot: string;
  readonly identity: string;
  readonly draft: unknown;
  readonly inputStateKeys: readonly string[];
  readonly editingTarget: PanelFormTarget | null;
  readonly clearLocalDraft?: () => void;
}

/** Unified view of one currently dirty form (either mounted or stashed on the panel instance). */
export interface PanelDirtyFormEntry {
  readonly slot: string;
  readonly mounted: boolean;
  readonly inputStateKeys: readonly string[];
  readonly editingTarget: PanelFormTarget | null;
  readonly unsavedSwitchMode: ObjectFormUnsavedSwitchMode;
  stillDirty(): boolean;
  discard(): void;
  settleInFlight?(): Promise<void>;
  saveBeforeSwitch?(): Promise<boolean>;
}

/** One mounted form projection's adapter for live filling, submission, discard, and visibility snapshots. */
export interface PanelFormAdapter {
  readonly handle: PanelFormHandle;
  /**
   * Fills explicit field values into this live form through its own editing entry, marking modified fields and keeping
   * the form unsaved. Refuses with `blocked_unsaved` when the form already has unsaved edits unless `overwriteUnsaved`
   * is true, and `stale` when `expectedTarget` does not match the mounted form target. Never reloads or discards untouched fields.
   */
  fill?(
    values: Readonly<Record<string, RuntimeJsonValue>>,
    options?: FormFillOptions,
  ): Promise<PanelFormAdapterFillResult>;
  /** Saves what the form holds now, through the owner, at the revision it was read at where the owner has one. */
  submit(override?: FormSubmitOverride): Promise<unknown>;
  /**
   * Saves this form when the reader chooses "Save and switch" in a three-state confirmation.
   * Displays owner refusals inline on the form and resolves `true` only when the save succeeded and cleared dirty state.
   */
  saveBeforeSwitch?(): Promise<boolean>;
  /** Waits for any in-flight automatic field save (`submitOn: "blur" | "change"`) to settle before confirming a switch. */
  settleInFlight?(): Promise<void>;
  /** Switch confirmation mode configured on this form component (defaults to `"discard-or-cancel"`). */
  unsavedSwitchMode?(): ObjectFormUnsavedSwitchMode;
  /** Whether an explicit submission (`submit()`) is currently in flight, distinct from automatic field saves. */
  saving?(): boolean;
  /** Whether this form holds unsaved changes of the reader's, as the host must be told. */
  dirty(): boolean;
  /** Drops the reader's unsaved changes and shows the form as its owner holds it. */
  discard(): void;
  /** The target the current draft edits, even while its visibility snapshot is unavailable. */
  editingTarget(): PanelFormTarget | null;
  /** Live snapshot of this form's current target, dirty state and values for page visibility; null while still loading. */
  snapshot?(): Omit<PageFormSnapshot, "member" | "memberPath"> | null;
  readonly draft?: PanelFormAdapterDraft<unknown>;
}

const SCOPED_FORM_SEPARATOR = "\u0000";

/** Base manifest member slot name for a form registration key (strips any per-row/card scope suffix). */
export function baseFormSlot(key: string): string {
  const sep = key.indexOf(SCOPED_FORM_SEPARATOR);
  return sep === -1 ? key : key.slice(0, sep);
}

/** Builds a collision-free form registration key for a row/card-scoped form instance. */
export function scopedFormSlot(slot: string, scopeKey: string): string {
  return `${slot}${SCOPED_FORM_SEPARATOR}${scopeKey}`;
}

/** The form adapters one panel instance's projections registered, by slot, plus any drafts stashed while hidden. */
export class PanelFormAdapters {
  readonly #bySlot = shallowReactive(new Map<string, PanelFormAdapter>());
  readonly #stashed = shallowReactive(new Map<string, StashedFormDraft>());
  readonly #boundState = new Map<string, Set<string>>();

  constructor(
    private readonly memberOrder: readonly string[] = [],
    private readonly isDisposed: () => boolean = () => false,
    private readonly translate?: (key: string) => string,
  ) {}

  #tr(key: string, fallback: string): string {
    if (!this.translate) return fallback;
    const translated = this.translate(key);
    return translated && translated !== key ? translated : fallback;
  }

  /** Declares a state input a panel's own code uses to derive a form binding. */
  bindInputState(slot: string, field: string): void {
    const fields = this.#boundState.get(slot) ?? new Set<string>();
    fields.add(field);
    this.#boundState.set(slot, fields);
  }

  /** State keys explicitly bound to `slot` via `bindInputState`. */
  boundInputStates(slot: string): ReadonlySet<string> {
    return this.#boundState.get(slot) ?? new Set<string>();
  }

  dirtyInputs(): { member: string; fields: string[] }[] {
    return this.dirtyEntries().map((entry) => ({
      member: entry.slot,
      fields: [...entry.inputStateKeys],
    }));
  }

  /** Whether `slot` currently has an unmounted dirty draft retained on this panel instance. */
  hasStashedDraft(slot: string): boolean {
    return this.#matchingStashed(slot).length > 0;
  }

  /** Consumes and returns a stashed draft for `slot` when remounted on the exact same draft identity. */
  takeStashedDraft<TDraft = PanelFormDraft>(slot: string, identity: string): TDraft | undefined {
    const saved = this.#stashed.get(slot);
    if (!saved || saved.identity !== identity) return undefined;
    this.#stashed.delete(slot);
    return saved.draft as TDraft;
  }

  /** All currently dirty forms (mounted and stashed) in manifest declaration order. */
  dirtyEntries(): PanelDirtyFormEntry[] {
    const keysOrdered = this.#orderedSlots(new Set([...this.#bySlot.keys(), ...this.#stashed.keys()]));
    const entries: PanelDirtyFormEntry[] = [];
    for (const key of keysOrdered) {
      const member = baseFormSlot(key);
      const adapter = this.#bySlot.get(key);
      if (adapter && adapter.dirty() && !adapter.saving?.()) {
        const boundKeys = new Set<string>([
          ...(this.#boundState.get(key) ?? []),
          ...(this.#boundState.get(member) ?? []),
          ...(adapter.draft?.inputStateKeys() ?? []),
        ]);
        entries.push({
          slot: member,
          mounted: true,
          inputStateKeys: [...boundKeys],
          editingTarget: adapter.editingTarget(),
          unsavedSwitchMode: adapter.unsavedSwitchMode?.() ?? "discard-or-cancel",
          stillDirty: () => (
            this.#bySlot.get(key) === adapter
              ? (adapter.dirty() && !adapter.saving?.())
              : this.#stashed.has(key)
          ),
          discard: () => {
            if (this.#bySlot.get(key) === adapter) adapter.discard();
            const stashed = this.#stashed.get(key);
            if (stashed) {
              stashed.clearLocalDraft?.();
              this.#stashed.delete(key);
            }
          },
          ...(adapter.settleInFlight ? { settleInFlight: adapter.settleInFlight } : {}),
          saveBeforeSwitch: adapter.saveBeforeSwitch ?? (async () => {
            try {
              const result = await adapter.submit();
              return result !== false && result !== null && !adapter.dirty();
            } catch {
              return false;
            }
          }),
        });
        continue;
      }
      const stashed = this.#stashed.get(key);
      if (stashed) {
        const boundKeys = new Set<string>([
          ...(this.#boundState.get(key) ?? []),
          ...(this.#boundState.get(member) ?? []),
          ...stashed.inputStateKeys,
        ]);
        entries.push({
          slot: member,
          mounted: false,
          inputStateKeys: [...boundKeys],
          editingTarget: stashed.editingTarget,
          unsavedSwitchMode: "discard-or-cancel",
          stillDirty: () => this.#stashed.has(key),
          discard: () => {
            const current = this.#stashed.get(key);
            if (current) {
              current.clearLocalDraft?.();
              this.#stashed.delete(key);
            }
          },
        });
      }
    }
    return entries;
  }

  register(slot: string, adapter: PanelFormAdapter): () => void {
    if (!slot) throw new Error("A form projection registers under the slot whose declaration names it");
    if (this.#bySlot.has(slot)) throw new Error(`Slot '${slot}' already holds a form`);
    this.#bySlot.set(slot, adapter);
    return () => {
      if (this.#bySlot.get(slot) !== adapter) return;
      if (!this.isDisposed() && adapter.dirty() && adapter.draft) {
        const captured = adapter.draft.capture();
        if (captured !== null && captured !== undefined) {
          const member = baseFormSlot(slot);
          const keys = new Set<string>([
            ...(this.#boundState.get(slot) ?? []),
            ...(this.#boundState.get(member) ?? []),
            ...adapter.draft.inputStateKeys(),
          ]);
          this.#stashed.set(slot, {
            slot,
            identity: adapter.draft.identity(),
            draft: captured,
            inputStateKeys: [...keys],
            editingTarget: adapter.editingTarget(),
            ...(adapter.draft.clearLocalDraft ? { clearLocalDraft: adapter.draft.clearLocalDraft } : {}),
          });
        }
      }
      this.#bySlot.delete(slot);
    };
  }

  #orderedSlots(slots: Iterable<string>): string[] {
    const list = [...slots];
    if (!this.memberOrder.length) return list;
    const rank = (slot: string) => {
      const index = this.memberOrder.indexOf(baseFormSlot(slot));
      return index === -1 ? this.memberOrder.length : index;
    };
    return list.sort((a, b) => rank(a) - rank(b));
  }

  #matchingEntries(slot: string): [string, PanelFormAdapter][] {
    const direct = this.#bySlot.get(slot);
    if (direct) return [[slot, direct]];
    if (slot.includes(SCOPED_FORM_SEPARATOR)) return [];
    const matches: [string, PanelFormAdapter][] = [];
    for (const [key, adapter] of this.#bySlot.entries()) {
      if (baseFormSlot(key) === slot) matches.push([key, adapter]);
    }
    return matches;
  }

  #matchingStashed(slot: string): [string, StashedFormDraft][] {
    const direct = this.#stashed.get(slot);
    if (direct) return [[slot, direct]];
    if (slot.includes(SCOPED_FORM_SEPARATOR)) return [];
    const matches: [string, StashedFormDraft][] = [];
    for (const [key, stashed] of this.#stashed.entries()) {
      if (baseFormSlot(key) === slot) matches.push([key, stashed]);
    }
    return matches;
  }

  #resolveSingle(slot: string): PanelFormAdapter | undefined {
    const matches = this.#matchingEntries(slot);
    return matches.length === 1 ? matches[0]![1] : undefined;
  }

  /** The form a slot holds, for the projections that edit one of its fields; undefined until it registers. */
  handle(slot: string): PanelFormHandle | undefined {
    return this.#resolveSingle(slot)?.handle;
  }

  /** Mounted form slot keys in manifest declaration order. */
  mountedSlots(): string[] {
    return this.#orderedSlots(this.#bySlot.keys()).map((key) => baseFormSlot(key));
  }

  /** Fills explicit fields on the mounted form in `slot` through its live editing entry. */
  async fill(
    slot: string,
    values: Readonly<Record<string, RuntimeJsonValue>>,
    options?: FormFillOptions,
  ): Promise<FormFillOutcome> {
    const matches = this.#matchingEntries(slot);
    let adapter: PanelFormAdapter | undefined;
    if (matches.length === 1) {
      adapter = matches[0]![1];
    } else if (matches.length > 1) {
      const filtered = matches.filter(([, candidate]) => {
        const snap = candidate.snapshot?.();
        if (options?.expectedFormInstanceId !== undefined && snap?.formInstanceId !== options.expectedFormInstanceId) {
          return false;
        }
        if (options?.expectedTarget !== undefined) {
          const target = snap?.target;
          if (!target || target.kind !== options.expectedTarget.kind || target.objectType !== options.expectedTarget.objectType) {
            return false;
          }
          if (target.kind === "object" && options.expectedTarget.kind === "object" && target.primaryKey !== options.expectedTarget.primaryKey) {
            return false;
          }
        }
        return true;
      });
      if (filtered.length === 1) {
        adapter = filtered[0]![1];
      } else if (filtered.length === 0) {
        return {
          ok: false,
          reason: "stale",
          member: baseFormSlot(slot),
          message: `Form '${baseFormSlot(slot)}' no longer matches the expected instance or target`,
        };
      } else {
        return {
          ok: false,
          reason: "form_ambiguous",
          member: baseFormSlot(slot),
          message: `Multiple '${baseFormSlot(slot)}' forms are open; specify expectedFormInstanceId or expectedTarget.`,
        };
      }
    }
    if (!adapter) {
      return {
        ok: false,
        reason: options?.expectedFormInstanceId !== undefined ? "stale" : "form_not_found",
        member: baseFormSlot(slot),
        message: `Form '${baseFormSlot(slot)}' is not mounted`,
      };
    }
    if (!adapter.fill) return { ok: false, reason: "form_not_ready", member: baseFormSlot(slot), message: `Form '${baseFormSlot(slot)}' does not support live filling` };
    const result = await adapter.fill(values, options);
    const member = baseFormSlot(slot);
    return result.ok
      ? { ok: true, member, filledFields: result.filledFields, ...(result.write ? { write: result.write } : {}), ...(result.rejectedFields?.length ? { rejectedFields: result.rejectedFields } : {}) }
      : { ok: false, reason: result.reason, member, ...(result.rejectedFields?.length ? { rejectedFields: result.rejectedFields } : {}), ...(result.message ? { message: result.message } : {}) };
  }

  /**
   * Whether registered or stashed forms hold unsaved changes: checks every form when `slots` is omitted, or only the
   * named form slot(s) when provided.
   */
  dirty(slots?: string | readonly string[]): boolean {
    if (slots === undefined) {
      return [...this.#bySlot.values()].some((adapter) => adapter.dirty()) || this.#stashed.size > 0;
    }
    const list = typeof slots === "string" ? [slots] : slots;
    return list.some((slot) => (
      this.#matchingEntries(slot).some(([, adapter]) => adapter.dirty())
      || this.#matchingStashed(slot).length > 0
    ));
  }

  /**
   * Drops unsaved edits on dirty registered and stashed forms (used once leaving unsaved changes has been confirmed).
   * When `slots` is provided, only dirty forms among those slots are discarded so sibling forms on the same panel stay intact.
   */
  discardAll(slots?: readonly string[]): void {
    if (slots === undefined) {
      for (const adapter of this.#bySlot.values()) {
        if (adapter.dirty()) adapter.discard();
      }
      for (const stashed of [...this.#stashed.values()]) {
        stashed.clearLocalDraft?.();
      }
      this.#stashed.clear();
      return;
    }
    const seen = new Set<string>();
    for (const slot of slots) {
      for (const [key, adapter] of this.#matchingEntries(slot)) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (adapter.dirty()) adapter.discard();
      }
      for (const [key, stashed] of this.#matchingStashed(slot)) {
        if (seen.has(`stash:${key}`)) continue;
        seen.add(`stash:${key}`);
        stashed.clearLocalDraft?.();
        this.#stashed.delete(key);
      }
    }
  }

  /** Saves what the form in a slot holds now, optionally dispatching through another member's bound write operation. */
  submit(slot: string, override?: FormSubmitOverride): Promise<unknown> {
    const adapter = this.#resolveSingle(slot);
    if (!adapter) throw new Error(`Slot '${slot}' holds no form`);
    return override === undefined ? adapter.submit() : adapter.submit(override);
  }

  /** Drops unsaved edits in a slot's mounted or stashed form, restoring its owner baseline. */
  discard(slot: string): void {
    this.#resolveSingle(slot)?.discard();
    for (const [key, stashed] of this.#matchingStashed(slot)) {
      stashed.clearLocalDraft?.();
      this.#stashed.delete(key);
    }
  }

  /**
   * Discards dirty forms (mounted or stashed) whose current object target is in `removed`, or whose bound state inputs
   * include any state key in `clearedStateKeys` (for example, a draft whose `fixedFields` parent object was removed).
   * Called before clearing panel state on removal so form target watchers do not prompt or write deleted objects back.
   */
  discardRemoved(
    removed: readonly PanelObjectIdentity[],
    clearedStateKeys?: ReadonlySet<string>,
  ): void {
    const hasRemoved = removed.length > 0;
    const hasClearedStates = Boolean(clearedStateKeys?.size);
    if (!hasRemoved && !hasClearedStates) return;
    const matchesRemoval = (
      target: PanelFormTarget | null,
      slot: string,
      inputKeys: Iterable<string>,
    ): boolean => {
      const targetRemoved =
        hasRemoved
        && target?.kind === "object"
        && removed.some(
          ({ objectType, primaryKey }) =>
            objectType === target.objectType && primaryKey === target.primaryKey,
        );
      if (targetRemoved) return true;
      if (!hasClearedStates) return false;
      const base = baseFormSlot(slot);
      return (
        [...(this.#boundState.get(slot) ?? []), ...(this.#boundState.get(base) ?? [])].some((key) => clearedStateKeys!.has(key))
        || [...inputKeys].some((key) => clearedStateKeys!.has(key))
      );
    };
    for (const [slot, adapter] of [...this.#bySlot.entries()]) {
      if (this.#bySlot.get(slot) !== adapter) continue;
      if (!adapter.dirty() && !adapter.handle?.dirty?.value) continue;
      if (matchesRemoval(adapter.editingTarget(), slot, adapter.draft?.inputStateKeys() ?? [])) {
        adapter.discard();
      }
    }
    for (const [slot, stashed] of [...this.#stashed.entries()]) {
      if (matchesRemoval(stashed.editingTarget, slot, stashed.inputStateKeys)) {
        stashed.clearLocalDraft?.();
        this.#stashed.delete(slot);
      }
    }
  }

  /**
   * Resets a slot's form (mounted or stashed) to its owner baseline, optionally asking the platform's discard
   * confirmation first when `options.confirm` is `true`. Resolves `false` when no form/stash exists or the reader cancels.
   */
  async reset(slot: string, options?: { confirm?: boolean }): Promise<boolean> {
    const adapter = this.#resolveSingle(slot);
    if (adapter) return adapter.handle.reset(options);
    const stashedEntries = this.#matchingStashed(slot);
    if (!stashedEntries.length) return false;
    if (options?.confirm) {
      const confirmed = await confirmDanger(
        this.#tr("platform.formDiscardConfirm", "Discard the changes you have not saved?"),
        this.#tr("platform.discard", "Discard"),
        {
          confirmButtonText: this.#tr("platform.discard", "Discard"),
          cancelButtonText: this.#tr("platform.keepEditing", "Keep editing"),
        },
      );
      if (!confirmed) return false;
    }
    for (const [key] of stashedEntries) {
      const current = this.#stashed.get(key);
      if (current) {
        current.clearLocalDraft?.();
        this.#stashed.delete(key);
      }
    }
    return true;
  }

  /** Returns the current snapshot for a single mounted form slot, or null if not mounted or still loading. */
  snapshot(slot: string): Omit<PageFormSnapshot, "member" | "memberPath"> | null {
    const adapter = this.#resolveSingle(slot);
    if (!adapter) return null;
    if (adapter.snapshot) return adapter.snapshot();
    if (!adapter.handle?.values) return null;
    return {
      dirty: adapter.dirty(),
      ...(adapter.handle.dirtyFields.value.size
        ? { dirtyFields: [...adapter.handle.dirtyFields.value] }
        : {}),
      values: adapter.handle.values.value,
    };
  }

  /** Reactive snapshots of currently mounted forms (in declaration order), including unsaved user edits. */
  snapshots(): PageFormSnapshot[] {
    const result: PageFormSnapshot[] = [];
    for (const slot of this.#orderedSlots(this.#bySlot.keys())) {
      const adapter = this.#bySlot.get(slot)!;
      const snap = adapter.snapshot
        ? adapter.snapshot()
        : adapter.handle?.values
          ? {
              dirty: adapter.dirty(),
              ...(adapter.handle.dirtyFields.value.size
                ? { dirtyFields: [...adapter.handle.dirtyFields.value] }
                : {}),
              values: adapter.handle.values.value,
            }
          : null;
      if (!snap) continue;
      const cleanValues: Record<string, RuntimeJsonValue> = {};
      for (const [k, v] of Object.entries(snap.values)) {
        if (v !== undefined) cleanValues[k] = v;
      }
      result.push({ member: baseFormSlot(slot), ...snap, values: cleanValues });
    }
    return result;
  }
}
