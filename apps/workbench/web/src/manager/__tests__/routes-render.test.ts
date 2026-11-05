import { beforeEach, describe, expect, it, vi } from "vitest";
import { appPartition } from "../../../../../../packages/platform-web/src/app-partition";

/*
 * What this guards: every address an application owns draws that page into the platform's main area, and the rail
 * switches between applications. A page that throws while rendering leaves the main area empty without failing any
 * page's own test, and a rail row that cannot be reached leaves the account stuck on one application; both are shell
 * defects, so they are checked here against the edition's real assembly.
 */

// Nothing here exercises a page's own behaviour: the network answers "nothing" and the heavy pages are doubled, so a
// failure means the shell did not mount the page, not that a page's data was missing.
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
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, "", new URL(`/#${path}`, window.location.origin));
  startPlatform();
  await settle();
  type Router = { getRoutes(): { path: string }[] };
  const router = (document.querySelector("#app") as unknown as {
    __vue_app__?: { config: { globalProperties: { $router: Router } } };
  } | null)?.__vue_app__?.config.globalProperties.$router;
  // A route pattern carries parameters (`/browser/data/:className?`); a rail row opens the address with them absent, so
  // each pattern is recorded up to its first parameter.
  served = new Set((router?.getRoutes() ?? []).map((route) => route.path.split("/:")[0]!).filter(Boolean));
}

/** The address in the bar, without the query: that is what a rail row navigates to. */
const landedAt = () => window.location.hash.replace(/^#/, "").split("?")[0]!;

/** Every page address the applications own, deduplicated in rail order. */
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
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
});

describe.each(pagePaths)("the open-source platform at %s", (path) => {
  it("draws the page into the main area", async () => {
    const thrown: unknown[] = [];
    const onError = (event: ErrorEvent) => thrown.push(event.error ?? event.message);
    window.addEventListener("error", onError);
    await open(path);
    window.removeEventListener("error", onError);

    // Either the page's own content or a page that draws no text but does draw its region: both mean the route filled
    // the main area. An empty main area is the failure this test exists for.
    const body = document.querySelector(".platform-page-body");
    expect(body, `no main area at ${path}`).not.toBeNull();
    expect(body!.innerHTML.trim(), `empty main area at ${path}`).not.toBe("");
    expect(thrown, `a page threw while rendering ${path}`).toEqual([]);
  });
});

describe("the open-source platform's column", () => {
  it("opens the diagnosis model's own page from the column's foot", async () => {
    await open("/ops/diagnosis");
    const entry = document.querySelector<HTMLElement>(".panel-footer .settings-row");
    expect(entry, "the operations column has no model setting").not.toBeNull();
    entry!.click();
    await settle();
    // Choosing the model belongs to the model settings page; the entry used to open the diagnosis home instead.
    expect(landedAt()).toBe("/settings/model-config/usage");
  });
});

describe("the open-source platform's rail", () => {
  it("opens a page this edition serves for every application", async () => {
    await open("/");
    // The rail lists the applications in the partition's order; an application without an external link or an
    // unavailability hint is a row that switches the shell.
    const switching = appPartition().filter((app) => app.sections.length > 0);
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
