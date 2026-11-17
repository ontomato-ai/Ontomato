import type { PageDraft } from "@ontomato/contracts/page-draft";
import { changedFields, pageDraftLink, readPageDraft, withoutPageDraftQuery, type PageDraftLink } from "@ontomato/agent-shell-ui";

/*
 * A draft a panel receives (overall design 3.4, "receive drafts"): the envelope stays `@ontomato/contracts/page-draft`'s
 * — pageKey, operation, target and form — and the three query parameters an address carries are the ones a native page
 * already uses. The SDK reads the draft a panel's address names and hands it to the form component whose projection
 * performs its operation, which the component registered itself; the owner keeps its own read, save and discard, and no
 * panel writes a draft bridge.
 */
export { changedFields, pageDraftLink, withoutPageDraftQuery, type PageDraftLink };

/** Where a link's draft is read from: the agent host's own page-draft route, as the reader. */
export interface PanelDraftSource {
  readPageDraft(sessionId: string, runId: string, path: string): Promise<PageDraft<Record<string, unknown>>>;
}

/**
 * One form projection's adapter. `read` is the owner's own read of the object the draft addresses, or of a new object's
 * defaults; `save` is the owner's own write, which the projection's save operation reaches too, so a person's save and
 * an agent's save are one implementation.
 */
export interface PanelFormAdapter<Form extends object, Target extends { id?: string }> {
  /** The form action the projection performs, such as `schedules.update`; the draft names it. */
  operation: string;
  /** Reads the addressed object as its owner holds it now: the baseline the draft is compared with. */
  read(target: Target): Promise<Form>;
  /** Writes the filled form through the owner's own interface. */
  save(form: Form, target: Target): Promise<unknown>;
  /**
   * Saves what the form holds now — its values and the revision it was read at. This is the frame's own save, which a
   * person's header button and a panel's save operation both reach; an agent's call is the projection's registered
   * operation, made by the platform with the revision it was given.
   */
  submit(): Promise<unknown>;
  /**
   * Shows a draft that names this form: its values in the form, the fields it changed marked, and nothing written until
   * the reader saves. The object the draft addresses becomes the selected one, so the panel shows what is being edited.
   */
  apply(draft: ReceivedPanelDraft<Form>): void;
  /** Whether this form holds unsaved changes of the reader's, as the host must be told. */
  dirty?(): boolean;
  /** Drops the reader's changes — a received draft included — and shows the object as its owner holds it. */
  discard?(): void;
}

/** A draft handed to the form projection whose operation it names, with the fields it changed. */
export interface ReceivedPanelDraft<Form extends object> {
  slot: string;
  operation: string;
  target: { id?: string };
  /** What the form holds after the draft: the owner's own values, with the draft applied. */
  form: Form;
  /** The fields the draft changed, from the owner's reading to the filled form. */
  changed: ReadonlySet<string>;
}

/** The form adapters one panel instance's projections registered, by slot. */
export class PanelFormAdapters {
  readonly #bySlot = new Map<string, PanelFormAdapter<object, { id?: string }>>();

  register<Form extends object>(slot: string, adapter: PanelFormAdapter<Form, { id?: string }>): () => void {
    if (!slot) throw new Error("A form projection registers under the slot whose declaration names it");
    if (this.#bySlot.has(slot)) throw new Error(`Slot '${slot}' already holds a form`);
    this.#bySlot.set(slot, adapter as unknown as PanelFormAdapter<object, { id?: string }>);
    return () => this.#bySlot.delete(slot);
  }

  /** The operations the panel's form projections perform: what a draft of this panel may name. */
  operations(): string[] {
    return [...this.#bySlot.values()].map((adapter) => adapter.operation);
  }

  /** The slot whose projection performs an operation. */
  slotOf(operation: string): string | undefined {
    return [...this.#bySlot].find(([, adapter]) => adapter.operation === operation)?.[0];
  }

  adapter(operation: string): PanelFormAdapter<object, { id?: string }> {
    const found = this.slotOf(operation);
    if (!found) throw new Error(`No form projection performs '${operation}'`);
    return this.#bySlot.get(found)!;
  }

  /** Whether any registered form holds unsaved changes of the reader's. */
  dirty(): boolean {
    return [...this.#bySlot.values()].some((adapter) => adapter.dirty?.() === true);
  }

  /** Saves what the form in a slot holds now. */
  submit(slot: string): Promise<unknown> {
    const adapter = this.#bySlot.get(slot);
    if (!adapter) throw new Error(`Slot '${slot}' holds no form`);
    return adapter.submit();
  }

  /** Hands a draft to the form that takes its operation. */
  apply(draft: ReceivedPanelDraft<Record<string, unknown>>): void {
    const slot = this.slotOf(draft.operation);
    if (!slot) throw new Error(`No form projection performs '${draft.operation}'`);
    this.#bySlot.get(slot)!.apply(draft);
  }
}

/**
 * Reads the draft a panel's address names and dispatches it to the form projection that performs its operation, if the
 * draft is this panel's. An unsaved form is never replaced without the reader's word: `dirty` answers that, and the
 * panel's own confirmation is asked before the draft replaces it.
 */
export async function receivePanelDraft<Form extends object>(
  pageKey: string,
  adapters: PanelFormAdapters,
  source: PanelDraftSource,
  link: PageDraftLink,
): Promise<ReceivedPanelDraft<Form> | null> {
  const draft = await readPageDraft<Form, string>(source, link, { pageKey, operations: adapters.operations() });
  const owner = adapters.adapter(draft.operation);
  const base = await owner.read(draft.target);
  const form = draft.form;
  return {
    slot: adapters.slotOf(draft.operation)!,
    operation: draft.operation,
    target: draft.target,
    form,
    changed: changedFields(base, form),
  };
}
