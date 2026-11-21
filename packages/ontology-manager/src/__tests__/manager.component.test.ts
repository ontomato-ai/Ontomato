import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, toRef, watch, type App } from "vue";
import { ElConfigProvider } from "element-plus";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { createManager, type ManagerPresentation, type ManagerTheme } from "../context";
import type { ManagerCredential, ManagerDataFallbacks } from "../api";
import { englishMessages, managerMessageTree, type ManagerMessages } from "../i18n";
import { managerRoutes } from "../routes";
import { managerNavigation } from "../navigation";
import de from "element-plus/es/locale/lang/de";
import en from "element-plus/es/locale/lang/en";
import { graphHandlers, graphRecord } from "./graph-double";
import type { DataAdapterInfo } from "@ontomato/contracts/data-adapters";

// Only the graph library internals are doubled; the routes, frame, pages, request client and fetch calls are real code.
vi.mock("@antv/g6", async () => ({ Graph: (await import("./graph-double")).GraphDouble }));
vi.mock("@antv/x6", async () => ({
  Graph: (await import("./graph-double")).GraphDouble,
  Node: class {},
  Edge: class {},
}));

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

let requests: Recorded[];
let mountedApps: App[];
/** Responses held by path suffix: the test decides when and with what they return. */
let held: Map<string, { resolve: (response: Response) => void }[]>;
let holdPaths: Set<string>;
let statusFor: (path: string) => number;
let metasFor: (url: string) => unknown;
let metricDetail: Record<string, unknown>;
let dataAdapter: string;
let instanceNodeCount: number;
let largeOverview: boolean;
let dataAdapters: DataAdapterInfo[];
let objectTypeChanges: Record<string, { showName?: string; classDesc?: string }>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const metas = (classes: string[]) => ({
  success: true,
  data: {
    classDef: classes.map((className) => ({
      className,
      showName: `${className}-label`,
      classDesc: `${className} desc`,
      attrs: [{ name: "id", showName: "ID", type: "string" }],
    })),
    relationship_rule: { has: { fromclass: "Order", toclass: "Item", desc: "has" } },
  },
});

function respond(url: string, body?: Record<string, unknown>, method = "POST"): Response {
  const path = url.replace(/^.*\/data-query/, "");
  const status = statusFor(path);
  if (status !== 200) return json({ success: false }, status);
  if (path === "/admin/getMetas") {
    const state = metasFor(url) as { data: { classDef: Record<string, unknown>[] } };
    for (const [className, changes] of Object.entries(objectTypeChanges)) {
      const classDef = state.data.classDef.find((item) => item.className === className);
      if (classDef) Object.assign(classDef, changes);
    }
    return json(state);
  }
  if (path === "/ontology/model/object-type/create" && method === "POST") {
    return json({
      className: body?.className,
      showName: body?.showName,
      classDesc: body?.classDesc,
      attributeCount: 1,
      businessKeyCount: 0,
      relationshipCount: 0,
      primaryKey: { status: "ok", name: body?.primaryKeyName },
    }, 201);
  }
  if (path === "/ontology/model/object-type/update" && method === "POST") {
    const className = String(body?.className);
    objectTypeChanges[className] = {
      showName: body?.showName as string,
      classDesc: body?.classDesc as string,
    };
    return json({ className, ...objectTypeChanges[className] });
  }
  if (path === "/ontology/model/object-type/delete" && method === "POST") {
    delete objectTypeChanges[String(body?.className)];
    return json({ relationships: [] });
  }
  if (path === "/ontology/model/relationship/update" && method === "POST") {
    const name = String(body?.relationship);
    const state = metasFor(url) as { data: { relationship_rule: Record<string, Record<string, unknown>> } };
    Object.assign(state.data.relationship_rule[name], {
      desc: body?.desc,
      fromField: body?.fromField,
      toField: body?.toField,
    });
    return json({ relationship: name, ...body });
  }
  if (path === "/ontology/model/relationship/delete" && method === "POST") {
    const name = String(body?.relationship);
    const state = metasFor(url) as { data: { relationship_rule: Record<string, Record<string, unknown>> } };
    delete state.data.relationship_rule[name];
    return json({});
  }
  if (path === "/ontology/model/relationship/create" && method === "POST") {
    return json({ relationship: body?.relationship, ...body }, 201);
  }
  if (path.startsWith("/ontology/model/attribute/")) {
    return json({});
  }
  if (path === "/objectView/read" || path === "/objectView/edit" || url.includes('/product-assets/object-views/read')||url.includes('/product-assets/object-views/edit')) return json({ success: true, data: { revision: 0, publishedRevision: null, versions: [] } });
  if (path === "/metricView/queryList") return json({ success: true, data: [
    { id: "metric-1", name: "Revenue metric", status: "PUBLISHED", origin: "USER" },
  ] });
  if (path === "/metricView/queryById") return json({ success: true, data: metricDetail });
  if (path === "/metricView/save") {
    metricDetail = { ...body, bindings: (body?.bindings as Record<string, unknown>[]).map((binding, index) => ({
      ...binding, id: binding.id || `binding-${index}`,
    })) };
    return json({ success: true, data: metricDetail });
  }
  if (path === "/metricView/test") return json({ success: true, data: {
    md: "# Revenue\n\n| Month | Total |\n| --- | ---: |\n| Jan | 42 |",
  } });
  if (path === "/data/instanceGraph/connections") return json({ success: true, data: {
    overviewEdges: [{ source: "Order:1", target: "Item:2", type: "has" }], overviewEdgesTruncated: false, version: "v1",
  } });
  if (path === "/data/instanceGraph/nodes") return json({ success: true, status: "READY", data: {
    classes: [{ class: "Order", instanceCount: instanceNodeCount }, { class: "Item", instanceCount: 1 }],
    relationships: [{ source: "Order", target: "Item", count: 1 }],
    relationTypes: ["has"],
    overviewNodes: largeOverview ? Array.from({length: 1000}, (_, index) => ({ id: `Order:${index + 1}`, name: `Order ${index + 1}`, class: "Order" })) : [{ id: "Order:1", name: "First order", class: "Order" }, { id: "Item:2", name: "Spare part", class: "Item" }],
    overviewEdges: [{ source: "Order:1", target: "Item:2", type: "has" }],
    nodeCount: instanceNodeCount, edgeCount: 1, componentCount: 1, isolatedNodeCount: 0,
    largestComponentSize: instanceNodeCount, version: "v1", generatedAt: "2026-10-10T00:00:00Z",
  } });
  if (path === "/data/instanceGraph/search") return json({ success: true, status: "READY", data: {
    nodes: [{ id: "Item:2", name: "Spare part", class: "Item" }], hasMore: false, version: "v1",
  } });
  if (path === "/data/instanceGraph/neighborhood") return json({ success: true, status: "READY", data: {
    nodes: [{ id: "Item:2", name: "Spare part", class: "Item" }, { id: "Order:1", name: "First order", class: "Order" }],
    edges: [{ source: "Order:1", target: "Item:2" }], total: 1, nextOffset: null, version: "v1",
  } });
  if (path === "/data/queryInfoByNode")
    return json({ success: true, data: {
      classDef: { attrs: [{ name: "id", showName: "ID" }] },
      data: { id: body?.id },
    } });
  if (path === "/data/getWholeClassDataByPage")
    return json({ success: true, data: [{ id: "row-1" }], total_count: 1 });
  if (path === "/businessConfig/dataAdapters") {
    return json({ success: true, data: { currentType: dataAdapter, adapters: dataAdapters } });
  }
  if (path.endsWith("/queryList")) return json({ success: true, data: [] });
  return json({ success: true, data: {} });
}

