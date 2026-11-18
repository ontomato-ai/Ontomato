import { expect, it } from "vitest";
import { pageContextLine, pageLineAddress, pageMoved, samePageAddress, type PageContext } from "../page-context";

/*
 * What a message from beside a page carries: the page — the reader's name for it and the address that tells it from a
 * namesake — and the item selected in it, which the page reports.
 */
const lines = {
  page: (page: { label: string; url: string }) => `Current page: ${page.label} (${page.url})`,
  pageAddress: (url: string) => `Current page: ${url}`,
  selection: (selection: string) => `Selected: ${selection}`,
};
const page: PageContext = {
  url: "/agents/settings/agent-1?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json",
  label: "Agent settings · Sales analyst",
  selection: [{ kind: "agent", id: "agent-1", label: "Sales analyst" }],
};

it("names the page by its title and its address, with what is selected in it", () => {
  const url = "/agents/settings/agent-1";
  expect(pageContextLine({ ...page, url }, lines, true)).toBe(
    `Current page: Agent settings · Sales analyst (${url})；Selected: Sales analyst`,
  );
  // A page whose report says nothing of a selection ends at its name and address.
  expect(pageContextLine({ ...page, url, selection: [] }, lines, true)).toBe(
    `Current page: Agent settings · Sales analyst (${url})`,
  );
});

it("names no registration key: a key is internal and the agent cannot link to it", () => {
  const line = pageContextLine(page, lines, true);
  expect(line).not.toContain("agent-settings");
  expect(line).toBe(`Current page: Agent settings · Sales analyst (${page.url})；Selected: Sales analyst`);
});

it("reads the address back as it wrote it, so a reopened conversation knows its page", () => {
  const text = `write about this\n\n${pageContextLine(page, lines, true)}`;
  expect(pageLineAddress(text, lines)).toBe(page.url);
  expect(pageLineAddress("nothing here", lines)).toBeNull();
});

it("reads the address back in a language whose brackets surround the name alone", () => {
  const chinese = {
    page: (page: { label: string; url: string }) => `当前页面：${page.label}（${page.url}）`,
    pageAddress: (url: string) => `当前页面：${url}`,
    selection: (selection: string) => `选中的：${selection}`,
  };
  const written = pageContextLine({ ...page, url: "/dashboards?dashboardId=board-a" }, chinese, true);
  expect(written).toBe("当前页面：Agent settings · Sales analyst（/dashboards?dashboardId=board-a）；选中的：Sales analyst");
  expect(pageLineAddress(`later\n\n${written}`, chinese)).toBe("/dashboards?dashboardId=board-a");
});

it("names a page the shell cannot name yet by its address alone, and no selection it was not told", () => {
  const unnamed: PageContext = { url: "/applications/app-a/tasks", label: "", selection: [] };
  expect(pageContextLine(unnamed, lines, true)).toBe("Current page: /applications/app-a/tasks");
  // A reopened conversation's earlier message, written before the frame reported the page's name, is that same page.
  expect(pageLineAddress(`earlier\n\n${pageContextLine(unnamed, lines, true)}`, lines)).toBe(unnamed.url);
});

it("treats a draft parameter, a fragment or a trailing slash as the same page", () => {
  const sent = samePageAddress(page.url);
  expect(sent).toBe(samePageAddress("/agents/settings/agent-1"));
  expect(pageMoved(sent, { ...page, url: "/agents/settings/agent-1/" })).toBe(false);
  // Another object in the same page is another page to the agent: the object joins the line as the selection.
  expect(pageMoved(sent, { ...page, url: "/agents/settings/agent-2" })).toBe(true);
});

it("names two pages of one title by their addresses", () => {
  const trialA: PageContext = { url: "/applications/app-a/tasks", label: "Scheduled tasks (trial)", selection: [] };
  const trialB: PageContext = { url: "/applications/app-b/tasks", label: "Scheduled tasks (trial)", selection: [] };
  expect(pageContextLine(trialA, lines, true)).not.toBe(pageContextLine(trialB, lines, true));
  const reopened = `earlier\n\n${pageContextLine(trialA, lines, true)}`;
  expect(samePageAddress(pageLineAddress(reopened, lines)!)).toBe(samePageAddress(trialA.url));
  expect(samePageAddress(pageLineAddress(reopened, lines)!)).not.toBe(samePageAddress(trialB.url));
});

it("shows the characters a reader reads in the address and keeps what structures it, still the same page", () => {
  const url = "/dashboards?dashboardName=e2e-%E6%95%99%E8%81%8C%E5%B7%A5%20board&next=a%26b%2Fc";
  const written = pageContextLine({ url, label: "Dashboards", selection: [] }, lines, true);
  // The name is decoded; the space, `&` and `/` inside a value stay escaped, so the address still opens that board.
  expect(written).toBe("Current page: Dashboards (/dashboards?dashboardName=e2e-教职工%20board&next=a%26b%2Fc)");
  expect(samePageAddress(pageLineAddress(written, lines)!)).toBe(samePageAddress(url));
});
