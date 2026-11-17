import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, ref, type App } from "vue";
import { platformPageAccessKey } from "@ontomato/platform-shell";
import { createI18n } from "vue-i18n";
import { createManager } from "../context";
import { englishMessages, managerMessageTree } from "../i18n";
import GovernancePage from "../knowledge-governance/GovernancePage.vue";

/* One governance record's report: what it reads, how it pages one source, and that switching records never keeps the
 * previous one on screen. The conversation that wrote the record is the agent platform's, so nothing here reads or
 * draws a conversation. */

let mounted: App[];
let responses: Map<string, unknown>;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

type Translate = (key: string, params?: Record<string, unknown>) => string;

function installManager(app: App): Translate {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: managerMessageTree(englishMessages) } as never });
  app.use(i18n);
  app.provide(platformPageAccessKey, () => true);
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
  return (i18n as unknown as { global: { t: Translate } }).global.t;
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

/** Mounts the page with a reactive record prop, the way a host switches records. */
function mountPage(recordId: string) {
  const props = reactive({ recordId });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({ render: () => h(GovernancePage, { recordId: props.recordId }) });
  const translate = installManager(app);
  app.mount(host);
  mounted.push(app);
  return { host, props, translate };
}

async function settle() {
  for (let i = 0; i < 8; i++) await nextTick();
}

beforeEach(() => {
  mounted = [];
  responses = new Map();
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
  it("shows the record's findings, its progress and its sources", async () => {
    responses.set("/record-1/work", work("Checked the order rule", [issue("Order status rule")], [source("src1", "Order doc")]));
    const { host, translate } = mountPage("record-1");
    await settle();

    expect(host.textContent).toContain("Checked the order rule");
    expect(host.textContent).toContain("Order status rule");
    expect(host.textContent).toContain(translate("governance.text.progress", { done: 1, total: 4 }));
    expect(host.textContent).toContain("Order doc");
  });

  it("replaces the first source page with the next one instead of appending it", async () => {
    responses.set("/record-1/work", work("", [], [source("src1", "Order doc")]));
    responses.set("/record-1/sources/", page("src1", "first part", 40));
    const { host } = mountPage("record-1");
    await settle();

    const [open] = [...host.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === "Order doc");
    open!.click();
    await settle();
    expect(host.textContent).toContain("first part");

    responses.set("/record-1/sources/", page("src1", "second part", null));
    const more = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Read the next part");
    more!.click();
    await settle();

    expect(host.textContent).toContain("second part");
    expect(host.textContent).not.toContain("first part");
  });

  it("does not keep the previous record's report after switching", async () => {
    responses.set("/record-1/work", work("First record report", [issue("First finding")]));
    responses.set("/record-2/work", work("Second record report", [issue("Second finding")]));
    const { host, props } = mountPage("record-1");
    await settle();
    expect(host.textContent).toContain("First record report");

    props.recordId = "record-2";
    await settle();

    expect(host.textContent).toContain("Second record report");
    expect(host.textContent).not.toContain("First record report");
    expect(host.textContent).not.toContain("First finding");
  });

  it("shows the record's report with its own title and way back when it is not beside a conversation", async () => {
    responses.set("/record-1/work", work("Checked the order rule", [issue("Order status rule")]));
    const { host } = mountPage("record-1");
    await settle();

    expect(host.textContent).toContain("Checked the order rule");
    expect(host.querySelector(".report")).not.toBeNull();
    // At its own address the page draws its title and the way back; beside the conversation the shell does.
    expect(host.querySelector(".governance-title")).not.toBeNull();
    expect(host.querySelector(".governance-back")).not.toBeNull();
  });

  it("beside the conversation the shell draws the frame, so the page shows only its report", async () => {
    responses.set("/record-1/work", work("Checked the order rule"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp({ render: () => h(GovernancePage, { recordId: "record-1", paired: true }) });
    installManager(app);
    app.mount(host);
    mounted.push(app);
    await settle();

    expect(host.querySelector(".report")).not.toBeNull();
    expect(host.querySelector(".governance-title")).toBeNull();
    expect(host.querySelector(".governance-back")).toBeNull();
  });

  it("marks the finding its address names as selected, and asks the host when another is chosen", async () => {
    responses.set("/record-1/work", work("", [issue("Order status rule"), issue("Refund rule")]));
    const chosen: (string | null)[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp({
      render: () => h(GovernancePage, { recordId: "record-1", issueId: "Order status rule", onSelect: (id: string | null) => chosen.push(id) }),
    });
    installManager(app);
    app.mount(host);
    mounted.push(app);
    await settle();

    const selected = host.querySelector(".issue.selected .issue-title");
    expect(selected?.textContent).toBe("Order status rule");
    const heads = [...host.querySelectorAll<HTMLButtonElement>(".issue-head")];
    heads.find((head) => head.textContent?.includes("Refund rule"))!.click();
    await settle();
    expect(chosen).toEqual(["Refund rule"]);
  });

  it("stops loading the report of a record the reader has left", async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/record-1/work")) {
        await held;
        return json(work("First record report"));
      }
      for (const [suffix, body] of responses) if (url.includes(suffix)) return json(body);
      return json({});
    });
    const { host, props } = mountPage("record-1");
    await settle();
    expect(host.textContent).toContain("Loading…");

    props.recordId = "record-2";
    await settle();
    answer();
    await settle();

    expect(host.textContent).not.toContain("Loading…");
    expect(host.textContent).not.toContain("First record report");
  });
});