beforeEach(() => {
  for (const name of Object.keys(graphHandlers)) delete graphHandlers[name];
  graphRecord.options = [];
  graphRecord.addedNodes = [];
  graphRecord.zoom = 1;
  graphRecord.zoomTo = [];
  graphRecord.focusElement = [];
  graphRecord.states = [];
  graphRecord.dataBatches = [];
  graphRecord.layouts = [];
  graphRecord.nodeUpdates = [];
  graphRecord.edgeUpdates = [];
  instanceNodeCount = 2;
  largeOverview = false;
  requests = [];
  mountedApps = [];
  held = new Map();
  holdPaths = new Set();
  objectTypeChanges = {};
  statusFor = () => 200;
  metasFor = () => metas(["Order", "Item"]);
  metricDetail = { id: "metric-1", name: "Revenue metric", status: "PUBLISHED", origin: "USER",
    function: { name: "Revenue", operation: "OPERATION_READ", parameters: [], returnDef: { classNames: [] } }, bindings: [] };
  dataAdapter = "mysql";
  dataAdapters = [
    { type: "m3", label: "M3", requiresJoinFields: false, fields: [], examples: {} },
    { type: "mysql", label: "MySQL", requiresJoinFields: true, fields: ["url", "user", "password"], examples: {} },
    { type: "elasticsearch", label: "Elasticsearch", requiresJoinFields: true, fields: ["url", "user", "password"], examples: {} },
  ];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    const path = url.replace(/^.*\/data-query/, "");
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    requests.push({
      url,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body,
    });
    if (holdPaths.has(path)) {
      return new Promise<Response>((resolve) => {
        const waiting = held.get(path) ?? [];
        waiting.push({ resolve: () => resolve(respond(url, body, String(init.method))) });
        held.set(path, waiting);
      });
    }
    return Promise.resolve(respond(url, body, String(init.method)));
  });
});

afterEach(() => {
  mountedApps.forEach((app) => app.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
  document.body.innerHTML = "";
});

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    // Heavy pages are async components: wait for their dynamic imports as well as pending requests.
    await vi.dynamicImportSettled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
}

interface HostOptions {
  apiBase: string;
  credential: ManagerCredential;
  locale: string;
  theme: ManagerTheme;
  view: string;
  dataFallbacks: ManagerDataFallbacks;
  presentation: ManagerPresentation;
}

/**
 * A page around the Manager pages as the service app assembles it: one router (memory history) with the Manager routes
 * under a layout, one vue-i18n over the Manager messages, and the Manager installed with the page's theme and locale.
 * `host.view` navigates, `host.theme`/`host.locale` change the page's preferences; `views` records every address.
 */
function mountHost(initial: HostOptions) {
  const host = reactive({ ...initial });
  const views: string[] = [];
  const failures: number[] = [];
  const i18n = createI18n({
    legacy: false,
    locale: host.locale,
    fallbackLocale: "en",
    missingWarn: false,
    fallbackWarn: false,
    messages: { en: managerMessageTree(englishMessages), de: managerMessageTree(markedMessages("[de] ")) } as never,
  });
  const page = i18n.global as unknown as {
    locale: { value: string };
    t: (key: string, params: Record<string, string | number>) => string;
  };
  watch(
    () => host.locale,
    (locale) => (page.locale.value = locale)
  );
  const manager = createManager({
    apiBase: host.apiBase,
    credential: host.credential,
    theme: toRef(host, "theme"),
    locale: toRef(host, "locale"),
    translate: (key, params) => page.t(key, params ?? {}),
    dataFallbacks: host.dataFallbacks,
    presentation: host.presentation,
    onAuthFailure: (status) => failures.push(status),
  });
  // The page opens at the address under test (the router starts from the history's location when installed).
  const history = createMemoryHistory();
  history.replace(host.view);
  const router = createRouter({
    history,
    routes: [
      { path: "/", component: RouterView, children: managerRoutes() },
      // The graph address is the host's panel entry now (the graph is a built-in panel); the Manager only links to it.
      { path: "/ontology/playground", component: defineComponent({ render: () => h("div", { class: "graph-panel-entry" }) }) },
      // The service router sends unknown addresses to its root, which lands on the graph.
      { path: "/:unknown(.*)*", redirect: "/ontology/playground" },
    ],
  });
  router.afterEach((to) => {
    views.push(to.fullPath);
    host.view = to.fullPath;
  });
  watch(
    () => host.view,
    (view) => {
      if (view !== router.currentRoute.value.fullPath) void router.push(view);
    }
  );
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(ElConfigProvider, { locale: host.locale === "de" ? de : en }, () =>
          h("div", { class: "page-area" }, [h(RouterView)])
        ),
    })
  );
  app.use(i18n);
  app.use(router);
  manager.install(app);
  const element = document.createElement("div");
  document.body.appendChild(element);
  app.mount(element);
  mountedApps.push(app);
  /** The platform's menu beside the page, showing the Manager's counts: what reads them. */
  const showMenu = () => managerNavigation(manager.counts).pages.forEach((page) => page.count?.());
  return { host, views, failures, showMenu, root: () => element.querySelector(".ontology-manager")! };
}

/** Host-supplied data defaults that differ from the open-source values, so the tests can tell which one was used. */
const hostFallbacks = { noBusinessDescription: "Host: no description", unnamedAsset: "Host: unnamed asset" };

