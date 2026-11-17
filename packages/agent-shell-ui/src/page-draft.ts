import type { PageDraft } from "@ontomato/contracts/page-draft";
import type { AgentHostClient } from "./host";

/**
 * A page opening with a draft: the address names the run artifact the agent wrote (`draftSessionId`, `draftRunId`,
 * `draftPath`) and the page fills its own form with it.
 *
 * Nothing is saved here. The page reads the real object (or a new one's defaults), applies the draft over it, marks the
 * fields the draft changed and stays unsaved until the reader saves; saving is the page's own write, and dropping the
 * draft only empties the form.
 */
export interface PageDraftLink {
  sessionId: string;
  runId: string;
  path: string;
}

/** The query keys a page link carries; the form itself is never in the address. */
export const PAGE_DRAFT_QUERY_KEYS = ["draftSessionId", "draftRunId", "draftPath"] as const;

/** The run a page link names, or null for an address that opens the page without a draft. */
export function pageDraftLink(query: Record<string, unknown>): PageDraftLink | null {
  const [sessionId, runId, path] = PAGE_DRAFT_QUERY_KEYS.map((key) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  });
  if (typeof sessionId !== "string" || typeof runId !== "string" || typeof path !== "string") return null;
  return { sessionId, runId, path };
}

/** Removes the draft's parameters from an address, keeping everything else it names. */
export function withoutPageDraftQuery(query: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query).filter(([key]) => !(PAGE_DRAFT_QUERY_KEYS as readonly string[]).includes(key)));
}

/** The draft a page receives: the form action it fills, the object it addresses, and the form. */
export interface ReceivedPageDraft<Form, Operation extends string> {
  operation: Operation;
  target: PageDraft<Form>["target"];
  form: Form;
}

/**
 * Reads the draft a page link names and checks the parts the page declares: its own page key, so a draft written for
 * another page is never filled here, and the form actions it knows. What the form's fields must hold is the page's own
 * check, against the object it read.
 */
export async function readPageDraft<Form, Operation extends string>(
  client: Pick<AgentHostClient, "readPageDraft">,
  link: PageDraftLink,
  page: { pageKey: string; operations: readonly Operation[] },
): Promise<ReceivedPageDraft<Form, Operation>> {
  const draft = await client.readPageDraft(link.sessionId, link.runId, link.path);
  if (draft.pageKey !== page.pageKey) throw new Error(`Draft belongs to page ${draft.pageKey}, not ${page.pageKey}`);
  const operation = page.operations.find((candidate) => candidate === draft.operation);
  if (!operation) throw new Error(`Draft action ${draft.operation} is not a form of page ${page.pageKey}`);
  return { operation, target: draft.target, form: draft.form as Form };
}

/**
 * The form's fields the draft changes: those whose filled value differs from the object as it was read. A field the
 * draft leaves as the object holds it is not marked.
 */
export function changedFields<Form extends object>(base: Form, filled: Form): ReadonlySet<string> {
  return new Set(
    (Object.keys(filled) as (keyof Form)[])
      .filter((key) => JSON.stringify(base[key]) !== JSON.stringify(filled[key]))
      .map(String),
  );
}
