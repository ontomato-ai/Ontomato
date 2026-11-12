import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, h, nextTick, reactive, ref, type App } from "vue";
import { agentModelLabelsKey, platformPageAccessKey, type AgentModelLabels } from "@ontomato/platform-shell";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { createManager } from "../context";
import { englishMessages, managerMessageTree } from "../i18n";
import GovernancePage from "../knowledge-governance/GovernancePage.vue";
import { managerStandaloneRoutes, registerGovernanceScreen } from "../routes";

/* The page's own reads are what this covers: the report of the current session, source paging, and
 * that switching sessions neither keeps the previous report on screen nor mixes the two. And the application's
 * addresses: opening its pages from the column keeps the open conversation, so the report is always that
 * conversation's. */

let mounted: App[];
let responses: Map<string, unknown>;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function installManager(app: App) {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: managerMessageTree(englishMessages) } as never });
  app.use(i18n);
  // What the platform answers around the application: every page may be opened, and the model page's name.
  app.provide(platformPageAccessKey, () => true);
  app.provide(agentModelLabelsKey, computed(() => ({ title: "Models" }) as AgentModelLabels));
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

/** A conversation of the governance agent in the column's recent list (the column reads them as the service lists them). */
function recentConversation(title: string) {
  const entry = {
    id: "7b0c2f9e-1d2a-4c3b-8e5f-6a7b8c9d0e1f",
    agentId: "56a15178-ae22-4e6f-9974-ababeb42a676",
    title,
    createdAt: "2026-11-06T01:00:00Z",
    updatedAt: "2026-11-06T01:00:00Z",
    latestRun: null,
  };
  responses.set("/sessions", { sessions: [entry], nextCursor: null });
  return entry;
}

/** Clicks an entry of the application's column and lets the navigation it starts finish, over a few turns. */
async function clickEntry(host: HTMLElement, label: string) {
  await vi.waitFor(() =>
    expect([...host.querySelectorAll("button")].some((button) => button.textContent?.trim().includes(label))).toBe(true),
  );
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim().includes(label))!.click();
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
  }
}

/** Mounts the application at an address of its own, under the routes the platform registers for it. */
async function mountAt(path: string) {
  const history = createMemoryHistory();
  history.replace(path);
  const router = createRouter({ history, routes: [{ path: "/", component: RouterView, children: managerStandaloneRoutes() }] });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(RouterView);
  installManager(app);
  app.use(router);
  app.mount(host);
  mounted.push(app);
  await router.isReady();
  // The page is loaded on first use; its column is drawn once it is in.
  await vi.waitFor(() => expect(host.querySelector("button")).not.toBeNull());
  return { host, router };
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

  it("opens the report of the conversation the address names, and keeps that conversation in the address", async () => {
    responses.set("/s1/work", work("Checked the order rule", [issue("Order status rule")]));
    const { host, router } = await mountAt("/governance/chat/s1");
    await clickEntry(host, "Report");

    // The report is that conversation's work record: opening it from the column neither leaves the conversation nor
    // waits for a report that has no conversation to belong to.
    expect(router.currentRoute.value.fullPath).toBe("/governance/chat/s1");
    expect(host.textContent).toContain("Checked the order rule");
    expect(host.textContent).not.toContain("Loading…");
  });

  it("keeps the conversation while the feedback records are open, so the report shows it again", async () => {
    const conversation = recentConversation("Earlier review");
    responses.set(`/${conversation.id}/work`, work("Earlier review report"));
    registerGovernanceScreen("feedback", { render: () => h("p", "Feedback records") });
    const { host, router } = await mountAt(`/governance/chat/${conversation.id}`);

    await clickEntry(host, "User feedback");
    expect(router.currentRoute.value.fullPath).toBe(`/governance/feedback?sessionId=${conversation.id}`);
    await clickEntry(host, "Report");
    expect(router.currentRoute.value.fullPath).toBe(`/governance/chat/${conversation.id}`);
    expect(host.textContent).toContain("Earlier review report");
  });

  it("opens a recent conversation chosen while the feedback records are open", async () => {
    const conversation = recentConversation("Earlier review");
    registerGovernanceScreen("feedback", { render: () => h("p", "Feedback records") });
    const { host, router } = await mountAt("/governance/feedback");

    await clickEntry(host, "Earlier review");
    expect(router.currentRoute.value.fullPath).toBe(`/governance/chat/${conversation.id}`);
  });

  it("stops loading the report of a conversation the reader has left", async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/s1/work")) {
        await held;
        return json(work("First session report"));
      }
      for (const [suffix, body] of responses) if (url.includes(suffix)) return json(body);
      return json({});
    });
    const { host, props } = mountPage("s1");
    await openReport(host);
    expect(host.textContent).toContain("Loading…");

    props.sessionId = null;
    await settle();
    answer();
    await settle();

    expect(host.textContent).not.toContain("Loading…");
    expect(host.textContent).not.toContain("First session report");
  });

  it("lists the feedback records in the column and shows the screen the edition handed over", async () => {
    // The feedback screen belongs to the platform's pages; the edition that holds both passes it in.
    const screen = { render: () => h("p", { class: "feedback-double" }, "Feedback records") };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp({
      render: () => h(GovernancePage, { sessionId: null, page: "feedback", screens: { feedback: screen } }),
    });
    installManager(app);
    app.mount(host);
    mounted.push(app);
    await settle();

    // The column surrounds the screen: the application's own column is still there.
    expect([...host.querySelectorAll("button")].map((button) => button.textContent?.trim())).toContain("User feedback");
    expect(host.querySelector(".feedback-double")).not.toBeNull();
  });
});
