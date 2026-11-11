import { afterEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h, type Ref } from "vue";
import { useChartTheme, chartTheme } from "../index";

// A brand stylesheet as @ontomato/design-tokens writes one: the light values on :root, the dark ones on html.dark.
const brand = document.createElement("style");
brand.textContent = `
  :root { --chart-1: #111111; --chart-2: #222222; --chart-sequential-1: #a1a1a1; --chart-sequential-2: #a2a2a2;
    --el-bg-color: #ffffff; --el-text-color-primary: #101010; --el-text-color-secondary: #202020; --el-border-color: #303030; }
  html.dark { --chart-1: #eeeeee; --chart-2: #dddddd; --chart-sequential-1: #b1b1b1; --chart-sequential-2: #b2b2b2;
    --el-bg-color: #1c1f1a; --el-text-color-primary: #f0f0f0; --el-text-color-secondary: #e0e0e0; --el-border-color: #d0d0d0; }`;
document.head.append(brand);
afterEach(() => document.documentElement.classList.remove("dark"));

// Every chart of the platform is drawn in this one theme: the brand's colours of the mode the page shows.
it("draws in the brand's colours of the mode the page shows, and in the dark ones once it switches to dark", async () => {
  let theme!: Readonly<Ref<Record<string, unknown>>>;
  mount({
    setup() {
      theme = useChartTheme();
      return () => h("div");
    },
  });
  expect(theme.value).toMatchObject({
    color: ["#111111", "#222222"],
    // The chart paints the surface behind its text, so the dark text never lands on a light chart area.
    backgroundColor: "#ffffff",
    textStyle: { color: "#101010" },
    tooltip: { axisPointer: { lineStyle: { color: "#303030" } } },
    visualMap: { inRange: { color: ["#a1a1a1", "#a2a2a2"] }, textStyle: { color: "#202020" } },
  });

  document.documentElement.classList.add("dark");
  await vi.waitFor(() => expect(theme.value).toMatchObject({
    color: ["#eeeeee", "#dddddd"],
    backgroundColor: "#1c1f1a",
    textStyle: { color: "#f0f0f0" },
    tooltip: { axisPointer: { lineStyle: { color: "#d0d0d0" } } },
    visualMap: { inRange: { color: ["#b1b1b1", "#b2b2b2"] }, textStyle: { color: "#e0e0e0" } },
  }));
});

// Long Chinese category names are the common case: the theme keeps every category's label from running into its
// neighbours, so a chart that only maps rows to a category axis stays readable without any option of its own.
it("keeps category labels from overlapping", () => {
  expect(chartTheme()).toMatchObject({
    categoryAxis: { axisLabel: { hideOverlap: true, width: 80, overflow: "truncate" } },
  });
});
