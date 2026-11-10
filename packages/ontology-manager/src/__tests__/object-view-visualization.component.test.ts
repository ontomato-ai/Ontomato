import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, reactive, nextTick, type App } from "vue";
import { createViewWidget } from "@ontomato/contracts/object-views";
import { chartTheme } from "@ontomato/foundation-ui/chart";
import ObjectViewVisualization from "../object-views/ObjectViewVisualization.vue";
import { installObjectViewHost } from "./object-view-host";

let app: App;
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
describe("Object View skill rendering", () => {
  it.each([
    { chartType: "bar", value: [] },
    { chartType: "graph", value: { nodes: [], edges: [] } },
    { chartType: "graph", value: null },
  ] as const)("shows an empty state without rendering empty $chartType data and recovers when data arrives", async ({ chartType, value }) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true, result: { html: "<html>chart</html>" } })));
    vi.stubGlobal("fetch", fetch);
    const state = reactive<{ rows: Record<string, unknown>[]; value: unknown }>({ rows: [], value });
    const element = document.createElement("div"); document.body.append(element);
    app = createApp(defineComponent({ setup() {
      return () => h(ObjectViewVisualization, { widget: { ...createViewWidget("chart"), chartType }, rows: state.rows, value: state.value });
    } }));
    installObjectViewHost(app, "/api", "test");
    app.mount(element);
    await nextTick();
    expect(element.textContent).toContain("No chart data");
    expect(fetch).not.toHaveBeenCalled();
    state.rows = [{ label: "A", value: 1 }];
    state.value = { nodes: [{ id: "one" }], edges: [] };
    for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(element.querySelector("iframe")).not.toBeNull();
    state.rows = [];
    state.value = value;
    await nextTick();
    expect(element.textContent).toContain("No chart data");
    expect(element.querySelector("iframe")).toBeNull();
  });
  it("executes the selected visualization skill and embeds its HTML with deployment resource paths", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ success: true, result: { html: '<html><script src="/api/skills/resources/executable/visualization/echarts/scripts/echarts.min.js"></script></html>' } }));
    });
    const element = document.createElement("div"); document.body.append(element);
    app = createApp(defineComponent({ setup() {
      return () => h(ObjectViewVisualization, { widget: { ...createViewWidget("chart"), chartType: "donut", labelField: "level", valueField: "count" }, rows: [{ level: "A", count: 7 }], value: [] });
    } }));
    installObjectViewHost(app, "/prefix/api", "secret");
    app.mount(element);
    for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); }
    expect(calls[0].url).toBe("/prefix/api/skills/echarts/render");
    expect(calls[0].body.input).toMatchObject({ data: [{ level: "A", count: 7 }], chartType: "donut", xField: "level", yField: "count", showTitle: false });
    const frame = element.querySelector("iframe")!;
    expect(frame.srcdoc).toContain('/prefix/api/echart/echarts.min.js');
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  });
  it("draws the skill's charts in the platform's chart theme and follows the page into dark", async () => {
    // A brand stylesheet as @ontomato/design-tokens writes one: the light values on :root, the dark ones on html.dark.
    const brand = document.createElement("style");
    brand.textContent = ":root { --chart-1: #111111; --el-text-color-primary: #101010; } html.dark { --chart-1: #eeeeee; --el-text-color-primary: #f0f0f0; }";
    document.head.append(brand);
    try {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, result: { html: "<html><head></head>chart</html>" } })));
      const element = document.createElement("div"); document.body.append(element);
      app = createApp(defineComponent({ setup() {
        return () => h(ObjectViewVisualization, { widget: { ...createViewWidget("chart"), chartType: "bar" }, rows: [{ label: "A", value: 1 }], value: [] });
      } }));
      installObjectViewHost(app);
      app.mount(element);
      const frame = () => element.querySelector("iframe")?.srcdoc ?? "";

      await vi.waitFor(() => expect(frame()).toContain(JSON.stringify(chartTheme())));
      expect(frame()).toContain("#111111");
      document.documentElement.classList.add("dark");
      await vi.waitFor(() => expect(frame()).toContain(JSON.stringify(chartTheme())));
      expect(frame()).toContain("#eeeeee");
    } finally {
      brand.remove();
      document.documentElement.classList.remove("dark");
    }
  });
});
