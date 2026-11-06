import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, ref, type App } from "vue";
import { createI18n } from "vue-i18n";
import { createManager } from "../context";
import { englishMessages, managerMessageTree } from "../i18n";
import GovernancePage from "../knowledge-governance/GovernancePage.vue";

/* The page's own reads are what this covers: the report of the current session, source paging, and
 * that switching sessions neither keeps the previous report on screen nor mixes the two. */

let mounted: App[];
let responses: Map<string, unknown>;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function installManager(app: App) {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: managerMessageTree(englishMessages) } as never });
  app.use(i18n);
  createManager({
    apiBase: "/manager-api",
    credential: { type: "token", token: "t-1" },
    theme: ref("light"),
    locale: ref("en"),
    translate: (key) => key,
    dataFallbacks: { noBusinessDescription: "", unnamedAsset: "" },
    presentation: {
      themeProperties: { light: {}, dark: {} },
      nodePalette: { light: [], dark: [] },
      edgeLabel: {},
      maxFitZoom: null,
      dataBrowserDescription: () => "",
      compactDialogs: false,
    },
    knowledgeTagValues: { general: "General", business: "Business", tech: "Tech" },
    onAuthFailure: () => {},
  }).install(app);
}

function work(summary: string, issues: unknown[] = [], sources: unknown[] = []) {
  return {
    revision: 1,
    work: { summary, notes: "", knowledgeTotal: 4, reviewedKnowledgeIds: ["k1"], issues, sources },
  };
}

const issue = (title: string) => ({
  id: title, category: "ontology", status: "proposed", title, problem: "p", before: "", after: "a", basis: "b", sourceIds: [],
});

const source = (id: string, title: string) => ({
  id, kind: "knowledge", target: id, title, excerpt: "",
});

const page = (id: string, text: string, next: number | null) => ({
  source: source("src", "Source"),
  page: {
    items: [{ id: `${id}-${text}`, title: "", text, start: 0, end: text.length, totalChars: text.length }],
    totalItems: 1,
    matchedItems: 1,
    next: next === null ? null : { index: 0, offset: next },
  },
});

/** Mounts the page with a reactive session prop, the way a host switches conversations. */
function mountPage(sessionId: string | null) {
  const props = reactive({ sessionId });
  // The application draws its own column: the page's shell renders it inside the page, so the test mounts the page alone.
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({ render: () => h(GovernancePage, { sessionId: props.sessionId }) });
  installManager(app);
  app.mount(host);
  mounted.push(app);
  return { host, props };
}

async function settle() {
  for (let i = 0; i < 8; i++) await nextTick();
}

/** Opens the report feature, which is where the page reads and shows the work. */
async function openReport(host: HTMLElement) {
  // The column is filled on the render after the page mounts, so the report entry appears one tick later.
  await settle();
  const report = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Report");
  report!.click();
  await settle();
}

beforeEach(() => {
  mounted = [];
  responses = new Map([
    ["/agents", { agents: [{ id: "56a15178-ae22-4e6f-9974-ababeb42a676", name: "", description: "", icon: null, enabled: true }] }],
    ["/sessions", { sessions: [], nextCursor: null }],
  ]);
  vi.stubGlobal("fetch", async (url: string) => {
    for (const [suffix, body] of responses) if (url.includes(suffix)) return json(body);
    return json({});
  });
});

afterEach(() => {
  mounted.forEach((app) => app.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("governance report", () => {
  it("shows the session's findings, its progress and its sources", async () => {
    responses.set("/s1/work", work("Checked the order rule", [issue("Order status rule")], [source("src1", "Order doc")]));
    const { host } = mountPage("s1");
    await openReport(host);

    expect(host.textContent).toContain("Checked the order rule");
    expect(host.textContent).toContain("Order status rule");
    expect(host.textContent).toContain("Reviewed 1 of 4");
    expect(host.textContent).toContain("Order doc");
  });

  it("replaces the first source page with the next one instead of appending it", async () => {
    responses.set("/s1/work", work("", [], [source("src1", "Order doc")]));
    responses.set("/s1/sources/", page("src1", "first part", 40));
    const { host } = mountPage("s1");
    await openReport(host);

    const [open] = [...host.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === "Order doc");
    open!.click();
    await settle();
    expect(host.textContent).toContain("first part");

    responses.set("/s1/sources/", page("src1", "second part", null));
    const more = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Read the next part");
    more!.click();
    await settle();

    expect(host.textContent).toContain("second part");
    expect(host.textContent).not.toContain("first part");
  });

  it("does not keep the previous session's report after switching", async () => {
    responses.set("/s1/work", work("First session report", [issue("First finding")]));
    responses.set("/s2/work", work("Second session report", [issue("Second finding")]));
    const { host, props } = mountPage("s1");
    await openReport(host);
    expect(host.textContent).toContain("First session report");

    props.sessionId = "s2";
    await settle();

    expect(host.textContent).toContain("Second session report");
    expect(host.textContent).not.toContain("First session report");
    expect(host.textContent).not.toContain("First finding");
  });
});