/** A pseudo-locale for switching tests: the English messages with a marker, standing in for any translation. */
function markedMessages(marker: string): ManagerMessages {
  const mark = (table: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(table).map(([key, value]) => [key, `${marker}${value}`]));
  return {
    ontology: mark(englishMessages.ontology),
    shared: Object.fromEntries(
      Object.entries(englishMessages.shared).map(([group, table]) => [group, mark(table)])
    ),
  } as ManagerMessages;
}

/** The page's language (the widget locale follows it). */
const english = { locale: "en" };
const german = { locale: "de" };

/** Test presentation values: only used to recognise that the component reads them from the host; they are not either product's values (those are checked by the app presentation and evidence audit). */
const presentation: ManagerPresentation = {
  themeProperties: {
    light: { "--el-color-primary": "#101010", "--manager-filter-drawer-radius": "2px" },
    dark: { "--el-color-primary": "#e0e0e0", "--manager-filter-drawer-radius": "3px" },
  },
  nodePalette: { light: ["#000001", "#000002", "#000003"], dark: ["#000004", "#000005", "#000006"] },
  maxFitZoom: null,
  dataBrowserDescription: (objectLabel) => `description of ${objectLabel}`,
  compactDialogs: false,
};

const base: HostOptions = {
  apiBase: "/tenant-a/api",
  credential: { type: "apiKey", apiKey: "key-a" },
  ...english,
  theme: "light",
  view: "/ontology/objects",
  dataFallbacks: hostFallbacks,
  presentation,
};

const paths = (list = requests) =>
  list.map((request) => request.url.replace(/^.*\/data-query/, ""));

function clickButton(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text || item.querySelector("span")?.textContent === text
  );
  if (!button) throw new Error(`Button not found: ${text}`);
  button.click();
}

