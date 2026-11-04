import { afterEach, describe, expect, it } from "vitest";
import { defaultChartTheme } from "../chart-theme";

afterEach(() => document.documentElement.removeAttribute("style"));

/** The shell's default chart colours are the host brand's `--chart-*` palette, never a palette of its own. */
describe("default chart theme", () => {
  it("takes the series colours and text from the host's brand variables", () => {
    const root = document.documentElement.style;
    ["#111111", "#222222", "#333333"].forEach((color, index) => root.setProperty(`--chart-${index + 1}`, color));
    root.setProperty("--el-text-color-primary", "#010101");
    const theme = defaultChartTheme(false);
    expect(theme.color).toEqual(["#111111", "#222222", "#333333"]);
    expect(theme.textStyle).toEqual({ color: "#010101" });
  });

  it("leaves ECharts' defaults in place when the host sets no brand", () => {
    expect(defaultChartTheme(false).color).toBeUndefined();
  });
});
