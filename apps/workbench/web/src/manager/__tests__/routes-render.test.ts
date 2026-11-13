import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "vue";
import type { Router } from "vue-router";
import { agentHostAgentListSchema, agentHostSessionPageSchema } from "@ontomato/contracts/agent-host";
import { appBuilderBootstrapSchema } from "@ontomato/contracts/app-builder";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { catalogFixture, catalogPartitionFixture as appPartition } from "../../../../../../packages/platform-web/src/__tests__/fixtures";

/*
 * What this guards: every address an application owns draws that page into the platform's main area, and the rail
 * switches between applications. A page that throws while rendering leaves the main area empty without failing any
 * page's own test, and a rail row that cannot be reached leaves the account stuck on one application; both are shell
 * defects, so they are checked here against the edition's real assembly.
 */

// Nothing here exercises a page's own behaviour: the heavy pages are doubled and the network answers only what a page
// needs to draw, so a failure means the shell did not mount the page or the page broke while drawing.
vi.hoisted(() => { window.__APP_CONFIG__ = { API_BASE: "/custom-base/api" }; });
vi.mock("../../../../../../packages/ontology-manager/src/components/OntologyPlayground.vue", () => ({
  __esModule: true,
  default: { name: "GraphDouble", template: '<p class="page-double">graph</p>' },
}));
vi.mock("../../../../../../packages/ontology-manager/src/data-browser/DataBrowser.vue", () => ({
  __esModule: true,
  default: { name: "DataBrowserDouble", template: '<p class="page-double">data browser</p>' },
}));
// The visual modeling and governance pages pull in the graph libraries (an ES module inside a CommonJS package); they are
// doubled so the shell is exercised without them. Their own tests cover the pages.
vi.mock("../../../../../../packages/ontology-manager/src/visual-modeling/VisualModeling.vue", () => ({
  __esModule: true,
  default: { name: "VisualModelingDouble", template: '<p class="page-double">visual modeling</p>' },
}));
vi.mock("../../../../../../packages/ontology-manager/src/knowledge-governance/GovernancePage.vue", () => ({
  __esModule: true,
  default: { name: "GovernanceDouble", template: '<p class="page-double">governance</p>' },
}));
// The service status draws only from a full status report of the data engine; its own page reads it.
vi.mock("../../../../../../packages/platform-admin/src/pages/SystemMonitorPage.vue", () => ({
  __esModule: true,
  default: { name: "SystemMonitorDouble", template: '<p class="page-double">system monitor</p>' },
}));

const { isolateShellPerTest } = await import("./isolation");
const { startPlatform } = await import("../../platform");

const resetShell = isolateShellPerTest();

/**
 * The network as the pages see it. The Node API answers in its own shapes, checked against the contracts so the doubles
 * cannot drift from them: one enabled agent without sessions for the agent platform and for the diagnosis, the
 * workbench's appearance, and the app builder's agent without any workspace. Every other address answers the data
 * engine's envelope with nothing in it.
 */
const AGENT = { id: "6a1f3c52-2d0e-4c1b-9a57-0f0e7c2a9b11", name: "analysis", description: "", icon: null, enabled: true };
const NODE_ANSWERS: Readonly<Record<string, unknown>> = {
  "GET /assistant/agents": agentHostAgentListSchema.parse({ agents: [AGENT] }),
  "GET /assistant/sessions": agentHostSessionPageSchema.parse({ sessions: [], nextCursor: null }),
  "GET /observe/agent/agents": agentHostAgentListSchema.parse({ agents: [AGENT] }),
  "GET /observe/agent/sessions": agentHostSessionPageSchema.parse({ sessions: [], nextCursor: null }),
  "GET /workbench-appearance": { brand: { name: "Ontomato", subtitle: "", logo: "" } } satisfies WorkbenchAppearance,
  "GET /app-builder/bootstrap": appBuilderBootstrapSchema.parse({ agent: AGENT }),
  "GET /workspaces": { items: [] },
};
/** The data engine's answers a page needs in its own shape to draw: the domain's configuration and its adapters. */
const DATA_ENGINE_ANSWERS: Readonly<Record<string, unknown>> = {
  "GET /data-query/businessConfig/getConfig": { knowledgeMaxResult: 10, dslCookerTimeout: 300000, lang: "en", dataAdapter: "", dataAdapterConnections: {} },
  "GET /data-query/businessConfig/dataAdapters": { adapters: [], currentType: "" },
};

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function answer(input: FetchInput, init?: FetchInit): Response {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), window.location.origin);
  const key = `${init?.method ?? request?.method ?? "GET"} ${url.pathname.replace(/^\/custom-base\/api/, "")}`;
  const body = url.pathname.endsWith('/product-assets/counts')?{counts:{}}:url.pathname.endsWith("/platform/applications") ? { success: true, data: catalogFixture() }
    : key in NODE_ANSWERS ? NODE_ANSWERS[key]
      : { success: true, data: key in DATA_ENGINE_ANSWERS ? DATA_ENGINE_ANSWERS[key] : [] };
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/**
 * What broke while the shell drew the current page: a component's setup, render or update (Vue hands those to the app's
 * error handler) or an error thrown to the window. Every test ends with none.
 */
