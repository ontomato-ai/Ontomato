import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

// The heavy Manager pages (graph libraries, Markdown) are doubled; the router, layout, catalogs and requests are real.
vi.hoisted(() => { window.__APP_CONFIG__ = { API_BASE: "/custom-base/api" }; });

vi.mock("../../../../../../packages/ontology-manager/src/components/OntologyPlayground.vue", () => ({
  __esModule: true,
  default: defineComponent({ name: "PlaygroundDouble", setup: () => () => h("p", { class: "page-double" }, "graph") }),
}));
vi.mock("../../../../../../packages/ontology-manager/src/visual-modeling/VisualModeling.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "VisualModelingDouble",
    props: { focus: String, focusId: String },
    setup: (props) => () => h("p", { class: "page-double" }, `modeling ${props.focus}:${props.focusId}`),
  }),
}));
vi.mock("../../../../../../packages/ontology-manager/src/data-browser/DataBrowser.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "DataBrowserDouble",
    props: { initialClass: String },
    setup: (props) => () => h("p", { class: "page-double" }, `data ${props.initialClass}`),
  }),
}));

vi.mock("../../../../../../packages/ontology-manager/src/knowledge-governance/GovernancePage.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "GovernanceDouble",
    props: { sessionId: String },
    setup: (props) => () => h("p", { class: "page-double" }, `governance ${props.sessionId ?? ""}`),
  }),
}));

// Model configuration reads a structured settings response; its own package tests it.
vi.mock("../../../../../../packages/platform-admin/src/pages/ModelConfigPage.vue", () => ({
  __esModule: true,
  default: defineComponent({ name: "ModelConfigDouble", setup: () => () => h("p", { class: "page-double" }, "models") }),
}));

const { isolateShellPerTest } = await import("./isolation");
const { startPlatform } = await import("../../platform");

const resetShell = isolateShellPerTest();
let requests: { url: string; headers: Record<string, string> }[];
let statusFor: (url: string) => number;

