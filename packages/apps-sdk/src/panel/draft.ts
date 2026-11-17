import type { PageDraft } from "@ontomato/contracts/page-draft";
import { changedFields, readPageDraft, type PageDraftLink } from "@ontomato/agent-shell-ui";

/*
 * A draft a panel receives (overall design 3.4, "receive drafts"): the envelope stays `@ontomato/contracts/page-draft`'s
 * — pageKey, operation, target and form — and the three query parameters an address carries are the ones a native page
 * already uses. What the SDK adds is the dispatch: it finds the slot whose form adapter performs the draft's operation,
 * asks that adapter's owner for the object as it is now, and compares. The owner keeps its own read and save; no panel
 * writes a draft bridge, and no second draft protocol exists.
 */

/** Where a link's draft is read from: the agent host's own page-draft route. */
export interface PanelDraftSource {
  readPageDraft(sessionId: string, runId: string, path: string): Promise<PageDraft<Record<string, unknown>>>;
}

/**
 * One form slot's adapter. `read` is the owner's own read of the object the draft addresses, or of a new object's
 * defaults; `save` is the owner's own write, which the panel's save operation reaches too, so a person's save and an
 * agent's save are one implementation.
 */
export interface PanelFormAdapter<Form extends object, Target extends { id?: string }> {
  /** The form action the slot performs, such as `schedules.update`; the draft names it. */
  operation: string;
  /** Reads the addressed object as its owner holds it now: the baseline the draft is compared with. */
  read(target: Target): Promise<Form>;
  /** Writes the filled form through the owner's own interface. */
  save(form: Form, target: Target): Promise<unknown>;
}

/** A draft handed to the slot whose operation it names, with the fields it changed. */
export interface ReceivedPanelDraft<Form extends object> {
  slot: string;
  operation: string;
  target: { id?: string };
  /** What the form holds after the draft: the owner's own values, with the draft applied. */
  form: Form;
  /** The fields the draft changed, from the owner's reading to the filled form. */
  changed: ReadonlySet<string>;
}

/** The form adapters one panel instance registered, by operation. */
export class PanelFormAdapters {
  readonly #byOperation = new Map<string, PanelFormAdapter<object, { id?: string }>>();
  readonly #slots = new Map<string, string>();

  register<Form extends object>(slot: string, adapter: PanelFormAdapter<Form, { id?: string }>): void {
    if (this.#byOperation.has(adapter.operation)) throw new Error(`A form slot already performs '${adapter.operation}'`);
    this.#byOperation.set(adapter.operation, {
      operation: adapter.operation,
      read: (target) => adapter.read(target),
      save: (form: object, target) => adapter.save(form as Form, target),
    });
    this.#slots.set(adapter.operation, slot);
  }

  /** The operations the panel's form slots perform: what a draft of this panel may name. */
  operations(): string[] {
    return [...this.#byOperation.keys()];
  }

  adapter(operation: string): PanelFormAdapter<object, { id?: string }> {
    const found = this.#byOperation.get(operation);
    if (!found) throw new Error(`No form slot performs '${operation}'`);
    return found;
  }

  slot(operation: string): string {
    const found = this.#slots.get(operation);
    if (!found) throw new Error(`No form slot performs '${operation}'`);
    return found;
  }
}

/**
 * Reads the draft a link names and dispatches it to the form adapter that performs its operation, if the draft is this
 * panel's. An unsaved form is never replaced without the reader's word: `confirm` answers that, and the panel passes
 * the confirmation it already has for leaving with unsaved changes.
 */
export async function receivePanelDraft<Form extends object>(
  pageKey: string,
  adapters: PanelFormAdapters,
  source: PanelDraftSource,
  link: PageDraftLink,
  confirm: () => Promise<boolean>,
): Promise<ReceivedPanelDraft<Form> | null> {
  const draft = await readPageDraft<Form, string>(source, link, { pageKey, operations: adapters.operations() });
  const owner = adapters.adapter(draft.operation);
  if (!(await confirm())) return null;
  const base = await owner.read(draft.target);
  const form = draft.form;
  return {
    slot: adapters.slot(draft.operation),
    operation: draft.operation,
    target: draft.target,
    form,
    changed: changedFields(base, form),
  };
}