let drawErrors: unknown[] = [];
window.addEventListener("error", (event) => drawErrors.push(event.error ?? event.message));

/** Every address the running router serves, read after each start. */
let served = new Set<string>();

async function settle() {
  for (let index = 0; index < 10; index += 1) {
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function open(path: string) {
  resetShell();
  drawErrors = [];
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, "", new URL(`/#${path}`, window.location.origin));
  startPlatform();
  // The app mounts synchronously and its first navigation resolves afterwards, so every page the router draws reports
  // its errors here instead of to the console.
  const app = (document.querySelector("#app") as (Element & { __vue_app__?: App }) | null)?.__vue_app__;
  app!.config.errorHandler = (error) => drawErrors.push(error);
  await settle();
  type Router = { getRoutes(): { path: string }[] };
  const router = app?.config.globalProperties.$router as Router | undefined;
  // A route pattern carries parameters (`/browser/data/:className?`); a rail row opens the address with them absent, so
  // each pattern is recorded up to its first parameter.
  served = new Set((router?.getRoutes() ?? []).map((route) => route.path.split("/:")[0]!).filter(Boolean));
}

/** The address in the bar, without the query: that is what a rail row navigates to. */
const landedAt = () => window.location.hash.replace(/^#/, "").split("?")[0]!;

/** Every page address the applications own in this edition, deduplicated in rail order, their columns' feet included. */
const pagePaths = [
  ...new Set(
    appPartition()
      .flatMap((app) => [...app.sections.flatMap((section) => section.paths), ...(app.foot ? [app.foot] : [])])
      // The addresses are route patterns; the ones with parameters are covered by their own page tests.
      .filter((path) => !path.includes(":"))
      // The licence is the enterprise edition's page: this edition's navigation holds no such page, so no column lists it.
      .filter((path) => path !== platformRoutes.license.path)
  ),
];

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.__APP_CONFIG__ = { API_BASE: "/custom-base/api/", INITIAL_ROUTE: "" };
  vi.stubGlobal("fetch", async (input: FetchInput, init?: FetchInit) => answer(input, init));
});

afterEach(() => {
  expect(drawErrors, "a page broke while the shell drew it").toEqual([]);
});

describe.each(pagePaths)("the open-source platform at %s", (path) => {
  it("draws the page into the main area", async () => {
    await open(path);

    // Either the page's own content or a page that draws no text but does draw its region: both mean the route filled
    // the main area. An empty main area is the failure this test exists for.
    const body = document.querySelector(".platform-page-body");
    expect(body, `no main area at ${path}`).not.toBeNull();
    expect(body!.innerHTML.trim(), `empty main area at ${path}`).not.toBe("");
    expect(drawErrors, `a page broke while drawing ${path}`).toEqual([]);
  });

  /*
   * An address no route serves falls through to the conversation, which also fills the main area: only the address
   * shows that the page itself was drawn (the enterprise edition lost its dashboards route this way, 2026-11-06). The page
   * stays at its address or at one of its own screens under it.
   */
  it("stays at its own address", async () => {
    await open(path);
    const landed = landedAt();
    expect(landed === path || landed.startsWith(`${path}/`), `${path} landed on ${landed}`).toBe(true);
  });
});

