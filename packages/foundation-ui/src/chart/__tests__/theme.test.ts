import { afterEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { h, type Ref } from "vue";
import { useChartTheme, chartTheme } from "../index";

// A brand stylesheet as @ontomato/design-tokens writes one: the light values on :root, the dark ones on html.dark.
const brand = document.createElement("style");
brand.textContent = `
  :root { --chart-1: #111111; --chart-2: #222222; --chart-sequential-1: #a1a1a1; --chart-sequential-2: #a2a2a2;
    --el-text-color-primary: #101010; --el-text-color-secondary: #202020; --el-border-color: #303030; }
  html.dark { --chart-1: #eeeeee; --chart-2: #dddddd; --chart-sequential-1: #b1b1b1; --chart-sequential-2: #b2b2b2;
    --el-text-color-primary: #f0f0f0; --el-text-color-secondary: #e0e0e0; --el-border-color: #d0d0d0; }`;
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
    darkMode: false,
    color: ["#111111", "#222222"],
    visualMap: { inRange: { color: ["#a1a1a1", "#a2a2a2"] } },
  });

  document.documentElement.classList.add("dark");
  // ECharts is told the page is dark: a transparent chart gives it nothing to tell that from.
  await vi.waitFor(() => expect(theme.value).toMatchObject({
    darkMode: true,
    color: ["#eeeeee", "#dddddd"],
    visualMap: { inRange: { color: ["#b1b1b1", "#b2b2b2"] } },
  }));
});

// Category labels keep the space their neighbours have: a label that would run into the next one is hidden, and a
// roomy chart keeps every name whole. The theme caps no label's width, because a fixed width would cut names that fit.
it("keeps category labels from overlapping without capping their width", () => {
  const axisLabel = (chartTheme().categoryAxis as { axisLabel: Record<string, unknown> }).axisLabel;
  expect(axisLabel).toMatchObject({ hideOverlap: true });
  expect(axisLabel).not.toHaveProperty("width");
  expect(axisLabel).not.toHaveProperty("overflow");
});
