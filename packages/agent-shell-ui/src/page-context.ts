/**
 * What a message sent from beside a page carries (overall design 3.4): the page itself and the objects, files or rows
 * selected in it. It is one line at the end of the message, part of the text the agent reads; the send protocol does not
 * change.
 *
 * The shape is the contracts' one, shared with the panel host and the platform's own pages, so a page beside the
 * conversation and a panel opened beside it say what the reader looks at the same way. The selection belongs to the
 * reader's moment by moment, so every message names it. The page only rides on the conversation's first message or when
 * the address moved to another one: repeating the address on every message would spend the agent's context on something
 * that changed once. A draft parameter, a scroll or an enlarged page is the same page.
 */
export {
  pageContextLine,
  pageMoved,
  pageSelectionSchema,
  pageContextSchema,
  samePageAddress,
  type PageContext,
  type PageSelection,
} from "@ontomato/contracts/page-context";
