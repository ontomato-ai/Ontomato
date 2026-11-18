import { pageLineAddress, samePageAddress, type PageLinePrompts } from "@ontomato/contracts/page-context";

/**
 * What a message sent from beside a page carries (overall design 3.4): the page itself — its name and its address — and
 * the objects, files or rows selected in it. It is one line at the end of the message, part of the text the agent reads;
 * the send protocol does not change.
 *
 * The shape is the contracts' one, shared with the panel host and the platform's own pages, so a page beside the
 * conversation and a panel opened beside it say what the reader looks at the same way. The shell knows which page it
 * opened, so the page rides on every message written beside it; the selection is the page's own report. A draft
 * parameter, a scroll or an enlarged page is the same page.
 *
 * `pageContextLine` writes the line and `pageLineAddress` reads it back: the shell recognises in a reopened
 * conversation's history the page its messages named without knowing the language's brackets itself.
 */
export {
  pageContextOf,
  pageContextLine,
  pageLineAddress,
  pageMoved,
  pageSelectionSchema,
  pageContextSchema,
  samePageAddress,
  type PageContext,
  type PageLinePrompts,
  type PageSelection,
} from "@ontomato/contracts/page-context";


/** What a conversation told its agent last: no page yet (`null`), that the page was closed (`""`), or a page's address. */
export type CarriedPage = string | null;
export const CLOSED_PAGE = "";

/**
 * The page a reopened conversation already carries, read from its messages' last lines: the address of the last page they
 * named, or `""` when the last such line said the page was closed. A conversation whose messages say neither carries none.
 */
export function carriedPageIn(texts: readonly string[], prompts: PageLinePrompts, closed: string): CarriedPage {
  for (const text of [...texts].reverse()) {
    if (text.endsWith(`\n\n${closed}`)) return CLOSED_PAGE;
    const address = pageLineAddress(text, prompts);
    if (address !== null) return samePageAddress(address);
  }
  return null;
}
