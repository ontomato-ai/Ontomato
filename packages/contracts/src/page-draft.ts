import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeKeySchema, runtimeRelativePathSchema } from "./agent-runtime-values";

/*
 * A page draft: what an agent wrote for one page to fill in and the reader to save. The envelope is the same
 * everywhere; `form` is the page's own save request, so only the page checks its structure.
 */
/** The target id is opaque here; the page and the object's owner check its format (an agent id is a UUID, a knowledge id is not). */
export const pageDraftTargetSchema = z
  .object({ id: z.string().min(1).max(200).optional() })
  .strict();

export const pageDraftSchema = z
  .object({
    pageKey: runtimeKeySchema,
    operation: runtimeKeySchema,
    target: pageDraftTargetSchema,
    form: runtimeJsonObjectSchema,
  })
  .strict();

/** The draft a page receives: its page key, the form action it fills, the object it addresses, and the form. */
export interface PageDraft<Form> {
  pageKey: string;
  /** The page's own form action, e.g. `agent.create` or `agent.update`. */
  operation: string;
  /** The object changed, by its owner's opaque id; a create leaves the id out. */
  target: { id?: string };
  form: Form;
}

/**
 * A page opening with a draft: the address names the run artifact the agent wrote (`draftSessionId`, `draftRunId`,
 * `draftPath`) and the page fills its own form with it.
 *
 * These seven things — the link's keys, reading it out of an address, taking it back out, the envelope a read returns,
 * reading one, and comparing a draft with the object it was written over — are the platform's wording, not one page's:
 * the panel SDK and the Manager's own pages both receive drafts this way, and neither should have to depend on the other
 * to say so. Nothing is saved here: the page reads the real object, applies the draft over it, marks the fields the draft
 * changed, and stays unsaved until the reader saves. A draft is a change to the real object, so one that changes nothing
 * — a link opened again after its draft was saved — is no draft: the page opens as the object is, with no draft note,
 * nothing marked and nothing unsaved.
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
  return Object.fromEntries(
    Object.entries(query).filter(([key]) => !(PAGE_DRAFT_QUERY_KEYS as readonly string[]).includes(key)),
  );
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
  client: { readPageDraft(sessionId: string, runId: string, path: string): Promise<PageDraft<Record<string, unknown>>> },
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
 * draft leaves as the object holds it is not marked, and an empty set is a draft that changes nothing, which the page
 * opens as the object is.
 */
export function changedFields<Form extends object>(base: Form, filled: Form): ReadonlySet<string> {
  return new Set(
    (Object.keys(filled) as (keyof Form)[])
      .filter((key) => JSON.stringify(base[key]) !== JSON.stringify(filled[key]))
      .map(String),
  );
}

/** A run writes its drafts to `outputs/drafts/<name>.page-draft.json`; the draft read serves those files alone. */
export const pageDraftPathSchema = runtimeRelativePathSchema.refine((path) => {
  const [outputs, drafts, file, ...rest] = path.split("/");
  return (
    outputs === "outputs" &&
    drafts === "drafts" &&
    rest.length === 0 &&
    file!.endsWith(".page-draft.json") &&
    file !== ".page-draft.json"
  );
}, "Expected a draft file at outputs/drafts/<name>.page-draft.json");
