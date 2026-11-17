import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue";
import type { ChartViewWidget } from "@ontomato/contracts/object-views";
import ObjectViewVisualization from "../object-views/ObjectViewVisualization.vue";
import { installObjectViewHost } from "./object-view-host";
import { chartFile, chartWidget } from "./chart-fixture";

/**
 * The view's chart draws the file saved in this version, filled from the MetricView output the runtime read. The
 * platform chart is stubbed: its own states are the platform component's tests, while this component decides which
 * file and which rows a view passes it.
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
afterEach(() => { app?.unmount(); app = undefined; drawn.length = 0; document.body.innerHTML = ""; vi.unstubAllGlobals(); });
function mount(widget: ChartViewWidget, rows: Record<string, unknown>[]) {
  const element = document.createElement("div"); document.body.append(element);
  app = createApp(defineComponent({ setup() { return () => h(ObjectViewVisualization, { widget, rows }); } }));
  installObjectViewHost(app);
  app.mount(element);
  return element;
}

describe("Object View chart rendering", () => {
  it("fills the saved file from the current MetricView output and names the file's columns", async () => {
    const element = mount(chartWidget(), [{ kind: "A", amount: 7 }]);
    await nextTick();
    expect(drawn).toHaveLength(1);
    expect(drawn[0].file).toEqual(chartFile());
    expect(drawn[0].metric).toEqual({ columns: [{ key: "kind" }, { key: "amount" }], rows: [{ kind: "A", amount: 7 }] });
    expect(drawn[0].height).toBe(320);
    expect(element.querySelector(".view-chart")?.getAttribute("style")).toContain("height: 320px");
  });

  it("draws a result with no rows as empty rather than keeping the previous object's rows", async () => {
    const rows = reactive<Record<string, unknown>[]>([]);
    const element = document.createElement("div"); document.body.append(element);
    app = createApp(defineComponent({ setup() { return () => h(ObjectViewVisualization, { widget: chartWidget(), rows }); } }));
      installObjectViewHost(app);
    app.mount(element);
    await nextTick();
    rows.push({ kind: "B", amount: 3 });
    await nextTick();
    expect(drawn.at(-1)?.metric.rows).toEqual([{ kind: "B", amount: 3 }]);
    rows.splice(0);
    await nextTick();
    expect(drawn.at(-1)?.metric.rows).toEqual([]);
  });
});
