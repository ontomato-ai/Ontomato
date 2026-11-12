import { inject, onBeforeUnmount, provide, type InjectionKey } from "vue";

/**
 * Leaving a draft with unsaved changes asks first (DESIGN.md "Page architecture"). Each page keeps its own draft; what
 * it registers here is only whether the draft is dirty and which addresses still edit it, so moving between them (the
 * model usage and the providers, which edit one document) never asks. The frame owns the one question: it asks before
 * the address leaves every scope of a dirty draft, and before the document is closed or reloaded.
 */
export interface UnsavedChanges {
  /** Whether the draft holds changes not yet saved. */
  dirty(): boolean;
  /** The addresses that edit this draft; going to any other one leaves it. */
  paths(): readonly string[];
}

/**
 * The question as an application asks it before it changes what it shows on its own, ahead of the address (a
 * conversation application switching the page beside its column): the page with the draft stays until the reader
 * confirms, and the navigation that follows a confirmation is not asked again.
 */
export interface LeaveConfirmation {
  /** Whether going to `path` leaves a dirty draft. */
  leaves(path: string): boolean;
  /** Asks the reader; true lets the next navigation through without asking again. */
  confirm(): Promise<boolean>;
}

export interface UnsavedChangesCheck {
  /** Whether a navigation to `path` may go: asked when it leaves a dirty draft, unless the leave was just confirmed. */
  allows(path: string): Promise<boolean>;
  /** Whether any draft is dirty (closing or reloading the document). */
  dirty(): boolean;
}

interface UnsavedChangesRegistry extends LeaveConfirmation {
  add(entry: UnsavedChanges): () => void;
}

const unsavedChangesKey: InjectionKey<UnsavedChangesRegistry> = Symbol("platform-unsaved-changes");

/**
 * Called by the frame that asks: the drafts under it register here, and `ask` is its one question to the reader. The
 * frame checks every navigation with `allows`.
 */
export function provideUnsavedChanges(ask: () => Promise<boolean>): UnsavedChangesCheck {
  const entries = new Set<UnsavedChanges>();
  /** The reader has just confirmed leaving: the navigation that follows goes without a second question. */
  let confirmed = false;
  const dirty = () => [...entries].filter((entry) => entry.dirty());
  const leaves = (path: string) => dirty().some((entry) => !entry.paths().includes(path));
  provide(unsavedChangesKey, {
    add(entry) {
      entries.add(entry);
      return () => entries.delete(entry);
    },
    leaves,
    async confirm() {
      confirmed = await ask();
      return confirmed;
    },
  });
  return {
    async allows(path) {
      if (confirmed) {
        confirmed = false;
        return true;
      }
      return !leaves(path) || ask();
    },
    dirty: () => dirty().length > 0,
  };
}

/** Registers a page's draft for the frame's question while the calling component is mounted. */
export function useUnsavedChanges(entry: UnsavedChanges) {
  const registry = inject(unsavedChangesKey, null);
  if (!registry) return;
  const remove = registry.add(entry);
  onBeforeUnmount(remove);
}

/** The frame's question for an application that changes what it shows ahead of the address; outside a frame, none. */
export function useLeaveConfirmation(): LeaveConfirmation {
  return inject(unsavedChangesKey, null) ?? { leaves: () => false, confirm: async () => true };
}
