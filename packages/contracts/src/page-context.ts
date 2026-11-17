import { z } from "zod";

/*
 * What a message sent from beside a page carries (overall design 3.4): the page the reader is on and what is selected
 * in it. It is one line at the end of the message, part of the text the agent reads; the send protocol does not change.
 *
 * This is the one public shape: the page beside the conversation, the panel host and the platform's own pages hand over
 * this, so what a message says about "this one" is decided once. An app frame reports less than this — its own name for
 * the page and the object the reader selected — because the registration key and the address belong to the platform
 * that opened it; `pageContextOf` completes that report into this shape.
 *
 * The selection belongs to the reader's moment, so every message names it. Only the page rides: on the conversation's
 * first message, or when the address moved to another one, because repeating the address would spend the agent's context
 * on something that changed once. A draft parameter, a scroll or an enlarged page is the same page.
 */
export const pageSelectionSchema = z
  .object({
    /** What kind of thing was selected (an ontology object, a file, a row) and what the message names it by. */
    kind: z.string().min(1).max(200),
    id: z.string().min(1).max(1000),
    label: z.string().min(1).max(500),
    url: z.string().max(2000).optional(),
  })
  .strict();
export type PageSelection = z.infer<typeof pageSelectionSchema>;

export const pageContextSchema = z
  .object({
    /**
     * The page's registration key, where the page has one: a platform page and a panel are named by their application
     * use. An app frame's page has only the app's own name for it (`label`), because its registration key belongs to the
     * application that opened the frame.
     */
    pageKey: z.string().min(1).max(200).optional(),
    /** Its address, as the page shows it. */
    url: z.string().min(1).max(4000),
    label: z.string().min(1).max(500),
    selection: z.array(pageSelectionSchema).max(100).readonly(),
  })
  .strict();
export type PageContext = z.infer<typeof pageContextSchema>;

/**
 * Completes what an app frame reports into a message's page context. The frame knows its page's name and what is
 * selected; the shell knows the frame's address, and a page's registration key belongs to the application that declared
 * the frame, not to the frame. This is the one place the app's own report is translated.
 */
export function pageContextOf(report: {page: string; selection: {className: string; primaryKey: string; name: string} | null}, url: string): PageContext {
  return {
    url,
    label: report.page,
    selection: report.selection
      ? [{ kind: report.selection.className, id: report.selection.primaryKey, label: report.selection.name }]
      : [],
  };
}

/** The query parameters a draft's handoff adds to an address; they name no page of their own. */
const DRAFT_QUERY_KEYS = ["draftSessionId", "draftRunId", "draftPath"];

/** The address without what does not change which page it is: the draft handoff, the fragment and a trailing slash. */
export function samePageAddress(url: string): string {
  const parsed = new URL(url.replace(/^#/, ""), "http://page.invalid");
  for (const key of DRAFT_QUERY_KEYS) parsed.searchParams.delete(key);
  return (parsed.pathname + parsed.search).replace(/\/+$/, "") || "/";
}

/** Whether a message carries the page: the conversation has none yet, or the page it was sent from moved elsewhere. */
export function pageMoved(lastSent: string | null, page: PageContext): boolean {
  return lastSent === null || lastSent !== samePageAddress(page.url);
}

/** The one line a message ends with: the page (when it rides) and what was selected in it (always). */
export function pageContextLine(
  page: PageContext,
  lines: { page: (label: string) => string; selection: (label: string) => string },
  carriesPage: boolean,
): string {
  const parts = [
    ...(carriesPage ? [lines.page(page.label)] : []),
    ...page.selection.map((item) => lines.selection(item.label)),
  ];
  return parts.join("；");
}
