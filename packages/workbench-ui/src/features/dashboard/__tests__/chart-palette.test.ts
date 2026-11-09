import { afterEach, describe, expect, it } from "vitest";
import { ossBrand } from "@ontomato/design-tokens/oss";
import type { BrandSource } from "@ontomato/design-tokens";
import { installWorkbenchBrand } from "../../../brand";
import { chartPalette } from "../chart-palette";
import { nativeEchartsTheme } from "../components/utils/echartsTheme";
import { EchartsGenerator } from "../components/utils/echartsGenerator";

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
      expect(palette.sequential[4]).toBe(ossBrand[mode].primary);
    }
  });

  it("follow the installed brand in each mode", () => {
    installWorkbenchBrand(other);
    expect(nativeEchartsTheme(false).color).toEqual(other.dataviz.light);
    expect(nativeEchartsTheme(false).textStyle).toEqual({ color: "#101010" });
    expect(nativeEchartsTheme(true).color).toEqual(other.dataviz.dark);
  });

  it("reach the generated dashboard options", () => {
    installWorkbenchBrand(other);
    const option = EchartsGenerator.generate("pie", "Share", { x: "name", y: "value" }, [
      { name: "a", value: 1 },
      { name: "b", value: 2 },
    ]);
    const text = JSON.stringify(option);
    expect(text).toContain("#fafafa");
    expect(text).not.toMatch(new RegExp(ossBrand.light.surface, "i"));
  });
});
