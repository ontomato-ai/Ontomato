import { expect, it } from "vitest";
import {
  CLOSED_TARGET,
  carriedTargetIn,
  fileContextLine,
  fileLinePath,
  pageContextLine,
  pageLineAddress,
  pageMoved,
  samePageAddress,
  writtenText,
  type PageContext,
  type PageSelection,
} from "../page-context";

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

const file = (item: { label: string; path: string }) => `Current file: ${item.label} (${item.path})`;
const chineseFile = (item: { label: string; path: string }) => `当前文件：${item.label}（${item.path}）`;

it("names a file beside the conversation by its title and its path, and reads the path back in either language", () => {
  // A title may hold brackets of its own; the path is the line's last one.
  const shown = { label: "Students (by family name)", path: "outputs/学生姓氏.dataset.json" };
  expect(fileLinePath(`which is largest\n\n${fileContextLine(shown, file)}`, file)).toBe(shown.path);
  expect(fileLinePath(`最大的是哪个\n\n${fileContextLine(shown, chineseFile)}`, chineseFile)).toBe(shown.path);
  // A page line is no file line, and a file line is no page line.
  expect(fileLinePath(`x\n\n${pageContextLine(page, lines, true)}`, file)).toBeNull();
  expect(pageLineAddress(`x\n\n${fileContextLine(shown, file)}`, lines)).toBeNull();
});

it("reads back whichever target a reopened conversation told last, or that it said it closed", () => {
  const prompts = { ...lines, file, closed: "Current page: closed" };
  const onPage = `on the page\n\n${pageContextLine(page, lines, true)}`;
  const onFile = `on the file\n\n${fileContextLine({ label: "Result", path: "outputs/result.dataset.json" }, file)}`;
  expect(carriedTargetIn([onPage, onFile], prompts)).toBe("outputs/result.dataset.json");
  expect(carriedTargetIn([onFile, onPage], prompts)).toBe(samePageAddress(page.url));
  expect(carriedTargetIn([onFile, "after\n\nCurrent page: closed"], prompts)).toBe(CLOSED_TARGET);
  expect(carriedTargetIn(["nothing beside"], prompts)).toBeNull();
});

it("shows the reader's message without the line it carries for the agent", () => {
  const prompts = { ...lines, file: (file: { label: string; path: string }) => `Current file: ${file.label} (${file.path})`, closed: "The page was closed." };
  const asked = "Approve the selected one.\n\nThen tell me what changed.";
  const url = "/applications/app-business-knowledge/review?state=%7B%22selected%22%3A%7B%22primaryKey%22%3A%22k-1%22%7D%7D";
  // The page and its selection, the selection alone, a file, a closed page: each is the agent's, not the reader's.
  expect(writtenText(`${asked}\n\n${pageContextLine({ ...page, url }, lines, true)}`, prompts)).toBe(asked);
  expect(writtenText(`${asked}\n\n${pageContextLine({ ...page, url, label: "" }, lines, true)}`, prompts)).toBe(asked);
  expect(writtenText(`${asked}\n\n${pageContextLine(page, lines, false)}`, prompts)).toBe(asked);
  expect(writtenText(`${asked}\n\n${fileContextLine({ label: "Report", path: "outputs/report.md" }, prompts.file)}`, prompts)).toBe(asked);
  expect(writtenText(`${asked}\n\n${prompts.closed}`, prompts)).toBe(asked);
  // A message that carries nothing is shown whole, its own last paragraph included.
  expect(writtenText(asked, prompts)).toBe(asked);
});

it("gives a selection made in a placed panel with that placement's path, as the panel's reads and operations take it", () => {
  const memberPath: NonNullable<PageSelection["memberPath"]> = [
    { member: "preview", selection: { stateValue: { className: "platform:ProductPanel", primaryKey: "knowledge" }, target: { panelId: "knowledge" } } },
  ];
  const line = pageContextLine({
    url: "/ontology/panels",
    label: "Panels",
    selection: [
      { kind: "platform:ProductPanel", id: "knowledge", label: "Business knowledge" },
      { kind: "platform:BusinessKnowledge", id: "k-1", label: "Staff filter", memberPath },
    ],
  }, lines, true);
  expect(line).toBe(
    `Current page: Panels (/ontology/panels)；Selected: Business knowledge；Selected: Staff filter memberPath=${JSON.stringify(memberPath)}`,
  );
  // The page is still read back, and the reader's own words still stand without the line.
  expect(pageLineAddress(line, lines)).toBe("/ontology/panels");
  const prompts = { ...lines, file: (file: { label: string; path: string }) => `Current file: ${file.label} (${file.path})`, closed: "The page was closed." };
  expect(writtenText(`Approve it.\n\n${line}`, prompts)).toBe("Approve it.");
});

it("carries graph search and path highlights distinctly in pageContextLine and strips highlight-only lines from user text", () => {
  const prompts = {
    ...lines,
    highlight: (summary: string) => `Highlighted: ${summary}`,
    file: (file: { label: string; path: string }) => `Current file: ${file.label} (${file.path})`,
    closed: "The page was closed.",
  };
  const searchPage: PageContext = {
    url: "/ontology/graph",
    label: "Ontology graph",
    selection: [],
    highlights: [{
      kind: "search",
      summary: "Search matches (2): Person, Organization",
      items: [
        { kind: "platform:ObjectType", id: "person", label: "Person" },
        { kind: "platform:ObjectType", id: "org", label: "Organization" },
      ],
    }],
  };
  const searchLine = pageContextLine(searchPage, prompts, false);
  expect(searchLine).toBe("Highlighted: Search matches (2): Person, Organization");
  expect(writtenText(`Explain these.\n\n${searchLine}`, prompts)).toBe("Explain these.");

  const pathPage: PageContext = {
    url: "/ontology/graph",
    label: "Ontology graph",
    selection: [],
    highlights: [{
      kind: "path",
      summary: "No path found in the visible graph from Person to Organization",
      from: { kind: "platform:ObjectType", id: "person", label: "Person" },
      to: { kind: "platform:ObjectType", id: "org", label: "Organization" },
      found: false,
      nodes: [],
      edges: [],
      partialEdges: true,
      partialNotice: "Relations are hidden because you do not have access to them",
    }],
  };
  const pathLine = pageContextLine(pathPage, prompts, true);
  expect(pathLine).toBe(
    "Current page: Ontology graph (/ontology/graph)；Highlighted: No path found in the visible graph from Person to Organization；Relations are hidden because you do not have access to them",
  );
  expect(writtenText(`Why no path?\n\n${pathLine}`, prompts)).toBe("Why no path?");
});
