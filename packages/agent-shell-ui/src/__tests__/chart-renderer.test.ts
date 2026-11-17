import { createApp, h, nextTick, ref } from "vue";
import { expect, it, vi } from "vitest";
import { shellContextKey, type ShellContext } from "../context";

// The platform chart draws a chart file with the platform's rules; a legacy plain option is only read as it was stored.
vi.mock("@ontomato/foundation-ui/chart", () => ({
  EChart: { props: ["option"], template: '<div class="legacy-chart" />' },
  MetricChart: { props: ["file", "metric"], template: '<div class="platform-chart"><span class="metric">{{ JSON.stringify(metric) }}</span></div>' },
  useChartTheme: () => ref({ color: ["#111111"] }),
}));

const ChartRenderer = (await import("../renderers/ChartRenderer.vue")).default;

const file = {
  dataset: [{ id: "metric", dimensions: ["kind", "amount"], source: [{ kind: "甲", amount: 20 }] }],
  series: [{ id: "series-0", type: "bar", datasetId: "metric", encode: { x: "kind", y: "amount" } }],
  xAxis: { type: "category" },
  yAxis: { type: "value" },
  ontomato: { display: { formats: { amount: { kind: "number" } } } },
};

async function draw(text: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp({ render: () => h(ChartRenderer, {
    artifact: { id: "chart", runId: "run", path: "outputs/chart.chart.json" } as never,
    title: "Chart", presentation: "inline",
    read: async () => new Blob([text]),
  }) });
  app.provide(shellContextKey, { labels: ref({ loading: "Loading…", invalidChart: "This chart file could not be drawn.", chartUndated: "Undated", noChartRows: "No rows to draw." }) } as unknown as ShellContext);
  app.mount(root);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  return { root, app };
}

it("draws a chart file with the platform chart and a legacy option as it was stored", async () => {
  const platform = await draw(JSON.stringify(file));
  try {
    expect(platform.root.querySelector(".platform-chart")).not.toBeNull();
    expect(platform.root.querySelector(".legacy-chart")).toBeNull();
    // The shell hands the platform chart the file's own snapshot as a metric output: its columns and its rows.
    expect(JSON.parse(platform.root.querySelector(".metric")!.textContent!)).toEqual({
      columns: [{ key: "kind" }, { key: "amount" }],
      rows: [{ kind: "甲", amount: 20 }],
    });
  } finally { platform.app.unmount(); platform.root.remove(); }

  const legacy = await draw(JSON.stringify({ series: [{ type: "pie", data: [{ name: "甲", value: 1 }] }] }));
  try {
    expect(legacy.root.querySelector(".legacy-chart")).not.toBeNull();
    expect(legacy.root.querySelector(".platform-chart")).toBeNull();
  } finally { legacy.app.unmount(); legacy.root.remove(); }
});

it("says a file it cannot parse or read as an option could not be drawn", async () => {
  const broken = await draw("{ not json");
  try {
    expect(broken.root.textContent).toContain("This chart file could not be drawn.");
  } finally { broken.app.unmount(); broken.root.remove(); }
});
