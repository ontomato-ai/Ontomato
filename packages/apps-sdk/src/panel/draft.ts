import { shallowRef } from "vue";
import type { PageDraft } from "@ontomato/contracts/page-draft";
import { changedFields, pageDraftLink, withoutPageDraftQuery, type PageDraftLink } from "@ontomato/contracts/page-draft";

/*
 * A draft a panel receives (overall design 3.4, "receive drafts"): the envelope stays `@ontomato/contracts/page-draft`'s
 * — pageKey, operation, target and form — and the three query parameters an address carries are the ones a native page
 * already uses. The SDK reads the draft a panel's address names and hands it to the form component whose projection
 * performs its operation, which the component registered itself; the owner keeps its own read, save and discard, and no
 * panel writes a draft bridge.
 *
 * The draft is read as the panel starts, and the form that takes it registers only once its projection has read its own
 * record and drawn it, so the SDK holds the draft until then. The registration is the moment it is handed over: nothing
 * waits on a timer or asks again.
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

/** What a held draft is handed to once its form takes it: the draft as that form shows it. */
type DraftTaken = (draft: ReceivedPanelDraft<Record<string, unknown>>) => void;

/** The form adapters one panel instance's projections registered, by slot. */
export class PanelFormAdapters {
  readonly #bySlot = new Map<string, PanelFormAdapter<object, { id?: string }>>();
  /** The draft this panel received and no registered form has taken yet. */
  readonly #held = shallowRef<{ draft: PageDraft<Record<string, unknown>>; taken: DraftTaken } | null>(null);

  register<Form extends object>(slot: string, adapter: PanelFormAdapter<Form, { id?: string }>): () => void {
    if (!slot) throw new Error("A form projection registers under the slot whose declaration names it");
    if (this.#bySlot.has(slot)) throw new Error(`Slot '${slot}' already holds a form`);
    this.#bySlot.set(slot, adapter as unknown as PanelFormAdapter<object, { id?: string }>);
    this.#handOver();
    return () => this.#bySlot.delete(slot);
  }

  /**
   * Holds a draft for the form that performs its operation, and hands it over when that form registers — at once, if it
   * already has. `taken` hears the draft as the form shows it: its values and the fields it changed from the owner's own
   * reading.
   */
  hold(draft: PageDraft<Record<string, unknown>>, taken: DraftTaken): void {
    this.#held.value = { draft, taken };
    this.#handOver();
  }

  /** The operation of the draft held for a form that has not registered yet, or null when none is held. */
  heldOperation(): string | null {
    return this.#held.value?.draft.operation ?? null;
  }

  #handOver() {
    const held = this.#held.value;
    const slot = held && this.slotOf(held.draft.operation);
    if (!held || !slot) return;
    this.#held.value = null;
    const adapter = this.#bySlot.get(slot)!;
    const { operation, target, form } = held.draft;
    void adapter.read(target).then((base) => {
      const draft = { slot, operation, target, form, changed: changedFields(base, form) };
      adapter.apply(draft);
      held.taken(draft);
    });
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
}

/**
 * Reads the draft a panel's address names and, if it was written for this panel's page, holds it for the form projection
 * that performs its operation, which takes it when it registers. `taken` hears the draft as that form shows it.
 */
export async function receivePanelDraft(
  pageKey: string,
  adapters: PanelFormAdapters,
  source: PanelDraftSource,
  link: PageDraftLink,
  taken: DraftTaken,
  current: () => boolean = () => true,
): Promise<void> {
  const draft = await source.readPageDraft(link.sessionId, link.runId, link.path);
  if (!current()) return;
  if (draft.pageKey !== pageKey) throw new Error(`Draft belongs to page ${draft.pageKey}, not ${pageKey}`);
  adapters.hold(draft, taken);
}
