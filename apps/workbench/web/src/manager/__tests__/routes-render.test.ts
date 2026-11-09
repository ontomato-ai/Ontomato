import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "vue";
import { agentHostAgentListSchema, agentHostSessionPageSchema } from "@ontomato/contracts/agent-host";
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

const { isolateShellPerTest } = await import("./isolation");
const { startPlatform } = await import("../../platform");

const resetShell = isolateShellPerTest();

/**
 * The network as the pages see it. The Node API answers in its own shapes, checked against the contracts so the doubles
 * cannot drift from them: one enabled agent without sessions for the agent platform and for the diagnosis, and the
 * workbench's appearance. Every other address answers the data engine's envelope with nothing in it.
 */
const AGENT = { id: "6a1f3c52-2d0e-4c1b-9a57-0f0e7c2a9b11", name: "analysis", description: "", icon: null, enabled: true };
const NODE_ANSWERS: Readonly<Record<string, unknown>> = {
  "GET /assistant/agents": agentHostAgentListSchema.parse({ agents: [AGENT] }),
  "GET /assistant/sessions": agentHostSessionPageSchema.parse({ sessions: [], nextCursor: null }),
  "GET /observe/agent/agents": agentHostAgentListSchema.parse({ agents: [AGENT] }),
  "GET /observe/agent/sessions": agentHostSessionPageSchema.parse({ sessions: [], nextCursor: null }),
  "GET /workbench-appearance": { brand: { name: "Ontomato", subtitle: "", logo: "" } } satisfies WorkbenchAppearance,
};

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function answer(input: FetchInput, init?: FetchInit): Response {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), window.location.origin);
  const key = `${init?.method ?? request?.method ?? "GET"} ${url.pathname.replace(/^\/custom-base\/api/, "")}`;
  const body = key in NODE_ANSWERS ? NODE_ANSWERS[key] : { success: true, data: url.pathname.endsWith("/platform/applications") ? catalogFixture() : [] };
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

/** Every page address the applications own in this edition, deduplicated in rail order. */
const pagePaths = [
  ...new Set(
    appPartition()
      .flatMap((app) => app.sections.flatMap((section) => section.paths))
      // The addresses are route patterns; the ones with parameters are covered by their own page tests.
      .filter((path) => !path.includes(":"))
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

describe("the open-source platform's old capability library links", () => {
  /*
   * Before the library had an address of its own it was the agents page's `?tab=capabilities`. Opening such a bookmark
   * (which is also what reloading it does) once landed on the conversation or on the first agent's editor instead (128
   * acceptance, 2026-11-06); it lands on the library's address, so a later reload stays there.
   */
  it.each(["/agents?tab=capabilities", "/agents/settings?tab=capabilities"])("%s lands on the capability library", async (path) => {
    await open(path);
    expect(window.location.hash).toBe(`#${platformRoutes.agentSettingsCapabilities.path}`);
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

describe("the open-source platform's page headers", () => {
  it("switches the system settings' three screens in the application's header", async () => {
    await open("/settings/records/audit-log");
    // An application of several pages is one header with its pages as tabs; the page keeps its own second-level tabs.
    const tabs = [...document.querySelectorAll(".platform-page-header .page-tab")].map((tab) => tab.textContent?.trim());
    // The page under the application is named for what it holds; repeating the application's own name says nothing.
    expect(tabs).toEqual(["Models", "General settings", "Run Records"]);
    expect(document.querySelector(".platform-page-header .page-tab.active")?.textContent?.trim()).toBe("Run Records");
  });

  it("gives a single-page application its header and its page, with no tabs", async () => {
    await open("/dashboards");
    expect(document.querySelector(".platform-page-header .page-title")?.textContent).toBe("Dashboards");
    expect(document.querySelector(".platform-page-header .page-tab")).toBeNull();
    // The page draws no second title: the header is the only one.
    expect(document.querySelector(".dashboards-application h1")).toBeNull();
  });

  it("names the object browser in its header though this edition gives it one page", async () => {
    await open("/browser/data");
    // The same header as the enterprise edition's, without the tabs: the application's name and its line.
    const header = document.querySelector(".platform-page-header");
    expect(header?.querySelector(".page-title")?.textContent).toBe("Object browser");
    expect(header?.querySelector(".page-description")?.textContent?.trim()).toBeTruthy();
    expect(header?.querySelector(".page-tab")).toBeNull();
    // The data browser draws no header of its own, so the platform's page body around it carries the page gutter.
    expect(document.querySelector(".platform-page-body")?.classList.contains("own-header")).toBe(false);
  });
});

describe("the open-source platform's column", () => {
  /*
   * The platform draws no column of its own, so nothing here can be opened from the shell. The operations application
   * draws its own column, and its model page is the foot of it; that is the page this checks, reached by its address.
   */
  it("draws the operations application's own model page", async () => {
    await open("/ops/model");
    expect(landedAt()).toBe("/ops/model");
    const body = document.querySelector(".platform-page-body")!.innerHTML;
    expect(body).not.toBe("");
    // The model the diagnosis runs on is the operations application's own page, not the platform's model division
    // (model-config), which answers a different question and needs a different permission.
    expect(body).toContain("diagnosis-model");
  });
});

describe("the open-source platform's rail", () => {
  it("lists this edition's applications, in the three sections of the rail", async () => {
    await open("/");
    // Written out rather than derived from the partition: the point is that this edition shows these and no others (the
    // permissions application and the data governance platform exist only in the enterprise edition).
    document.querySelector<HTMLButtonElement>(".rail-toggle")!.click();
    await settle();
    const sections = [...document.querySelectorAll(".rail-scroll > *")].reduce<string[][]>(
      (all, node) => {
        if (node.classList.contains("rail-divider")) all.push([]);
        else all[all.length - 1]!.push(...[...node.querySelectorAll(".rail-label")].map((row) => row.textContent ?? ""));
        return all;
      },
      [[]],
    );
    // The foot is a section of its own, above the account and outside the scrolling area.
    sections.push([...document.querySelectorAll(".rail-foot .rail-label")].map((row) => row.textContent ?? ""));
    const catalog = catalogFixture();
    expect(sections).toEqual(["top", "apps", "bottom"].map(rail => catalog.filter(app => app.rail === rail).map(app => app.names.en)));
    // The platform's own applications sit at the foot of the rail, above the account, not under the applications.
    expect(document.querySelector(".rail-foot .rail-label")?.textContent).toBe("System settings");
  });

  it("opens a page this edition serves for every application", async () => {
    await open("/ontology/objects");
    // The rail lists the applications in the partition's order; an application without an external link or an
    // unavailability hint is a row that switches the shell. Every one of them opens somewhere.
    const switching = appPartition();
    const rows = [...document.querySelectorAll<HTMLElement>(".rail-row:not(.external):not(.unavailable)")];
    expect(rows.length).toBe(switching.length);

    let previous = landedAt();
    for (const [index, app] of switching.entries()) {
      const before = previous;
      rows[index].click();
      await settle();
      const landed = landedAt();
      // Which address an application opens is its own decision; what must hold is that the row leaves the current page
      // and lands on one this edition serves. A row aimed at an address with no route falls through to the catch-all and
      // stays where it was, which is how clicking 智能体平台 and 运维诊断 once did nothing.
      expect(landed, `the rail row of ${app.id} did not leave ${before}`).not.toBe(before);
      expect(served.has(landed), `the rail row of ${app.id} opened ${landed}, which this edition does not serve`).toBe(true);
      expect(document.querySelector(".platform-page-body")!.innerHTML.trim(), `empty main area in ${app.id}`).not.toBe("");
      previous = landed;
    }
  });
});
