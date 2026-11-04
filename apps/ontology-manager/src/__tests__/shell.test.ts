import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

// The heavy Manager pages (graph libraries, Markdown) are doubled; the router, layout, catalogs and requests are real.
vi.mock("../../../../packages/ontology-manager/src/components/OntologyPlayground.vue", () => ({
  __esModule: true,
  default: defineComponent({ name: "PlaygroundDouble", setup: () => () => h("p", { class: "page-double" }, "graph") }),
}));
vi.mock("../../../../packages/ontology-manager/src/visual-modeling/VisualModeling.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "VisualModelingDouble",
    props: { focus: String, focusId: String },
    setup: (props) => () => h("p", { class: "page-double" }, `modeling ${props.focus}:${props.focusId}`),
  }),
}));
vi.mock("../../../../packages/ontology-manager/src/data-browser/DataBrowser.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "DataBrowserDouble",
    props: { initialClass: String },
    setup: (props) => () => h("p", { class: "page-double" }, `data ${props.initialClass}`),
  }),
}));

vi.mock("../../../../packages/ontology-manager/src/knowledge-governance/GovernancePage.vue", () => ({
  __esModule: true,
  default: defineComponent({
    name: "GovernanceDouble",
    props: { sessionId: String },
    setup: (props) => () => h("p", { class: "page-double" }, `governance ${props.sessionId ?? ""}`),
  }),
}));

// Model configuration reads a structured settings response; its own package tests it.
vi.mock("../../../../packages/platform-admin/src/pages/ModelConfigPage.vue", () => ({
  __esModule: true,
  default: defineComponent({ name: "ModelConfigDouble", setup: () => () => h("p", { class: "page-double" }, "models") }),
}));

const { isolateShellPerTest } = await import("./isolation");
const { ossProfile } = await import("../profile");
const { startOssManager } = await import("../platform");

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
  window.history.replaceState({}, "", url);
  startOssManager(ossProfile);
  await settle();
}

const hash = () => window.location.hash;
const navRows = () => [...document.querySelectorAll(".nav-group .nav-row .nav-label")].map((row) => row.textContent);
const headings = () => [...document.querySelectorAll(".nav-heading")].map((heading) => heading.textContent);

describe("open-source Ontology Service page", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
    requests = [];
    statusFor = () => 200;
    window.__ONTOLOGY_MANAGER_CONFIG__ = { API_BASE: "/custom-base/api/", INITIAL_ROUTE: "" };
    vi.stubGlobal("fetch", async (url: string, init: { headers?: unknown } = {}) => {
      requests.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify({ success: true, data: [] }), { status: statusFor(url) });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("one sidebar lists the ontology, asset, knowledge and platform pages without enterprise pages", async () => {
    await start("/");
    expect(document.querySelector(".sidebar-brand")?.textContent).toBe("Ontology Service");
    expect(document.title).toBe("Ontology Service");
    expect(headings()).toEqual(["Ontology", "Assets", "Knowledge", "Platform Management"]);
    expect(navRows()).toEqual([
      "Ontomap",
      "Object Types",
      "Properties",
      "Relation Types",
      "Action Types",
      "Visual Modeling",
      "Data Browser",
      "Metric Views",
      "Functions",
      "Schedule Tasks",
      "Business Knowledge",
      "User Feedback",
      "Models",
      "System Settings",
      "Run Records",
    ]);
    // No back link to a separate workspace and no second header.
    expect(document.querySelector(".back-btn, .workspace-header, .platform-header")).toBeNull();
  });

  it("the Agent Platform link opens the deployment root in a new tab", async () => {
    await start("/");
    const link = document.querySelector<HTMLAnchorElement>(".nav-links a.nav-row")!;
    expect(link.textContent).toContain("Agent Platform");
    expect(link.getAttribute("href")).toBe("/custom-base/");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(document.querySelectorAll(".nav-links .nav-row")).toHaveLength(1);
  });

  it.each([
    ["/", "#/playground", "graph"],
    ["/#/", "#/playground", "graph"],
    ["/?view=data-browser", "#/data", "data "],
    ["/?view=assets", "#/assets/metrics", null],
    ["/?view=visual-modeling&focus=object&id=Order", "#/visual-modeling?focus=object&id=Order", "modeling object:Order"],
    ["/#/data/Order", "#/data/Order", "data Order"],
    ["/#/objects", "#/objects", null],
    ["/#/admin/ontology/visual-modeling", "#/visual-modeling", "modeling :"],
    ["/#/admin", "#/admin/model-config/usage", "models"],
    ["/#/admin/audit-log", "#/admin/records/audit-log", null],
    ["/#/no-such-page", "#/playground", "graph"],
  ])("old address %s lands on %s", async (url, landed, page) => {
    await start(url);
    expect(hash()).toBe(landed);
    if (page) expect(document.querySelector(".page-double")?.textContent).toBe(page);
  });

  it("the current page's navigation row is highlighted and the platform pages get the 48px page header", async () => {
    await start("/#/admin/audit-log");
    expect(document.querySelector(".nav-row.active .nav-label")?.textContent).toBe("Run Records");
    expect(document.querySelector(".page-header .page-title")?.textContent).toBe("Run Records");
    await start("/#/objects");
    expect(document.querySelector(".nav-row.active .nav-label")?.textContent).toBe("Object Types");
    expect(document.querySelector(".page-header")).toBeNull();
    expect(document.querySelector(".ontology-manager")).not.toBeNull();
  });

  it("knowledge governance fills the window without the service sidebar", async () => {
    await start("/#/knowledge-governance/s1");
    expect(document.querySelector(".page-double")?.textContent).toBe("governance s1");
    expect(document.querySelector(".service-layout")).toBeNull();
    expect(document.querySelector(".ontology-manager")).not.toBeNull();
  });

  it("requests go anonymously to the configured API root, and an old launch link loses its credential", async () => {
    sessionStorage.setItem("ontology_manager_token", "old-token");
    await start("/?view=data-browser&tk=t1&apiKey=k1&theme=dark#/objects");
    expect(window.location.search).toBe("?view=data-browser&theme=dark");
    expect(sessionStorage.getItem("ontology_manager_token")).toBeNull();
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.url.startsWith(new URL("/custom-base/api/data-query/", window.location.href).href)).toBe(true);
      expect(request.headers).not.toHaveProperty("tk");
      expect(request.headers).not.toHaveProperty("x-api-key");
    }
  });

  it("with one locale there is no language control; the theme control switches the whole page and is stored under the Ontology Service key", async () => {
    localStorage.setItem("theme-preference", "dark");
    await start("/?theme=dark");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.querySelector(".lang-button")).toBeNull();
    const light = document.documentElement.style.getPropertyValue("--el-bg-color");
    document.querySelector<HTMLButtonElement>(".theme-button")!.click();
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--el-bg-color")).not.toBe(light);
    expect(document.querySelector(".ontology-manager")?.classList.contains("is-dark")).toBe(true);
    expect(localStorage.getItem("ontology_manager_theme")).toBe("dark");
  });

  it("a 401 stops the page with its status; a 402 keeps it", async () => {
    statusFor = (url) => (url.endsWith("/action/queryList") ? 402 : 200);
    await start("/#/objects");
    expect(document.querySelector(".service-layout")).not.toBeNull();
    statusFor = (url) => (url.endsWith("/function/queryList") ? 401 : 200);
    await start("/#/objects");
    expect(document.querySelector(".service-layout")).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Request failed (401)");
  });
});
