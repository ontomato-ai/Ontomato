import { expect, it } from "vitest";
import { pageContextLine, pageMoved, samePageAddress, type PageContext } from "../page-context";

/*
 * What a message from beside a page carries: the selected item every time, the page itself only when the conversation
 * has none yet or the address moved to another one. A draft handoff, a fragment or a trailing slash is the same page, so
 * saving a draft or scrolling does not make the next message repeat the page.
 */
const lines = { page: (page: string) => `Current page: ${page}`, selection: (selection: string) => `Selected: ${selection}` };
const page: PageContext = {
  pageKey: "agent-settings",
  url: "/agents/settings/agent-1?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json",
  label: "Agent settings · Sales analyst",
  selection: [{ kind: "agent", id: "agent-1", label: "Sales analyst" }],
};

it("carries the page on the first message, and only the selection after it", () => {
  expect(pageMoved(null, page)).toBe(true);
  expect(pageContextLine(page, lines, true)).toBe("Current page: Agent settings · Sales analyst；Selected: Sales analyst");
  expect(pageContextLine(page, lines, false)).toBe("Selected: Sales analyst");
});

it("treats a draft parameter, a fragment or a trailing slash as the same page", () => {
  const sent = samePageAddress(page.url);
  expect(sent).toBe(samePageAddress("/agents/settings/agent-1"));
  expect(pageMoved(sent, { ...page, url: "/agents/settings/agent-1/" })).toBe(false);
  // Another object in the same page is another page to the agent: the object joins the line as the selection.
  expect(pageMoved(sent, { ...page, url: "/agents/settings/agent-2" })).toBe(true);
});
