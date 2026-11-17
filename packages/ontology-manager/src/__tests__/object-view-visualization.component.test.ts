import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue";
import type { ChartViewWidget } from "@ontomato/contracts/object-views";
import ObjectViewVisualization from "../object-views/ObjectViewVisualization.vue";
import { installObjectViewHost } from "./object-view-host";
import { chartFile, chartWidget } from "./chart-fixture";

/**
 * The view's chart draws the file saved in this version, filled from the MetricView output the runtime read. The
 * platform chart is stubbed: its own states are the platform component's tests, while this component decides which
 * columns, file and rows a view passes it.
 */
const drawn: Array<{ file: unknown; metric: { columns: { key: string }[]; rows: Record<string, unknown>[] }; height: number }> = [];
// The platform chart is the shared component; this test records the file and the output a view hands it.
vi.mock("@ontomato/foundation-ui/chart", () => ({
  MetricChart: {
    props: ["file", "metric", "height", "undated", "empty"],
    setup: (props: never) => () => { drawn.push(props as never); return h("div", { class: "drawn" }); },
  },
}));

let app: App | undefined;
/** The MetricView's declared columns: one more than the file draws. */
const columns = [{ key: "kind" }, { key: "amount" }, { key: "region" }];
const described: string[] = [];
afterEach(() => { app?.unmount(); app = undefined; drawn.length = 0; described.length = 0; document.body.innerHTML = ""; vi.unstubAllGlobals(); });
function mount(widget: ChartViewWidget, rows: Record<string, unknown>[]) {
  vi.stubGlobal("fetch", async (url: string) => {
    if (!url.endsWith("/metrics/describe")) throw new Error(`Unexpected request: ${url}`);
    described.push(url);
    return new Response(JSON.stringify({ outputColumns: columns }));
  });
  const element = document.createElement("div"); document.body.append(element);
  app = createApp(defineComponent({ setup() { return () => h(ObjectViewVisualization, { widget, rows }); } }));
  installObjectViewHost(app);
  app.mount(element);
  return element;
}

/** The describe read and the redraw it causes both settle a tick after mount. */
async function settle() {
  for (let index = 0; index < 4; index++) { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); }
}

describe("Object View chart rendering", () => {
  it("fills the saved file from the declared MetricView columns, including one the file does not draw", async () => {
    const element = mount(chartWidget(), [{ kind: "A", amount: 7, region: "east" }]);
    await settle();
    expect(described).toHaveLength(1);
    expect(drawn.at(-1)?.file).toEqual(chartFile());
    expect(drawn.at(-1)?.metric).toEqual({ columns, rows: [{ kind: "A", amount: 7, region: "east" }] });
    expect(drawn.at(-1)?.height).toBe(320);
    expect(element.querySelector(".view-chart")?.getAttribute("style")).toContain("height: 320px");
  });

  it("reads the columns once for the MetricView and again only when the widget is bound to another one", async () => {
    const widget = reactive(chartWidget());
    mount(widget, [{ kind: "A", amount: 7 }]);
    await settle();
    expect(described).toHaveLength(1);
    widget.resourceId = "metric-2";
    await settle();
    expect(described).toHaveLength(2);
  });

  it("draws a result with no rows as empty rather than keeping the previous object's rows", async () => {
    const rows = reactive<Record<string, unknown>[]>([]);
    mount(chartWidget(), rows);
    await settle();
    rows.push({ kind: "B", amount: 3 });
    await nextTick();
    expect(drawn.at(-1)?.metric.rows).toEqual([{ kind: "B", amount: 3 }]);
    rows.splice(0);
    await nextTick();
    expect(drawn.at(-1)?.metric.rows).toEqual([]);
  });
});
