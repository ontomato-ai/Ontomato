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
  CLOSED_TARGET,
  carriedTargetIn,
  fileContextLine,
  fileLinePath,
  pageContextOf,
  pageContextLine,
  pageLineAddress,
  pageMoved,
  pageSelectionSchema,
  pageContextSchema,
  samePageAddress,
  writtenText,
  type CarriedTarget,
  type FileContext,
  type FileLinePrompt,
  type PageContext,
  type PageLinePrompts,
  type PageSelection,
} from "@ontomato/contracts/page-context";
