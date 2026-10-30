import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, reactive, nextTick, type App } from "vue";
import { createViewWidget } from "@ontomato/contracts/object-views";
import ObjectViewVisualization from "../object-views/ObjectViewVisualization.vue";
import { provideManagerContext, type ManagerHostContext } from "../context";
import { englishMessages } from "../i18n";

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
      provideManagerContext(reactive({ apiBase: "/api", credential: { type: "token", token: "test" }, locale: "en", messages: englishMessages } as ManagerHostContext), () => {});
      return () => h(ObjectViewVisualization, { widget: { ...createViewWidget("chart"), chartType }, rows: state.rows, value: state.value });
    } }));
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
      provideManagerContext(reactive({ apiBase: "/prefix/api", credential: { type: "token", token: "secret" }, locale: "en", messages: englishMessages } as ManagerHostContext), () => {});
      return () => h(ObjectViewVisualization, { widget: { ...createViewWidget("chart"), chartType: "donut", labelField: "level", valueField: "count" }, rows: [{ level: "A", count: 7 }], value: [] });
    } }));
    app.mount(element);
    for (let i = 0; i < 5; i++) { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); }
    expect(calls[0].url).toBe("/prefix/api/skills/echarts/render");
    expect(calls[0].body.input).toMatchObject({ data: [{ level: "A", count: 7 }], chartType: "donut", xField: "level", yField: "count", showTitle: false });
    const frame = element.querySelector("iframe")!;
    expect(frame.srcdoc).toContain('/prefix/api/echart/echarts.min.js');
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  });
});
