import { afterEach, describe, expect, it } from "vitest";
import { ossBrand } from "@ontomato/design-tokens/oss";
import type { BrandSource } from "@ontomato/design-tokens";
import { installWorkbenchBrand, workbenchBrand } from "../../../brand";
import { chartPalette, currentChartPalette, currentMode } from "../chart-palette";

/** A brand unlike the open-source one, to show the charts follow whichever brand the edition installs. */
const other: BrandSource = {
  ...ossBrand,
  light: { ...ossBrand.light, ink: "#101010", surface: "#fafafa" },
  dataviz: {
    light: ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777", "#888888"],
    dark: ["#999999", "#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd", "#eeeeee", "#121212", "#232323"],
  },
};

afterEach(() => {
  installWorkbenchBrand(ossBrand);
});

/** DESIGN.md "Charts": dashboard and agent chart colours come from the brand source, not from a copy. */
describe("chart colours", () => {
  it("are the brand's dataviz palette and neutral roles in each mode", () => {
    for (const mode of ["light", "dark"] as const) {
      const palette = chartPalette(ossBrand, mode);
      expect(palette.series).toEqual(ossBrand.dataviz[mode]);
      expect(palette.text).toBe(ossBrand[mode].ink);
      expect(palette.textSecondary).toBe(ossBrand[mode].muted);
      expect(palette.line).toBe(ossBrand[mode].line);
      expect(palette.surface).toBe(ossBrand[mode].surface);
    }
  });

  it("follow the brand the edition installs, read when asked", () => {
    installWorkbenchBrand(other);
    expect(workbenchBrand()).toBe(other);
    const palette = currentChartPalette();
    expect(palette.series).toEqual(other.dataviz[currentMode()]);
    expect(palette.text).toBe(other[currentMode()].ink);
  });
});
