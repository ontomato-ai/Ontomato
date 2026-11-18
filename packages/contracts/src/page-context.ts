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
 * The name and the address are the shell's own facts: it opened the page and wrote its address, so a message sent
 * before the page reported anything still names it, without the reader waiting. The selection is the page's own report,
 * and only a reported one rides.
 *
 * The page rides on the conversation's first message or when the address moved to another one: repeating the address
 * would spend the agent's context on something that changed once. A draft parameter, a scroll or an enlarged page is the
 * same page.
 *
 * `pageContextLine` writes that line and `pageLineAddress` reads it back, so the shell's own recognition of a page a
 * reopened conversation already named cannot drift from the way it was written.
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
     * The page's registration key, where a page has one: the platform's own pages and a panel are named by their
     * application use. It is internal — an agent read names, not keys — and the message line names the address instead.
     */
    pageKey: z.string().min(1).max(200).optional(),
    /**
     * The page's address, as the page shows it: the same address an answer links to and the platform's `?page=` carries.
     * The line names it, so an agent that hears of two pages with one title can tell which one is beside it.
     */
    url: z.string().min(1).max(4000),
    /**
     * What the reader calls the page. A panel application's page is named in the platform's catalog, and its frame reports
     * that name once it runs; a shell that has none yet names the address alone rather than a made-up name.
     */
    label: z.string().max(500),
    /** What the page reports is selected in it; a page that reports nothing yet has none. */
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

/** A message ends with one line and the separators between its parts. */
const PART_SEPARATOR = "；";

/**
 * A line's parts: the page, with a name the reader reads and the address that tells it from its namesakes, and a
 * selection. A page that has no name here is named by its address alone (`label` is empty).
 */
export interface PageLinePrompts {
  page: (page: { label: string; url: string }) => string;
  /** The same line for a page the shell cannot name yet: the address alone. */
  pageAddress: (url: string) => string;
  selection: (label: string) => string;
}

/** A run of escaped bytes beyond ASCII: the UTF-8 of characters a reader reads, such as a board's Chinese name. */
const ESCAPED_TEXT = /(?:%[89A-F][0-9A-F])+/gi;

/**
 * An address as the line shows it: the characters a reader reads are decoded, and everything that structures the
 * address (`/`, `?`, `&`, `=`, `%`, a space) stays as written, so the address in the line still opens the page and reads
 * back as the same page. A run that is no UTF-8 text is an address's own bytes and stays escaped.
 */
function readableAddress(url: string): string {
  return url.replace(ESCAPED_TEXT, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/**
 * The page part of the line: its name and its address, or the address alone for a page the shell cannot name yet (a
 * panel's, before its frame reports the name its application declares).
 */
function pagePart(page: { label: string; url: string }, prompts: PageLinePrompts): string {
  const url = readableAddress(page.url);
  return page.label ? prompts.page({ label: page.label, url }) : prompts.pageAddress(url);
}

/**
 * The one line a message ends with: the page (when it rides) and what is selected in it. The page is one part, holding
 * both its name and its address, so a reader of the line cannot take the name alone for the page's whole identity.
 */
export function pageContextLine(page: PageContext, prompts: PageLinePrompts, carriesPage: boolean): string {
  return [
    ...(carriesPage ? [pagePart(page, prompts)] : []),
    ...page.selection.map((item) => prompts.selection(item.label)),
  ].join(PART_SEPARATOR);
}

/** What the address stands between in the page prompt, once its other two parts are found. */
const ADDRESS_START = "\u0000address-start";
const ADDRESS_END = "\u0000address-end";

/** An address as a page shows it: the platform's own path, which a name does not start with. */
const ADDRESS = /^\/\S*/;

/**
 * The address a message's page line names, for a conversation reopened after it was sent; null for a message that names
 * no page. The prompts are the reader's own, so the line is read back exactly as `pageContextLine` wrote it in the same
 * language: where the name begins and ends is found from the page prompt itself. A page's name may hold brackets of its
 * own ("Scheduled tasks (trial)"), so the address is the first path the line reaches after it, not the last bracket.
 */
export function pageLineAddress(text: string, prompts: PageLinePrompts): string | null {
  for (const template of [prompts.page({ label: ADDRESS_START, url: ADDRESS_END }), prompts.pageAddress(ADDRESS_END)]) {
    const address = addressInLine(text, template);
    if (address !== null) return address;
  }
  return null;
}

/**
 * The address a line written with this page prompt names, if the message has such a line. The prompt's text before the
 * name begins is what the line opens with; a prompt without a name there opens with its own text up to the address.
 */
function addressInLine(text: string, template: string): string | null {
  const named = template.indexOf(ADDRESS_START);
  const start = named < 0 ? template.indexOf(ADDRESS_END) : named;
  const end = template.indexOf(ADDRESS_END);
  if (start < 0 || end < start) return null;
  const before = template.slice(0, start);
  const afterName = template.slice(start + ADDRESS_START.length, end);
  const after = template.slice(end + ADDRESS_END.length);
  const line = text.split("\n").find((entry: string) => entry.startsWith(before));
  if (!line) return null;
  const rest = line.slice(before.length);
  for (let at = rest.indexOf(afterName); at >= 0; at = rest.indexOf(afterName, at + afterName.length)) {
    const atAddress = at + afterName.length;
    const found = ADDRESS.exec(rest.slice(atAddress, after ? rest.indexOf(after, atAddress) : undefined));
    if (found) return found[0];
  }
  return null;
}
