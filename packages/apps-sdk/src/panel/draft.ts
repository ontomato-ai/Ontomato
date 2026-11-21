import { shallowReactive, shallowRef, type Ref } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";
import type { PageDraft, PageDraftObjectRef } from "@ontomato/contracts/page-draft";
import { pageDraftLink, withoutPageDraftQuery, type PageDraftLink } from "@ontomato/contracts/page-draft";

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
export { pageDraftLink, withoutPageDraftQuery, type PageDraftLink };

/** Where a link's draft is read from: the agent host's own page-draft route, as the reader. */
export interface PanelDraftSource {
  readPageDraft(sessionId: string, runId: string, path: string): Promise<PageDraft<Record<string, unknown>>>;
}

/**
 * What one form holds, as the projections that edit one of its fields read and write it (`formField`): the owner's
 * fields, the values, the field errors and changed marks by path, and whether the form is busy. Every one of them is the
 * form's own; a field projection never keeps a copy.
 */
export interface PanelFormHandle {
  readonly fields: Readonly<Ref<readonly PanelFormField[]>>;
  readonly values: Readonly<Ref<PanelFormValues>>;
  readonly errors: Readonly<Ref<Readonly<Record<string, string>>>>;
  readonly changed: Readonly<Ref<ReadonlySet<string>>>;
  readonly busy: Readonly<Ref<boolean>>;
  /** Sets one field's value; a field the owner marks `refreshOnChange` has the owner asked again. */
  set(path: string, value: RuntimeJsonValue): void;
}

/**
 * One form projection's adapter. The owner's form decides everything about a draft: which operation it is
 * (`save.draftOperation` for the draft's target), whether its values are valid, and what they normalise to.
 */
export interface PanelFormAdapter {
  readonly handle: PanelFormHandle;
  /**
   * Offers this form a draft. Resolves null when it is another form's: for an object of another type than the form
   * binds, or one of its type the form does not perform (a create on a form that only edits, another operation). The
   * owner is never asked about an object of another type. Otherwise the form takes it — checked whole by its owner,
   * shown without writing — and resolves the paths it changed, empty when it changes nothing or the owner refuses it
   * (the refusal is then said on the form). Only a failure to ask rejects.
   */
  receive(draft: PageDraft<Record<string, unknown>>): Promise<ReadonlySet<string> | null>;
  /** Saves what the form holds now, through the owner, at the revision it was read at where the owner has one. */
  submit(): Promise<unknown>;
  /** Whether this form holds unsaved changes of the reader's, as the host must be told. */
  dirty(): boolean;
  /** Drops the reader's changes — a received draft included — and shows the form as its owner holds it. */
  discard(): void;
}

/** A draft a form took, with the fields it changed by path and the link it was read at. */
export interface ReceivedPanelDraft<Form extends object> {
  slot: string;
  operation: string;
  /** The object the draft is for: its type, and its id once it names one (an update, or a create its save created). */
  target: PageDraftObjectRef;
  /** The object a create draft's earlier save created; absent for an update draft and an unsaved create. */
  created?: { id: string };
  form: Form;
  changed: ReadonlySet<string>;
  /** The draft artifact the address named: what a save or a discard settles. */
  link: PageDraftLink;
}

/** The object a draft addresses: a create draft saved once addresses the object it created from then on. */
function addressed(draft: PageDraft<Record<string, unknown>>): PageDraftObjectRef {
  const id = draft.target.id ?? draft.created?.id;
  return id === undefined ? { objectType: draft.target.objectType } : { objectType: draft.target.objectType, id };
}

/** A draft no form of a page takes: the type of the object it is for and the operation it asks for, as the reader is told. */
export interface UnclaimedDraft {
  objectType: string;
  operation: string;
}

/** What a held draft is handed to once its form takes it: the draft as that form shows it. */
type DraftTaken = (draft: ReceivedPanelDraft<Record<string, unknown>>) => void;

/** The form adapters one panel instance's projections registered, by slot. */
export class PanelFormAdapters {
  readonly #bySlot = shallowReactive(new Map<string, PanelFormAdapter>());
  /** The draft this panel received and no registered form has taken yet, with the slots it was offered to. */
  readonly #held = shallowRef<{
    draft: PageDraft<Record<string, unknown>>;
    link: PageDraftLink;
    taken: DraftTaken;
    current: () => boolean;
    offered: Set<string>;
    declined: Set<string>;
    offering: boolean;
  } | null>(null);
  /** Bumped when a form declines, so `unclaimed` is read again. */
  readonly #declines = shallowRef(0);

  constructor(private readonly reportDraftError?: (reason: unknown) => void) {}

  register(slot: string, adapter: PanelFormAdapter): () => void {
    if (!slot) throw new Error("A form projection registers under the slot whose declaration names it");
    if (this.#bySlot.has(slot)) throw new Error(`Slot '${slot}' already holds a form`);
    this.#bySlot.set(slot, adapter);
    this.#offerNext();
    return () => this.#bySlot.delete(slot);
  }

  /**
   * Holds a draft and offers it to the registered forms one at a time, in registration order, until one takes it; a
   * form that registers later is offered it then. `taken` hears the draft as the form shows it.
   */
  hold(draft: PageDraft<Record<string, unknown>>, link: PageDraftLink, taken: DraftTaken, current: () => boolean = () => true): void {
    this.#held.value = { draft, link, taken, current, offered: new Set(), declined: new Set(), offering: false };
    this.#offerNext();
  }

  /** What a held draft is for — its object's type and its operation — once every one of these form slots declined it. */
  unclaimed(formSlots: readonly string[]): UnclaimedDraft | null {
    void this.#declines.value;
    const held = this.#held.value;
    return held !== null && formSlots.every((slot) => held.declined.has(slot))
      ? { objectType: held.draft.target.objectType, operation: held.draft.operation } : null;
  }

  #offerNext() {
    const held = this.#held.value;
    if (!held || held.offering) return;
    const next = [...this.#bySlot.keys()].find((slot) => !held.offered.has(slot));
    if (!next) return;
    held.offered.add(next);
    held.offering = true;
    const { draft } = held;
    this.#bySlot.get(next)!.receive(draft).then((changed) => {
      held.offering = false;
      if (!held.current() || this.#held.value !== held) return;
      if (changed === null) {
        held.declined.add(next);
        this.#declines.value += 1;
        this.#offerNext();
        return;
      }
      this.#held.value = null;
      if (changed.size)
        // A create draft saved once addresses the object it created from then on.
        held.taken({ slot: next, operation: draft.operation, target: addressed(draft), created: draft.created, form: draft.form, changed, link: held.link });
    }, (reason: unknown) => {
      held.offering = false;
      if (this.#held.value === held) this.#held.value = null;
      if (held.current()) this.reportDraftError?.(reason);
    });
  }

  /** The form a slot holds, for the projections that edit one of its fields; undefined until it registers. */
  handle(slot: string): PanelFormHandle | undefined {
    return this.#bySlot.get(slot)?.handle;
  }

  /** Whether any registered form holds unsaved changes of the reader's. */
  dirty(): boolean {
    return [...this.#bySlot.values()].some((adapter) => adapter.dirty());
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
  adapters.hold(draft, link, taken, current);
}