describe("Manager pages in the service router", () => {
  it("opens the routed object view fallback and its type-level editor", async () => {
    const { root, views } = mountHost({ ...base, view: "/browser/views/Order?key=001" });
    await settle();
    expect(root().querySelector(".object-view-runtime")).not.toBeNull();
    expect(requests.find(request => request.url.endsWith("/product-assets/object-views/read"))?.body).toMatchObject({ className: "Order", form: "full" });
    clickButton("Configure view");
    await settle();
    expect(views.at(-1)).toContain("/ontology/objects/Order/view");
    expect(root().querySelector(".view-builder")).not.toBeNull();
  });
  it("a 50,000-instance graph initially loads only the type summary", async () => {
    instanceNodeCount = 50000;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800, height: 600,
    } as DOMRect);
    const { root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await settle();
    await settle();
    const options = graphRecord.options.at(-1);
    expect(options.data.nodes ?? []).toEqual([]);
    expect(options.data.edges ?? []).toEqual([]);
    expect(options.layout).toBeUndefined();
    // Only the overview sample is drawn, not the 50,000 instances.
    expect(graphRecord.dataBatches.flatMap((batch) => batch.nodes || []).filter((node: any) => !node.data.anchor).map((node: any) => node.id))
      .toEqual(["Order:1", "Item:2"]);
    expect(paths()).toContain("/data/instanceGraph/nodes");
    expect(root().querySelector(".node-search input")?.hasAttribute("disabled")).toBe(false);

    (root().querySelector(".graph-toolbar button[aria-label='Relayout']") as HTMLButtonElement).click();
    await settle();
    await settle();
    expect(graphRecord.layouts.length).toBe(0);
  });

  it("expands neighbors beyond a full overview and adds an anchor for a newly encountered class", async () => {
    largeOverview = true;
    instanceNodeCount = 50000;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const { root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await vi.waitFor(async () => {
      await settle();
      expect(graphRecord.dataBatches.flatMap(batch => batch.nodes || []).filter((node: any) => !node.data.anchor).length).toBe(1000);
    }, { timeout: 10000 });
    graphHandlers["node:click"]({ target: { id: "Order:1" } });
    await settle();
    (root().querySelector(".node-actions button") as HTMLButtonElement).click();
    await settle();
    expect(requests.some(request => request.url.endsWith("/instanceGraph/neighborhood"))).toBe(true);
    const graphNodes = graphRecord.dataBatches.flatMap(batch => batch.nodes || []);
    expect(graphNodes.some((node: any) => node.id === "Item:2")).toBe(true);
    expect(graphNodes.some((node: any) => node.id === 'overview-class:"Item"')).toBe(true);
  }, 20000);

  it("aggregates overview connections by default and reveals selected instance connections", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const { root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await settle();
    await settle();
    const graphEdges = () => graphRecord.dataBatches.flatMap((batch) => batch.edges || []);
    const graphNodes = () => graphRecord.dataBatches.flatMap((batch) => batch.nodes || []);
    expect(graphEdges()).toHaveLength(1);
    const aggregatedEdge = graphEdges()[0];
    expect(aggregatedEdge.id).toMatch(/^overview-relation:/);
    expect(aggregatedEdge.style.labelText).toBe("has · 1");
    expect([aggregatedEdge.source, aggregatedEdge.target]).toEqual(['overview-class:"Order"', 'overview-class:"Item"']);
    (root().querySelector(".graph-toolbar button[aria-label='Display settings']") as HTMLButtonElement).click();
    await settle();
    expect(root().querySelector(".graph-display-settings [role='switch'][aria-label='Aggregate connections']")?.getAttribute("aria-checked")).toBe("true");
    expect(root().querySelector("button[aria-label='Center on this instance']")).toBeNull();
    graphHandlers["node:click"]({ target: { id: "Order:1" } });
    await settle();
    expect(graphEdges()).toHaveLength(2);
    const faded = aggregatedEdge.style.opacity;
    expect(faded).toBeLessThan(1);
    graphHandlers["canvas:click"]({});
    await settle();
    expect(graphEdges()).toEqual([aggregatedEdge]);
    expect(aggregatedEdge.style.opacity).toBeGreaterThan(faded);
    graphHandlers["canvas:click"]({});
    await settle();
    expect(graphEdges()).toEqual([aggregatedEdge]);
    (root().querySelector(".graph-display-settings [role='switch'][aria-label='Aggregate connections']") as HTMLElement).click();
    await settle();
    expect(graphEdges()).toEqual([expect.objectContaining({ source: "Order:1", target: "Item:2" })]);
    expect(graphEdges()[0].id).not.toMatch(/^overview-relation:/);
    graphHandlers["node:click"]({ target: { id: "Order:1" } });
    await settle();
    const neighborhoodButton = root().querySelector(".node-actions button[aria-label='View instance and direct neighbors']") as HTMLButtonElement;
    expect(neighborhoodButton).not.toBeNull();
    neighborhoodButton.click();
    await settle();
    await settle();
    const neighborhoodRequest = requests.filter((request) => request.url.endsWith("/data/instanceGraph/neighborhood")).at(-1);
    expect(neighborhoodRequest?.body).toMatchObject({ id: "Order:1", offset: 0 });
    expect(neighborhoodRequest?.body?.direction).toBeUndefined();
    // The neighbourhood replaces the overview: its instances and their edge, without the class anchors.
    expect(graphNodes().map((node: any) => node.id).sort()).toEqual(["Item:2", "Order:1"]);
    expect(graphEdges()).toEqual([expect.objectContaining({ source: "Order:1", target: "Item:2" })]);
    const back = root().querySelector<HTMLButtonElement>(".instance-graph > .back-to-overview");
    back!.click();
    await settle();
    await settle();
    expect(root().querySelector(".back-to-overview")).toBeNull();
    expect(root().querySelector(".sample-legend")).not.toBeNull();
  });

  it("instance graph search opens direct neighbors and focuses the result without stale record details", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800, height: 600,
    } as DOMRect);
    const { root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await settle();

    const input = root().querySelector<HTMLInputElement>(".instance-search input")!;
    expect(input).not.toBeNull();
    input.focus();
    input.value = "spare";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // The search is debounced and its results are fetched, so wait for the list the
    // assertions below read instead of guessing a delay that holds on a loaded runner.
    await vi.waitFor(async () => {
      await settle();
      expect(root().querySelector(".instance-candidates")?.textContent).toContain("Spare part");
    }, { timeout: 5000 });
    expect(root().querySelector(".instance-candidates")?.textContent).toContain("Item:2");
    expect(root().querySelector(".instance-candidates")?.textContent).not.toContain("First order");
    (root().querySelector(".instance-candidates button") as HTMLElement).click();
    await settle();
    expect(graphRecord.focusElement.some(([id]) => id === "Item:2")).toBe(true);
    expect(graphRecord.zoomTo.every(([zoom]) => Number(zoom) <= 1)).toBe(true);
    expect(graphRecord.states.some(([states]) => ((states as Record<string, string[] | undefined>)["Item:2"] ?? []).includes("selected"))).toBe(true);
    expect(root().querySelector(".detail-title h2")?.textContent).toBe("Spare part");
    expect(root().querySelector(".attribute-row code")?.textContent).toBe("Item:2");
    expect(requests.find((request) => request.url.endsWith("/instanceGraph/search"))?.body)
      .toMatchObject({ term: "spare", version: "v1" });
    expect(requests.find((request) => request.url.endsWith("/instanceGraph/neighborhood"))?.body)
      .toMatchObject({ id: "Item:2", version: "v1", offset: 0 });
    expect(graphRecord.dataBatches.flatMap((batch) => batch.nodes || []).map((node: any) => node.id).sort()).toEqual(["Item:2", "Order:1"]);
    expect(graphRecord.dataBatches.flatMap((batch) => batch.edges || [])).toEqual([expect.objectContaining({ source: "Order:1", target: "Item:2" })]);

    holdPaths.add("/data/queryInfoByNode");
    graphHandlers["node:click"]({ target: { id: "Order:1" } });
    await settle();
    graphHandlers["node:click"]({ target: { id: "Item:2" } });
    await settle();
    const waiting = held.get("/data/queryInfoByNode")!;
    waiting[1].resolve(new Response());
    await settle();
    waiting[0].resolve(new Response());
    await settle();
    expect(root().querySelector(".attribute-row code")?.textContent).toBe("Item:2");
  });

  it.each([
    { field: "neighborClass", index: 0, label: "Item-label", value: "Item" },
    { field: "relationType", index: 1, label: "has", value: "has" },
  ])("reloads direct neighbors after clearing $field and applying filters", async ({ field, index, label, value }) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const { root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await settle();
    graphHandlers["node:click"]({ target: { id: "Order:1" } });
    await settle();

    const select = root().querySelectorAll<HTMLElement>(".neighbor-filters .el-select")[index];
    (select.querySelector(".el-select__wrapper") as HTMLElement).click();
    await settle();
    const option = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
      .find((item) => item.textContent?.trim() === label)!;
    expect(option).toBeDefined();
    option.click();
    await settle();
    const apply = root().querySelector<HTMLButtonElement>(".neighbor-filter-actions .el-button--primary")!;
    apply.click();
    await settle();
    const neighborhoodRequests = () => requests.filter((request) => request.url.endsWith("/data/instanceGraph/neighborhood"));
    expect(neighborhoodRequests().at(-1)?.body).toMatchObject({ id: "Order:1", offset: 0, [field]: value });
    const filteredRequestCount = neighborhoodRequests().length;

    select.dispatchEvent(new MouseEvent("mouseenter"));
    await nextTick();
    const clear = select.querySelector<HTMLElement>(".el-select__clear");
    expect(clear).not.toBeNull();
    clear!.click();
    await settle();
    expect(neighborhoodRequests()).toHaveLength(filteredRequestCount);
    apply.click();
    await settle();

    expect(neighborhoodRequests()).toHaveLength(filteredRequestCount + 1);
    expect(neighborhoodRequests().at(-1)?.body).toMatchObject({ id: "Order:1", version: "v1", offset: 0 });
    expect(neighborhoodRequests().at(-1)?.body).not.toHaveProperty(field);
    expect(graphRecord.dataBatches.at(-1).nodes.map((node: any) => node.id)).toContain("Item:2");
    expect(graphRecord.dataBatches.at(-1).edges[0]).toMatchObject({ source: "Order:1", target: "Item:2" });
  });

  it("caps automatic focus at native size when the graph fit would enlarge one node", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const { root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await settle();
    graphRecord.zoom = 3;
    (root().querySelector(".node-search .el-select .el-select__wrapper") as HTMLElement).click();
    await settle();
    const option = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
      .find(item => item.textContent?.includes("Order-label"))!;
    option.click();
    await settle();
    (root().querySelector(".instance-candidates button") as HTMLElement).click();
    await settle();
    expect(graphRecord.zoomTo).toContainEqual([1, false]);
  });

  it("switches from an overview class filter to the selected instance detail", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const { root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await settle();

    (root().querySelector(".node-search .el-select .el-select__wrapper") as HTMLElement).click();
    await settle();
    [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")]
      .find((item) => item.textContent?.includes("Order-label"))!.click();
    await settle();
    expect(root().querySelector(".search-scope")?.textContent).toContain("Order-label");
    expect(root().querySelector(".detail-content")).toBeNull();

    graphHandlers["node:click"]({ target: { id: "Item:2" } });
    await settle();
    expect(root().querySelector(".search-scope")).toBeNull();
    expect(root().querySelector(".node-search .el-select .el-select__wrapper")?.textContent).toContain("All Object Types");
    expect(root().querySelector(".detail-title code")?.textContent).toBe("Item:2");
  });

  it("toggles relation names on existing edges without hiding node labels or reloading data", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const { root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await settle();
    const edge = graphRecord.dataBatches.flatMap((batch) => batch.edges || [])[0];
    const node = graphRecord.dataBatches.flatMap((batch) => batch.nodes || [])[0];
    (root().querySelector(".graph-toolbar button[aria-label='Display settings']") as HTMLButtonElement).click();
    await settle();
    const toggle = root().querySelector<HTMLElement>(".graph-display-settings [role='switch']")!;
    expect(node.style.labelText).toBe("First order");
    expect(edge.style.labelText).toBeTruthy();
    requests = [];
    toggle.click();
    await settle();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(edge.style.labelText).toBe("");
    expect(graphRecord.nodeUpdates).toEqual([]);
    toggle.click();
    await settle();
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(edge.style.labelText).toBeTruthy();
    expect(requests).toEqual([]);
  });

  it("keeps hidden relation labels and loaded data when switching themes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
    const { host, root } = mountHost({ ...base, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[0] as HTMLElement).click();
    await settle();
    const edge = graphRecord.dataBatches.flatMap((batch) => batch.edges || [])[0];
    (root().querySelector(".graph-toolbar button[aria-label='Display settings']") as HTMLButtonElement).click();
    await settle();
    const toggle = root().querySelector<HTMLElement>(".graph-display-settings [role='switch']")!;
    toggle.click();
    await settle();
    requests = [];
    host.theme = "dark";
    await settle();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(edge.style.labelText).toBe("");
    expect(requests).toEqual([]);
  });

  it("non-default API entry and API key: real catalog and count requests go to the host entry with x-api-key", async () => {
    mountHost(base).showMenu();
    await settle();

    expect(paths()).toEqual(
      expect.arrayContaining([
        "/admin/getMetas",
        "/metricView/queryList",
      ])
    );
    for (const request of requests) {
      expect(request.url.startsWith("/tenant-a/api/data-query/") || request.url === '/tenant-a/api/product-assets/counts').toBe(true);
      expect(request.headers["x-api-key"]).toBe("key-a");
      expect(request.headers.tk).toBeUndefined();
      expect(request.headers["Accept-Language"]).toBe("en");
    }
  });

  it("round-trips owned bindings with typed values and removes one without changing the calculation", async () => {
    const queryPackage = { manifest: { schema: "ontomato.query-package.v1", entry: { kind: "dsl", query: "main" },
      queries: { main: "q.json" }, modules: [], computation: null, parameterBindings: [],
      parameterDefs: [{ name: "amount", type: "TYPE_NUMBER", value: null }, { name: "region", type: "TYPE_STRING", value: null }] },
      files: [{ path: "q.json", content: "shared query" }] };
    metricDetail.function = { id: "function-1", name: "Revenue", operation: "OPERATION_READ", queryPackage,
      parameters: queryPackage.manifest.parameterDefs, returnDef: { classNames: [], columnLabels: {} } };
    metricDetail.bindings = [{ id: "saved-binding", name: "Existing", parameters: { amount: 7, region: "north" }, matchQuestions: [] }];
    const { root } = mountHost({ ...base, view: "/ontology/assets/metrics" });
    await settle();
    (root().querySelector(".resource-table-row") as HTMLButtonElement).click();
    await settle();
    clickButton("Add binding");
    await settle();
    const card = root().querySelectorAll(".metric-binding")[1]!;
    const input = (label: string, value: string) => {
      const field = card.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    input("Binding name", "New binding"); input("amount", "0"); input("region", "null");
    await settle(); clickButton("Save"); await settle();
    const saved = [...requests].reverse().find((r) => r.url.endsWith("/metricView/save"))!.body!;
    expect(saved.type).toBeUndefined();
    expect(saved.function).toMatchObject({ id: "function-1", code: null, queryPackage });
    expect((saved.function as { parameters: { value?: unknown }[] }).parameters.every((p) => p.value === null)).toBe(true);
    expect((saved.bindings as Record<string, unknown>[])[1]!.parameters).toEqual({ amount: 0, region: null });
    (root().querySelector(".resource-table-row") as HTMLButtonElement).click(); await settle();
    expect(root().querySelectorAll(".metric-binding")).toHaveLength(2);
    const remove = [...root().querySelectorAll<HTMLButtonElement>(".metric-binding button")]
      .find((button) => button.textContent?.includes("Remove binding"))!;
    remove.click(); await settle(); clickButton("Save"); await settle();
    const remaining = [...requests].reverse().find((r) => r.url.endsWith("/metricView/save"))!.body!.bindings as Record<string, unknown>[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.name).toBe("New binding");
    expect(remaining[0]!.id).toBe("binding-1");
    expect(remaining[0]!.parameters).toEqual({ amount: 0, region: null });
  });

  it("previews metric Markdown and lets the user switch to its source", async () => {
    const { root } = mountHost({ ...base, view: "/ontology/assets/metrics" });
    await settle();
    (root().querySelector(".resource-table-row") as HTMLButtonElement).click();
    await settle();
    clickButton("Test");
    await settle();
    clickButton("Test and generate Markdown");
    await settle();

    const overlay = document.querySelector(".manager-overlay-host")!;
    const preview = overlay.querySelector(".metric-markdown-preview")!;
    expect(preview.querySelector("h1")?.textContent).toBe("Revenue");
    expect(preview.querySelector("table")?.textContent).toContain("42");
    expect(overlay.querySelector(".metric-markdown-preview textarea")).toBeNull();

    const sourceRadio = [...overlay.querySelectorAll<HTMLElement>(".markdown-view-toggle .el-radio")]
      .find((item) => item.textContent?.trim() === "Source")!;
    sourceRadio.querySelector("input")!.click();
    await settle();
    expect(overlay.querySelector(".metric-markdown-preview")).toBeNull();
    expect(overlay.querySelector(".el-dialog .cm-content")?.textContent).toContain("# Revenue");
  });

  it("the address locates data browsing; page actions navigate through the router; unknown addresses land on the graph", async () => {
    const { host, views, root } = mountHost({ ...base, view: "/browser/data/Item" });
    await settle();

    expect(paths()).not.toContain("/data/getWholeClassDataByPage");
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[1] as HTMLElement).click();
    await settle();
    const page = requests.find((request) => request.url.endsWith("/data/getWholeClassDataByPage"));
    expect(page?.body).toEqual({ classname: "Item", pagenum: 1, pagecount: 20 });
    expect(page?.headers["x-api-key"]).toBe("key-a");
    const row = root().querySelector<HTMLElement>(".data-browser-table .el-table__body tr")!;
    row.click();
    await settle();
    expect(row.classList.contains("current-row")).toBe(true);

    host.view = "/ontology/objects/Order";
    await settle();
    clickButton("Browse Data");
    await settle();
    expect(views.at(-1)).toBe("/browser/data/Order");

    // The navigation entry (a bare /data) returns to the object type last on show.
    host.view = "/ontology/objects";
    await settle();
    host.view = "/browser/data";
    await settle();
    expect(views.at(-1)).toBe("/browser/data/Order");

    host.view = "/unknown";
    await settle();
    expect(views.at(-1)).toBe("/ontology/playground");
  });

  it("retries a failed table read in place for the same object type", async () => {
    const { root } = mountHost({ ...base, view: "/browser/data/Item" });
    await settle();
    const tablePath = "/data/getWholeClassDataByPage";
    statusFor = (path) => path === tablePath ? 500 : 200;
    (root().querySelectorAll<HTMLElement>(".data-browser-toolbar .el-segmented__item")[1]!).click();
    await settle();
    const feedback = () => root().querySelector<HTMLElement>(".table-read-error");
    expect(feedback()?.textContent).toContain("Load Data Failed");
    expect(root().querySelector(".table-feedback")).toBeNull();

    statusFor = () => 200;
    feedback()!.querySelector("button")!.click();
    await settle();
    expect(feedback()).toBeNull();
    expect(requests.filter(request => request.url.endsWith(tablePath)).map(request => request.body)).toEqual([
      { classname: "Item", pagenum: 1, pagecount: 20 },
      { classname: "Item", pagenum: 1, pagecount: 20 },
    ]);
    expect(root().querySelector(".el-table__body-wrapper")?.textContent).toContain("row-1");
  });

  it("keeps the last object rows and retries the submitted search, not the draft", async () => {
    const { root } = mountHost({ ...base, view: "/browser/data/Item" });
    await settle();
    const path = "/data/getWholeClassDataByPage";
    root().querySelectorAll<HTMLElement>(".data-browser-toolbar .el-segmented__item")[1]!.click();
    await settle();
    const input = root().querySelector<HTMLInputElement>(".data-search input")!;
    function type(value: string) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    statusFor = (url) => url === path ? 500 : 200;
    type("submitted term");
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    await settle();
    expect(root().querySelector(".el-table__body-wrapper")?.textContent).toContain("row-1");
    expect(root().querySelector(".table-scope [role=status]")?.textContent).toContain("Search: All");
    expect(root().querySelector(".table-read-error")?.textContent).toContain("submitted term");
    type("unsubmitted edit");
    statusFor = () => 200;
    root().querySelector<HTMLButtonElement>(".table-read-error button")!.click();
    await settle();
    expect(requests.filter(request => request.url.endsWith(path)).at(-1)?.body).toMatchObject({ search: "submitted term", pagenum: 1 });
    expect(root().querySelector(".table-scope [role=status]")?.textContent).toContain("Search: submitted term");
    expect(root().querySelector(".table-read-error")).toBeNull();
  });

  it("the frame follows the page theme and neither reads nor changes html.dark", async () => {
    const { host, root } = mountHost({ ...base, theme: "dark" });
    await settle();
    expect(root().classList.contains("is-dark")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    host.theme = "light";
    document.documentElement.classList.add("dark");
    await settle();
    expect(root().classList.contains("is-dark")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("the page's vue-i18n locale drives the text; the locale drives Accept-Language", async () => {
    const { host, root } = mountHost({ ...base, ...german, view: "/browser/data/Order" });
    await settle();
    (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[1] as HTMLElement).click();
    await settle();
    expect(root().querySelector(".data-browser-actions button[aria-label='[de] Advanced Filter']")).not.toBeNull();
    expect(requests.every((request) => request.headers["Accept-Language"] === "de")).toBe(true);

    requests = [];
    Object.assign(host, english);
    await settle();
    expect(root().querySelector(".data-browser-actions button[aria-label='Advanced Filter']")).not.toBeNull();
    expect(root().textContent).not.toContain("[de] ");
    expect(requests).toEqual([]);

    host.view = "/ontology/objects";
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers["Accept-Language"] === "en")).toBe(true);
  });

  it("401/402 only notify the page; after 402 the credential is kept and later requests still carry it", async () => {
    statusFor = (path) =>
      path === "/metricView/queryList" ? 402 : path.endsWith("/product-assets/counts") ? 401 : 200;
    const { host, failures, showMenu } = mountHost(base);
    showMenu();
    await settle();
    expect(failures.sort()).toEqual([401, 402]);

    requests = [];
    statusFor = () => 200;
    host.view = "/browser/data/Order";
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers["x-api-key"] === "key-a")).toBe(true);
  });

  it("visual modeling: focuses the object from the address, field-by-field edits keep the original order, and back returns to the graph", async () => {
    const { views } = mountHost({
      ...base,
      view: "/ontology/visual-modeling?focus=object&id=Order&back=playground",
    });
    await settle();
    // The current adapter type comes from the one adapter read; the full business config is never requested.
    const adapters = requests.filter((request) => request.url.endsWith("/businessConfig/dataAdapters"));
    expect(adapters.length).toBeGreaterThan(0);
    expect(adapters[0].method).toBe("GET");
    expect(adapters[0].headers["x-api-key"]).toBe("key-a");
    expect(paths()).not.toContain("/businessConfig/getConfig");

    clickButton("Edit");
    await settle();
    const dialog = [...document.querySelectorAll(".el-dialog")].find((item) =>
      item.textContent?.includes("Update")
    )!;
    const [, showName] = [...dialog.querySelectorAll("input")];
    const description = dialog.querySelector("textarea")!;
    showName.value = "Order renamed";
    showName.dispatchEvent(new Event("input"));
    description.value = "Order desc renamed";
    description.dispatchEvent(new Event("input"));
    await settle();

    holdPaths.add("/ontology/model/object-type/update");
    requests = [];
    clickButton("Update");
    await settle();
    expect(requests.map((request) => [request.method, request.url.replace(/^.*\/data-query/, "")])).toEqual([
      ["POST", "/admin/getMetas"],
      ["POST", "/ontology/model/object-type/update"],
    ]);
    expect(requests[1].body).toEqual({ className: "Order", showName: "Order renamed", classDesc: "Order desc" });

    holdPaths.clear();
    held.get("/ontology/model/object-type/update")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();
    expect(requests.filter((request) => request.url.endsWith("/ontology/model/object-type/update")).map((request) => request.body)).toEqual([
      { className: "Order", showName: "Order renamed", classDesc: "Order desc" },
      { className: "Order", showName: "Order renamed", classDesc: "Order desc renamed" },
    ]);

    clickButton("Back to graph");
    await settle();
    expect(views.at(-1)).toBe("/ontology/playground");
  });

  it.each([
    ["mysql", true],
    ["elasticsearch", true],
    ["m3", false],
  ])("visual modeling: with current adapter %s, join fields stay visible and the adapter decides whether they are required", async (current, requiresJoinFields) => {
    dataAdapter = current;
    mountHost({ ...base, view: "/ontology/visual-modeling?focus=object&id=Order&back=playground" });
    await settle();
    expect(paths()).toContain("/businessConfig/dataAdapters");

    graphHandlers["edge:dblclick"]!({ edge: { id: "has" } });
    await settle();
    const field = [...openDialog("Rel Desc").querySelectorAll(".el-form-item")]
      .find((item) => item.textContent?.includes("Src Field"))!;
    expect(field).toBeDefined();
    expect(field.classList.contains("is-required")).toBe(requiresJoinFields);
  });

  it("visual modeling: a new relation on an adapter requiring join fields is not sent without them and is sent with fromField/toField", async () => {
    dataAdapter = "elasticsearch";
    // No existing relation, so the dialog's default Order -> Item pair is new.
    metasFor = () => ({ success: true, data: { ...metas(["Order", "Item"]).data, relationship_rule: {} } });
    mountHost({ ...base, view: "/ontology/visual-modeling?focus=object&id=Order&back=playground" });
    await settle();
    clickButton("Add Relation");
    await settle();
    const dialog = openDialog("Rel Desc");
    const fill = (placeholder: string, value: string) => {
      const input = dialog.querySelector<HTMLInputElement>(`input[placeholder='${placeholder}']`)!;
      input.value = value;
      input.dispatchEvent(new Event("input"));
    };
    fill("Rel Desc", "contains");
    await settle();
    clickButton("Add");
    await settle();
    expect(requests.some((request) => request.method === "POST" && request.url.endsWith("/ontology/model/relationship/create"))).toBe(false);

    fill("Enter Src Field", "order_id");
    fill("Enter Tgt Field", "id");
    await settle();
    clickButton("Add");
    await settle();
    expect(requests.find((request) => request.method === "POST" && request.url.endsWith("/ontology/model/relationship/create"))?.body)
      .toMatchObject({ desc: "contains", fromField: "order_id", toField: "id" });
  });

  it("relation editing through visual modeling persists missing join fields and displays them after reopening", async () => {
    const state = metas(["Order", "Item"]);
    state.data.classDef[0].attrs.push({ name: "item_id", showName: "Item link", type: "varchar" });
    metasFor = () => state;
    const view = "/ontology/visual-modeling";
    const { host } = mountHost({ ...base, view });
    await settle();
    const openEditor = async () => {
      graphHandlers["edge:dblclick"]!({ edge: { id: "has" } });
      await settle();
      return openDialog("Rel Desc");
    };
    const editor = await openEditor();
    typeInto(editor.querySelector("input[placeholder='Enter Src Field']")!, "item_id");
    typeInto(editor.querySelector("input[placeholder='Enter Tgt Field']")!, "id");
    await settle();
    clickButton("Update");
    await settle();
    expect(requests.find((request) => request.url.endsWith("/ontology/model/relationship/update"))?.body)
      .toEqual({ relationship: "has", desc: "has", fromField: "item_id", toField: "id" });

    host.view = "/ontology/objects";
    await settle();
    host.view = view;
    await settle();
    const reopened = await openEditor();
    expect((reopened.querySelector("input[placeholder='Enter Src Field']") as HTMLInputElement).value).toBe("item_id");
    expect((reopened.querySelector("input[placeholder='Enter Tgt Field']") as HTMLInputElement).value).toBe("id");
  });

  it("when only locale/theme change, the open edit dialog and its input are kept without reloading", async () => {
    const { host } = mountHost({
      ...base,
      view: "/ontology/visual-modeling?focus=object&id=Order&back=playground",
    });
    await settle();
    clickButton("Edit");
    await settle();
    const dialog = openDialog("Update");
    const [, showName] = [...dialog.querySelectorAll("input")];
    showName.value = "Unsaved name";
    showName.dispatchEvent(new Event("input"));
    await settle();

    requests = [];
    Object.assign(host, german);
    host.theme = "dark";
    await settle();
    const after = openDialog("[de] Update");
    expect(after).toBe(dialog);
    expect([...after.querySelectorAll("input")][1].value).toBe("Unsaved name");
    expect(paths()).not.toContain("/admin/getMetas");
  });

  // Embedded case: the iframe loads with the startup locale and the host then sends its current locale; the first data for the same identity must still render (the original main system checked results by credential only).
  it.each([
    ["data browsing", "/browser/data/Order"],
    ["visual modeling", "/ontology/visual-modeling?focus=object&id=Order&back=playground"],
  ])("%s: the host switches locale while the first getMetas is in flight; data still renders and later requests carry the new locale", async (_name, view) => {
    holdPaths.add("/admin/getMetas");
    const { host, root } = mountHost({ ...base, view });
    await settle();
    Object.assign(host, german);
    await settle();
    holdPaths.clear();
    held.get("/admin/getMetas")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();

    expect(document.querySelector('[role="alert"]')).toBeNull();
    if (view.startsWith("/browser/data/")) {
      (root().querySelectorAll(".data-browser-toolbar .el-segmented__item")[1] as HTMLElement).click();
      await settle();
      const page = requests.find((request) => request.url.endsWith("/data/getWholeClassDataByPage"));
      expect(page?.body).toMatchObject({ classname: "Order" });
      expect(page?.headers["Accept-Language"]).toBe("de");
      expect(root().textContent).toContain("row-1");
    } else {
      expect(root().querySelector(".visual-modeling .el-tag")?.textContent).toContain("Order-label");
    }
    // Switching locale does not reload: the only metadata batch is the one sent in en before the switch.
    const metaRequests = requests.filter((request) => request.url.endsWith("/admin/getMetas"));
    expect(metaRequests.every((request) => request.headers["Accept-Language"] === "en")).toBe(true);

    requests = [];
    host.view = "/ontology/objects";
    await settle();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((request) => request.headers["Accept-Language"] === "de")).toBe(true);
  });

  it("switching only the locale during a multi-step save: later steps are sent once and sent requests are not repeated", async () => {
    const { host } = mountHost({
      ...base,
      view: "/ontology/visual-modeling?focus=object&id=Order&back=playground",
    });
    await settle();
    clickButton("Edit");
    await settle();
    const dialog = openDialog("Update");
    const [, showName] = [...dialog.querySelectorAll("input")];
    const description = dialog.querySelector("textarea")!;
    showName.value = "Order renamed";
    showName.dispatchEvent(new Event("input"));
    description.value = "Order desc renamed";
    description.dispatchEvent(new Event("input"));
    await settle();

    holdPaths.add("/ontology/model/object-type/update");
    requests = [];
    clickButton("Update");
    await settle();
    Object.assign(host, german);
    await settle();
    holdPaths.clear();
    held.get("/ontology/model/object-type/update")!.forEach((waiting) => waiting.resolve(new Response()));
    await settle();

    const saves = requests.filter((request) => request.url.endsWith("/ontology/model/object-type/update"));
    expect(saves).toHaveLength(2);
    expect(saves.map((request) => request.headers["Accept-Language"])).toEqual(["en", "de"]);
  });

  it("visual modeling takes the node palette from the host", async () => {
    mountHost({ ...base, view: "/ontology/visual-modeling" });
    await settle();
    const fills = graphRecord.addedNodes.map((node: any) => node.attrs.body.fill);
    expect(fills.length).toBe(2);
    expect(fills.every((fill: string) => presentation.nodePalette.light.includes(fill))).toBe(true);
  });



  it("the description fallback pre-fills the form with the host value, is unchanged by locale/theme switches, and is submitted in the original field after editing", async () => {
    metasFor = () => ({
      success: true,
      data: { classDef: [{ className: "Order", showName: "Order", classDesc: "", attrs: [] }] },
    });
    const { host, root } = mountHost({ ...base, view: "/ontology/objects/Order" });
    await settle();
    const textarea = () => root().querySelector<HTMLTextAreaElement>("textarea")!;
    expect(textarea().value).toBe("Host: no description");

    Object.assign(host, german);
    host.theme = "dark";
    await settle();
    Object.assign(host, english);
    await settle();
    expect(textarea().value).toBe("Host: no description");

    textarea().value = "Host: no description (amended)";
    textarea().dispatchEvent(new Event("input"));
    await settle();
    requests = [];
    clickButton("Save Changes");
    await settle();
    expect(requests.find((r) => r.url.endsWith("/ontology/model/object-type/update"))?.body).toEqual({
      className: "Order",
      showName: "Order",
      classDesc: "Host: no description (amended)",
    });
  });

  it.each([
    ["object model catalog", "/ontology/objects", "New Object Type", ".object-create-dialog", "Create"],
    ["visual modeling", "/ontology/visual-modeling", "Add Class", ".el-dialog", "Add"],
  ])("%s creating a class: without a primary key nothing is submitted; after submitting with one, the primary key saved by the backend is shown", async (_name, view, open, selector, submit) => {
    // Only the metadata re-read after creation contains the new class and its primary key: the page must show the backend's saved result, not locally assembled empty attributes.
    metasFor = () => {
      const saved = metas(["Order", "Item"]);
      if (requests.some((request) => request.method === "POST" && request.url.endsWith("/ontology/model/object-type/create"))) {
        saved.data.classDef.push({
          className: "Pump",
          showName: "Pump-label",
          classDesc: "Pump desc",
          attrs: [
            { name: "pump_no", showName: "pump_no", type: "varchar", enable: true, primaryKey: true },
          ] as never,
        });
      }
      return saved;
    };
    const { root } = mountHost({ ...base, view });
    await settle();
    clickButton(open);
    await settle();
    const dialog = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (item) => item.style.display !== "none" && item.querySelector("input")
    )!;
    const [className, primaryKey, showName] = [...dialog.querySelectorAll("input")];
    const fill = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      input.value = value;
      input.dispatchEvent(new Event("input"));
    };
    fill(className, "Pump");
    fill(showName, "Pump-label");
    fill(dialog.querySelector("textarea")!, "Pump desc");
    await settle();
    const create = () =>
      [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === submit)!.click();

    create();
    await settle();
    expect(requests.some((request) => request.method === "POST" && request.url.endsWith("/ontology/model/object-type/create"))).toBe(false);

    fill(primaryKey, "pump_no");
    await settle();
    create();
    await settle();
    expect(requests.find((request) => request.method === "POST" && request.url.endsWith("/ontology/model/object-type/create"))?.body).toMatchObject({
      className: "Pump",
      primaryKeyName: "pump_no",
      showName: "Pump-label",
      classDesc: "Pump desc",
    });
    if (view === "/ontology/objects") {
      expect(root().textContent).toContain("pump_no");
    } else {
      const panel = root().querySelector(".attr-item")!;
      expect(panel.textContent).toContain("pump_no");
      expect(panel.textContent).toContain("Primary Key");
    }
  });

  it("edit dialogs mount in a themed viewport overlay; opening and closing leave body unchanged", async () => {
    const { root } = mountHost({ ...base, view: "/ontology/objects/Order" });
    await settle();
    const bodyBefore = [
      document.body.className,
      document.body.getAttribute("style"),
      document.body.children.length,
    ];
    clickButton("New Property");
    await settle();
    const dialog = openDialog("Create");
    const overlay = dialog.closest(".manager-overlay-host");
    expect(overlay?.parentElement).toBe(document.body);
    expect(overlay?.classList.contains("ontology-manager")).toBe(true);
    expect(root().contains(dialog)).toBe(false);
    expect([
      document.body.className,
      document.body.getAttribute("style"),
      document.body.children.length,
    ]).toEqual(bodyBefore);
    clickButton("Cancel");
    await settle();
    expect([
      document.body.className,
      document.body.getAttribute("style"),
      document.body.children.length,
    ]).toEqual(bodyBefore);
  });
});

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

function openDialog(buttonText: string) {
  const dialog = [...document.querySelectorAll(".el-dialog")].find((item) =>
    item.textContent?.includes(buttonText)
  );
  if (!dialog) throw new Error(`Dialog not found: ${buttonText}`);
  return dialog;
}

