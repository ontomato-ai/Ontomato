import { z } from "zod";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeKeySchema, runtimeRelativePathSchema } from "./agent-runtime-values";

/*
 * A page draft: what an agent wrote for one page to fill in and the reader to save. The envelope is the same
 * everywhere; `form` is the page's own save request, so only the page checks its structure.
 */
export const pageDraftTargetSchema = z
  .object({ id: runtimeIdSchema.optional() })
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
  /** The object changed; a create leaves the id out. */
  target: { id?: string };
  form: Form;
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