describe("object views over plain HTTP", () => {
  it("opens an unconfigured object and leaves its view editor without a secure-context UUID API", async () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const attrs = [{ name: "id", primaryKey: true }, { name: "name", bizzkeyBool: true }];
    vi.stubGlobal("fetch", async (input: FetchInput, init?: FetchInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      const data = /\/objectView\/(read|edit)$/.test(url.pathname) ? { revision: 0, publishedRevision: null, versions: [] }
        : url.pathname.endsWith("/getMetas") ? { classDef: [{ className: "Order", attrs }, { className: "Person", attrs }] }
        : url.pathname.endsWith("/queryInfoByNode") ? { classDef: { attrs }, data: { id: "order-1", name: "HTTP order" } }
        : undefined;
      if (url.pathname.endsWith("/skills")) return new Response(JSON.stringify({ skills: [] }));
      return data === undefined ? answer(input, init) : new Response(JSON.stringify({ success: true, data }));
    });
    try {
      await open("/browser/views/Order?key=order-1");
      expect(document.querySelector(".object-title h2")?.textContent).toBe("HTTP order");
      expect(document.querySelector(".object-view-runtime")).not.toBeNull();
      expect(document.querySelector(".object-page-error")).toBeNull();
      const app = (document.querySelector("#app") as Element & { __vue_app__: App }).__vue_app__;
      const router = app.config.globalProperties.$router as Router;
      await router.push("/ontology/objects/Order/view");
      await settle();
      expect(document.querySelector(".view-builder")).not.toBeNull();
      expect(document.querySelector(".builder-body")?.hasAttribute("inert")).toBe(false);
      await router.push("/ontology/objects/Person/view");
      await settle();
      expect(landedAt()).toBe("/ontology/objects/Person/view");
      await router.push("/dashboards");
      await settle();
      expect(landedAt()).toBe("/dashboards");
      expect(document.querySelector(".view-builder")).toBeNull();
      expect(document.querySelector(".platform-page-body")?.innerHTML.trim()).toBeTruthy();
      expect(drawErrors).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("the open-source platform's old capability library links", () => {
  /*
   * The capability library's addresses, from the agents page's `?tab=capabilities` to the settings' own skill and MCP
   * screens, outlive it in bookmarks: skills are the ontology manager's now, external MCP services the system settings'.
   */
  it.each([
    ["/agents?tab=capabilities", platformRoutes.ontologySkills.path],
    ["/agents/settings?tab=capabilities", platformRoutes.ontologySkills.path],
    ["/agents/settings/capabilities", platformRoutes.ontologySkills.path],
    ["/agents/settings/skills", platformRoutes.ontologySkills.path],
    ["/agents/settings/mcp", platformRoutes.externalMcp.path],
  ])("%s lands on %s", async (path, target) => {
    await open(path);
    expect(window.location.hash).toBe(`#${target}`);
  });
});

describe("the open-source platform's conversations", () => {
  // The acceptance run found the agent platform drawing its shell but no conversation to type into.
  it.each(["/agents/chat", "/ops/diagnosis"])("%s draws a conversation one can type into", async (path) => {
    await open(path);
    expect(
      document.querySelector(".platform-page-body form.composer textarea:not([disabled])"),
      `no composer at ${path}`
    ).not.toBeNull();
  });
});

describe("the open-source platform's former settings addresses", () => {
  it("forwards the former parent pages' addresses to their first page", async () => {
    await open("/settings/model-config");
    expect(landedAt()).toBe("/settings/model-config/usage");
    await open("/settings/system-config");
    expect(landedAt()).toBe("/settings/system-config/general");
    await open("/settings/records");
    expect(landedAt()).toBe("/settings/records/audit-log");
  });

});

describe("the open-source platform's column", () => {
  it("draws the operations application's model page at its own address", async () => {
    await open("/ops/model");
    expect(landedAt()).toBe("/ops/model");
    expect(document.querySelector(".platform-page-body")!.innerHTML.trim()).not.toBe("");
  });
});

describe("the open-source platform's rail", () => {
  it("opens a page this edition serves for every application", async () => {
    await open("/ontology/objects");
    // Every row on the rail that switches the shell opens somewhere. The personal workspace keeps its address while
    // its rail entry is hidden for now.
    const rows = [...document.querySelectorAll<HTMLElement>(".rail-row:not(.external):not(.unavailable)")];
    expect(rows.length).toBeGreaterThan(1);

    let previous = landedAt();
    for (const row of rows) {
      const before = previous;
      row.click();
      await settle();
      const landed = landedAt();
      const name = row.textContent?.trim();
      // Which address an application opens is its own decision; what must hold is that the row leaves the current page
      // and lands on one this edition serves. A row aimed at an address with no route falls through to the catch-all and
      // stays where it was, which is how clicking 智能体平台 and 运维诊断 once did nothing.
      expect(landed, `the rail row ${name} did not leave ${before}`).not.toBe(before);
      expect(served.has(landed), `the rail row ${name} opened ${landed}, which this edition does not serve`).toBe(true);
      expect(document.querySelector(".platform-page-body")!.innerHTML.trim(), `empty main area after ${name}`).not.toBe("");
      previous = landed;
    }
  });
});