async function settle() {
  for (let index = 0; index < 10; index += 1) {
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function start(url: string) {
  resetShell();
  document.body.innerHTML = '<div id="app"></div>';
  const entry = new URL(url, window.location.origin);
  entry.searchParams.set("__manager", "1");
  window.history.replaceState({}, "", entry);
  startPlatform();
  await settle();
}

const hash = () => window.location.hash;
// The platform shell's column: the pages of the application the address belongs to, under its group headings.
const navRows = () => [...document.querySelectorAll(".page-row .page-label")].map((row) => row.textContent);
const headings = () => [...document.querySelectorAll(".group-heading")].map((heading) => heading.textContent);

describe("open-source Ontology Service page", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    requests = [];
    statusFor = () => 200;
    window.__APP_CONFIG__ = { API_BASE: "/custom-base/api/", INITIAL_ROUTE: "" };
    vi.stubGlobal("fetch", async (url: string, init: { headers?: unknown } = {}) => {
      requests.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify({ success: true, data: [] }), { status: statusFor(url) });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the ontology manager's column lists its own pages, grouped as the manager groups them", async () => {
    await start("/#/ontology/objects");
    expect(document.querySelector(".panel-title")?.textContent).toBe("Ontology manager");
    expect(headings()).toEqual(["Ontology", "Assets", "Knowledge"]);
    expect(navRows()).toEqual([
      "Ontomap",
      "Object Types",
      "Properties",
      "Relation Types",
      "Action Types",
      "Visual Modeling",
      "Metric Views",
      "Functions",
      "Business Knowledge",
    ]);
  });

  it("the rail holds every application, and the object browser owns the graph and data browsing", async () => {
    await start("/#/browser/data");
    // The rail starts collapsed at this width; expanding it is what shows the names.
    document.querySelector<HTMLButtonElement>(".rail-toggle")!.click();
    await settle();
    const apps = [...document.querySelectorAll(".rail-row .rail-label")].map((row) => row.textContent);
    expect(apps).toEqual([
      "Agent Platform",
      "Operations diagnosis",
      "Knowledge governance",
      "Object browser",
      "Ontology manager",
      "Scheduled tasks",
      "System settings",
    ]);
    expect(document.querySelector(".panel-title")?.textContent).toBe("Object browser");
    expect(navRows()).toEqual(["Data Browser"]);
  });

  it.each([
    ["/", "#/ontology/playground", "graph"],
    ["/#/", "#/ontology/playground", "graph"],
    ["/?view=data-browser", "#/browser/data", "data "],
    ["/?view=assets", "#/ontology/assets/metrics", null],
    ["/?view=visual-modeling&focus=object&id=Order", "#/ontology/visual-modeling?focus=object&id=Order", "modeling object:Order"],
    ["/#/data/Order", "#/browser/data/Order", "data Order"],
    ["/#/objects", "#/ontology/objects", null],
    ["/#/admin/ontology/visual-modeling", "#/ontology/visual-modeling", "modeling :"],
    ["/#/admin", "#/settings/model-config/usage", "models"],
    ["/#/admin/audit-log", "#/settings/records/audit-log", null],
    ["/#/no-such-page", "#/ontology/playground", "graph"],
  ])("old address %s lands on %s", async (url, landed, page) => {
    await start(url);
    expect(hash()).toBe(landed);
    if (page) expect(document.querySelector(".page-double")?.textContent).toBe(page);
  });

  it("the current page's navigation row is highlighted and the platform pages get the 48px page header", async () => {
    await start("/#/admin/audit-log");
    expect(document.querySelector(".page-row.active .page-label")?.textContent).toBe("Run Records");
    expect(document.querySelector(".platform-page-header .page-title")?.textContent).toBe("Run Records");
    await start("/#/ontology/objects");
    expect(document.querySelector(".page-row.active .page-label")?.textContent).toBe("Object Types");
    // The Manager's own pages draw their own header.
    expect(document.querySelector(".platform-page-header")).toBeNull();
    expect(document.querySelector(".ontology-manager")).not.toBeNull();
  });

  it("knowledge governance is a conversation application of the platform", async () => {
    await start("/#/governance/chat/s1");
    expect(document.querySelector(".page-double")?.textContent).toBe("governance s1");
    expect(document.querySelector(".platform-shell")).not.toBeNull();
    expect(document.querySelector(".panel-title")?.textContent).toBe("Knowledge governance");
  });

  it("requests go anonymously to the configured API root, and an old launch link loses its credential", async () => {
    sessionStorage.setItem("ontology_manager_token", "old-token");
    await start("/?view=data-browser&tk=t1&apiKey=k1&theme=dark#/objects");
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem("ontology_manager_token")).toBeNull();
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.url.startsWith(new URL("/custom-base/api/data-query/", window.location.href).href)).toBe(true);
      expect(request.headers).not.toHaveProperty("tk");
      expect(request.headers).not.toHaveProperty("x-api-key");
    }
  });

  it("with one locale there is no language control; the theme control switches the whole page and is stored under the Ontology Service key", async () => {
    localStorage.setItem("theme-preference", "light");
    await start("/?theme=dark");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // The theme and language live in the rail's account menu now.
    document.querySelector<HTMLButtonElement>(".account-trigger")!.click();
    await settle();
    expect(document.querySelector(".menu-row[aria-checked]") ?? null).toBeNull();
    const light = document.documentElement.style.getPropertyValue("--el-bg-color") ||
      getComputedStyle(document.documentElement).getPropertyValue("--el-bg-color");
    [...document.querySelectorAll<HTMLButtonElement>(".menu-row")]
      .find((row) => row.textContent?.trim() === "Dark")!
      .click();
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--el-bg-color")).not.toBe(light);
    expect(document.querySelector(".ontology-manager")?.classList.contains("is-dark")).toBe(true);
    expect(localStorage.getItem("theme-preference")).toBe("dark");
  });

  it("a 401 stops the page with its status; a 402 keeps it", async () => {
    statusFor = (url) => (url.endsWith("/action/queryList") ? 402 : 200);
    await start("/#/objects");
    expect(document.querySelector(".platform-shell")).not.toBeNull();
    statusFor = (url) => (url.endsWith("/function/queryList") ? 401 : 200);
    await start("/#/objects");
    expect(document.querySelector(".platform-shell")).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Request failed (401)");
  });
});
