import { shallowReactive, type Ref } from "vue";
import type { FormFieldRejection, FormFillOutcome } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PageFormSnapshot } from "@ontomato/contracts/page-context";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { PanelFormField, PanelFormValues, ProjectionOperationBinding } from "@ontomato/contracts/panel-projection";

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
  readonly extraInput?: Readonly<Record<string, unknown>>;
}

/** Outcome of filling explicit fields on a single mounted form adapter. */
export type PanelFormAdapterFillResult =
  | {
      readonly ok: true;
      readonly filledFields: readonly string[];
      readonly rejectedFields?: readonly FormFieldRejection[];
    }
  | {
      readonly ok: false;
      readonly reason: "form_not_ready" | "blocked_unsaved" | "all_fields_rejected";
      readonly rejectedFields?: readonly FormFieldRejection[];
      readonly message?: string;
    };

/** One mounted form projection's adapter for live filling, submission, discard, and visibility snapshots. */
export interface PanelFormAdapter {
  readonly handle: PanelFormHandle;
  /**
   * Fills explicit field values into this live form through its own editing entry, marking modified fields and keeping
   * the form unsaved. Refuses with `blocked_unsaved` when the form already has unsaved edits unless `overwriteUnsaved`
   * is true. Never reloads or discards untouched fields.
   */
  fill?(
    values: Readonly<Record<string, RuntimeJsonValue>>,
    options?: { overwriteUnsaved?: boolean },
  ): Promise<PanelFormAdapterFillResult>;
  /** Saves what the form holds now, through the owner, at the revision it was read at where the owner has one. */
  submit(override?: FormSubmitOverride): Promise<unknown>;
  /** Whether this form holds unsaved changes of the reader's, as the host must be told. */
  dirty(): boolean;
  /** Drops the reader's unsaved changes and shows the form as its owner holds it. */
  discard(): void;
  /** Live snapshot of this form's current target, dirty state and values for page visibility; null while still loading. */
  snapshot?(): Omit<PageFormSnapshot, "member" | "memberPath"> | null;
}

/** The form adapters one panel instance's projections registered, by slot. */
export class PanelFormAdapters {
  readonly #bySlot = shallowReactive(new Map<string, PanelFormAdapter>());

  constructor(private readonly memberOrder: readonly string[] = []) {}

  register(slot: string, adapter: PanelFormAdapter): () => void {
    if (!slot) throw new Error("A form projection registers under the slot whose declaration names it");
    if (this.#bySlot.has(slot)) throw new Error(`Slot '${slot}' already holds a form`);
    this.#bySlot.set(slot, adapter);
    return () => this.#bySlot.delete(slot);
  }

  #orderedSlots(slots: Iterable<string>): string[] {
    const list = [...slots];
    if (!this.memberOrder.length) return list;
    const rank = (slot: string) => {
      const index = this.memberOrder.indexOf(slot);
      return index === -1 ? this.memberOrder.length : index;
    };
    return list.sort((a, b) => rank(a) - rank(b));
  }

  /** The form a slot holds, for the projections that edit one of its fields; undefined until it registers. */
  handle(slot: string): PanelFormHandle | undefined {
    return this.#bySlot.get(slot)?.handle;
  }

  /** Mounted form slot keys in manifest declaration order. */
  mountedSlots(): string[] {
    return this.#orderedSlots(this.#bySlot.keys());
  }

  /** Fills explicit fields on the mounted form in `slot` through its live editing entry. */
  async fill(
    slot: string,
    values: Readonly<Record<string, RuntimeJsonValue>>,
    options?: { overwriteUnsaved?: boolean },
  ): Promise<FormFillOutcome> {
    const adapter = this.#bySlot.get(slot);
    if (!adapter) return { ok: false, reason: "form_not_found", member: slot, message: `Form '${slot}' is not mounted` };
    if (!adapter.fill) return { ok: false, reason: "form_not_ready", member: slot, message: `Form '${slot}' does not support live filling` };
    const result = await adapter.fill(values, options);
    return result.ok
      ? { ok: true, member: slot, filledFields: result.filledFields, ...(result.rejectedFields?.length ? { rejectedFields: result.rejectedFields } : {}) }
      : { ok: false, reason: result.reason, member: slot, ...(result.rejectedFields?.length ? { rejectedFields: result.rejectedFields } : {}), ...(result.message ? { message: result.message } : {}) };
  }

  /**
   * Whether registered forms hold unsaved changes: checks every registered form when `slots` is omitted, or only the
   * named form slot(s) when provided.
   */
  dirty(slots?: string | readonly string[]): boolean {
    if (slots === undefined) return [...this.#bySlot.values()].some((adapter) => adapter.dirty());
    const list = typeof slots === "string" ? [slots] : slots;
    return list.some((slot) => Boolean(this.#bySlot.get(slot)?.dirty()));
  }

  /**
   * Drops unsaved edits on dirty registered forms (used once leaving unsaved changes has been confirmed). When `slots`
   * is provided, only dirty forms among those slots are discarded so sibling forms on the same panel stay intact.
   */
  discardAll(slots?: readonly string[]): void {
    if (slots === undefined) {
      for (const adapter of this.#bySlot.values()) {
        if (adapter.dirty()) adapter.discard();
      }
      return;
    }
    const seen = new Set<string>();
    for (const slot of slots) {
      if (seen.has(slot)) continue;
      seen.add(slot);
      const adapter = this.#bySlot.get(slot);
      if (adapter?.dirty()) adapter.discard();
    }
  }

  /** Saves what the form in a slot holds now, optionally dispatching through another member's bound write operation. */
  submit(slot: string, override?: FormSubmitOverride): Promise<unknown> {
    const adapter = this.#bySlot.get(slot);
    if (!adapter) throw new Error(`Slot '${slot}' holds no form`);
    return override === undefined ? adapter.submit() : adapter.submit(override);
  }

  /** Drops unsaved edits in a slot's form, restoring its owner baseline. */
  discard(slot: string): void {
    this.#bySlot.get(slot)?.discard();
  }

  /**
   * Resets a slot's form to its owner baseline, optionally asking the platform's discard confirmation first when
   * `options.confirm` is `true`. Resolves `false` when the slot has no mounted form or the reader cancels.
   */
  reset(slot: string, options?: { confirm?: boolean }): Promise<boolean> {
    const adapter = this.#bySlot.get(slot);
    if (!adapter) return Promise.resolve(false);
    return adapter.handle.reset(options);
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
      result.push({ member: slot, ...snap, values: cleanValues });
    }
    return result;
  }
}
