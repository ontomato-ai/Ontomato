import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, ref, type App } from "vue";
import type { ManagerAuthFailureStatus, ManagerClient, ManagerCredential } from "../api";
import { createManager, useManagerClient, useManagerContext, useManagerCounts, type ManagerTheme } from "../context";

let requests: { url: string; headers: Record<string, string> }[];
let status: number;
let mountedApps: App[];

beforeEach(() => {
  requests = [];
  status = 200;
  mountedApps = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify({ success: true, data: [] }), { status });
  });
});

afterEach(() => {
  mountedApps.forEach((app) => app.unmount());
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

/** Four pages each inject the client, standing for the ontology, asset, data browsing and modeling request entry points. */
const pages = {
  ontology: (client: ManagerClient) => client.loadOntology(),
  assets: (client: ManagerClient) => client.loadSmartAssets("actions"),
  dataBrowser: (client: ManagerClient) => client.loadObjectData("Order", 1, 25),
  visualModeling: (client: ManagerClient) => client.listDataAdapters(),
};
type Page = keyof typeof pages;

function mountPage(credential: ManagerCredential = { type: "token", token: "t-1" }) {
  const theme = ref<ManagerTheme>("light");
  const locale = ref("en");
  const failures: ManagerAuthFailureStatus[] = [];
  const manager = createManager({
    apiBase: "/manager-api",
    credential,
    theme,
    locale,
    translate: (key) => key,
    dataFallbacks: { noBusinessDescription: "Host: no description", unnamedAsset: "Host: unnamed asset" },
    // This file only checks injection and requests; presentation values are unused but supplied in full.
    presentation: {
      themeProperties: { light: {}, dark: {} },
      nodePalette: { light: ["#000001"], dark: ["#000004"] },
      edgeLabel: {},
      maxFitZoom: null,
      dataBrowserDescription: () => "",
      compactDialogs: false,
    },
    knowledgeTagValues: { general: "General", business: "Business", tech: "Tech" },
    onAuthFailure: (status) => failures.push(status),
  });
  const clients = {} as Record<Page, ManagerClient>;
  let observed: ReturnType<typeof useManagerContext> | undefined;
  let counts: ReturnType<typeof useManagerCounts> | undefined;
  const children = (Object.keys(pages) as Page[]).map((name) =>
    defineComponent({
      setup() {
        clients[name] = useManagerClient();
        observed = useManagerContext();
        counts = useManagerCounts();
        return () => h("div");
      },
    })
  );
  const app = createApp(defineComponent({ setup: () => () => children.map((child) => h(child)) }));
  manager.install(app);
  const el = document.createElement("div");
  document.body.append(el);
  app.mount(el);
  mountedApps.push(app);
  const run = (name: Page) => pages[name](clients[name]);
  return { manager, theme, locale, failures, clients, observed: () => observed!, counts: () => counts!, run };
}

describe("the Manager installed in the page", () => {
  it("every page shares the page's one client, and the client sends the page credential", async () => {
    const page = mountPage();
    const { ontology, assets, dataBrowser, visualModeling } = page.clients;
    expect(new Set([ontology, assets, dataBrowser, visualModeling, page.manager.client]).size).toBe(1);

    await Promise.all((Object.keys(pages) as Page[]).map((name) => page.run(name)));
    expect(requests.map((r) => r.url)).toEqual(
      ["/admin/getMetas", "/action/queryList", "/data/getWholeClassDataByPage", "/businessConfig/dataAdapters"].map(
        (path) => `/manager-api/data-query${path}`
      )
    );
    expect(requests.every((r) => r.headers.tk === "t-1")).toBe(true);
  });

  it("theme and locale follow the page's preferences; later requests carry the new language", async () => {
    const page = mountPage();
    page.theme.value = "dark";
    page.locale.value = "de";
    expect(page.observed()).toMatchObject({ theme: "dark", locale: "de" });
    await page.run("ontology");
    expect(requests[0].headers["Accept-Language"]).toBe("de");
  });

  it("does not read old credentials from host storage; anonymous sends no credential header", async () => {
    localStorage.setItem("data_agent_token", "host-token");
    localStorage.setItem("data_agent_apikey", "host-key");
    sessionStorage.setItem("ontology_manager_token", "shell-token");
    sessionStorage.setItem("ontology_manager_api_key", "shell-key");
    const anonymous = mountPage({ type: "anonymous" });
    await anonymous.run("visualModeling");
    expect(requests).toHaveLength(1);
    expect(requests[0].headers).not.toHaveProperty("tk");
    expect(requests[0].headers).not.toHaveProperty("x-api-key");
  });

  it("401/402 go to the page without navigating or clearing any storage", async () => {
    localStorage.setItem("data_agent_token", "host-token");
    window.location.hash = "#/objects/Order";
    const page = mountPage();

    status = 401;
    await expect(page.run("assets")).rejects.toThrow();
    status = 402;
    await expect(page.run("visualModeling")).rejects.toThrow();

    expect(page.failures).toEqual([401, 402]);
    expect(window.location.hash).toBe("#/objects/Order");
    expect(localStorage.getItem("data_agent_token")).toBe("host-token");
  });

  it("the navigation counts are read once per page load and again on request", async () => {
    const page = mountPage();
    const counts = page.counts();
    expect(counts.values.objects).toBeNull();
    counts.ensure();
    counts.ensure();
    await vi.waitFor(() => expect(counts.values.objects).toBe(0));
    const reads = requests.filter((r) => r.url.endsWith("/admin/getMetas")).length;
    expect(reads).toBe(1);
    await counts.refresh();
    expect(requests.filter((r) => r.url.endsWith("/admin/getMetas")).length).toBe(2);
  });

  it("reports a clear error when used in an app the Manager is not installed in", () => {
    const Orphan = defineComponent({
      setup() {
        useManagerClient();
        return () => h("div");
      },
    });
    const app = createApp(Orphan);
    app.config.warnHandler = () => {};
    expect(() => app.mount(document.createElement("div"))).toThrow("Manager is installed");
  });
});
