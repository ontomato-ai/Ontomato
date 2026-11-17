/**
 * What a message sent from beside a page carries (DESIGN.md "Applications and shells"): the page itself and the objects,
 * files or rows selected in it. It is one line at the end of the message, part of the text the agent reads; the send
 * protocol does not change.
 *
 * The selection belongs to the page's reader moment by moment, so every message names it. The page only rides on the
 * conversation's first message or when the address moved to another one: repeating the address on every message would
 * spend the agent's context on something that changed once. A draft parameter, a scroll or an enlarged page is the same
 * page.
 */
export interface PageSelection {
  /** What kind of thing was selected (an object, a file, a row). */
  kind: string;
  id: string;
  label: string;
  url?: string;
}

export interface PageContext {
  /** The page's registration key. */
  pageKey: string;
  /** Its address, as the page shows it. */
  url: string;
  label: string;
  selection: readonly PageSelection[];
}

/** The address without what does not change which page it is: the draft handoff, the fragment and a trailing slash. */
export function samePageAddress(url: string): string {
  const parsed = new URL(url.replace(/^#/, ""), "http://page.invalid");
  for (const key of ["draftSessionId", "draftRunId", "draftPath"]) parsed.searchParams.delete(key);
  return (parsed.pathname + parsed.search).replace(/\/+$/, "") || "/";
}

/** Whether a message carries the page: the conversation has none yet, or the page it was sent from moved elsewhere. */
export function pageMoved(lastSent: string | null, page: PageContext): boolean {
  return lastSent === null || lastSent !== samePageAddress(page.url);
}

/** The one line a message ends with: the page (when it rides) and what was selected in it (always). */
export function pageContextLine(page: PageContext, lines: { page: (label: string) => string; selection: (label: string) => string }, carriesPage: boolean): string {
  const parts = [
    ...(carriesPage ? [lines.page(page.label)] : []),
    ...page.selection.map((item) => lines.selection(item.label)),
  ];
  return parts.join("；");
}
