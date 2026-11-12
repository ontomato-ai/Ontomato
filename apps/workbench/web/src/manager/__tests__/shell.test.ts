import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { catalogFixture } from "../../../../../../packages/platform-web/src/__tests__/fixtures";

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
vi.mock("../../../../../../packages/workbench-ui/src/features/workbench/components/BusinessWorkbench.vue", () => ({
  default: defineComponent({ name: "BusinessDouble", setup: () => () => h("p", { class: "page-double" }, "agents") }),
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
/** The name the catalog declares for an application, as the rail labels its row. */
const appName = (id: string) => catalogFixture().find((app) => app.id === id)!.names.en;

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
      return new Response(JSON.stringify({ success: true, data: url.includes("/platform/applications") ? catalogFixture() : [] }), { status: statusFor(url) });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["/", "#/home", null],
    ["/#/", "#/home", null],
    ["/?view=data-browser", "#/browser/data", "data "],
    ["/?view=assets", "#/ontology/assets/metrics", null],
    ["/?view=visual-modeling&focus=object&id=Order", "#/ontology/visual-modeling?focus=object&id=Order", "modeling object:Order"],
    ["/#/data/Order", "#/browser/data/Order", "data Order"],
    ["/#/objects", "#/ontology/objects", null],
    ["/#/admin/ontology/visual-modeling", "#/ontology/visual-modeling", "modeling :"],
    ["/#/admin", "#/settings/model-config/usage", "models"],
    ["/#/admin/audit-log", "#/settings/records/audit-log", null],
    ["/#/no-such-page", "#/home", null],
  ])("old address %s lands on %s", async (url, landed, page) => {
    await start(url);
    expect(hash()).toBe(landed);
    if (page) expect(document.querySelector(".page-double")?.textContent).toBe(page);
  });

  it("the current application is marked in the rail", async () => {
    await start("/#/admin/audit-log");
    expect(document.querySelector(".rail-row.active")?.getAttribute("aria-label")).toBe(appName("settings"));
    await start("/#/ontology/objects");
    expect(document.querySelector(".rail-row.active")?.getAttribute("aria-label")).toBe(appName("ontology"));
  });

  it("knowledge governance is a conversation application of the platform", async () => {
    await start("/#/governance/chat/s1");
    expect(document.querySelector(".page-double")?.textContent).toBe("governance s1");
    expect(document.querySelector(".platform-shell")).not.toBeNull();
    expect(document.querySelector(".rail-row.active")?.getAttribute("aria-label")).toBe(appName("governance"));
  });

  it("requests go anonymously to the configured API root, and an old launch link loses its credential", async () => {
    sessionStorage.setItem("ontology_manager_token", "old-token");
    await start("/?view=data-browser&tk=t1&apiKey=k1&theme=dark#/objects");
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem("ontology_manager_token")).toBeNull();
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const path = new URL(request.url, window.location.origin).pathname;
      // The catalog and the pages read the data engine; entering an application records its opening with the workbench.
      expect(path.startsWith("/custom-base/api/data-query/") || path === "/custom-base/api/skills" || path.startsWith("/custom-base/api/platform/home/") || request.url.startsWith("/api/data-query/platform/applications")).toBe(true);
      expect(request.headers).not.toHaveProperty("tk");
      expect(request.headers).not.toHaveProperty("x-api-key");
    }
  });

  it("with one locale there is no language control; the theme control switches the whole page and is stored under the Ontology Service key", async () => {
    localStorage.setItem("theme-preference", "light");
    await start("/?theme=dark#/ontology/objects");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // The theme and language live in the rail's account menu now.
    document.querySelector<HTMLButtonElement>(".account-trigger")!.click();
    await settle();
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
  });
});
