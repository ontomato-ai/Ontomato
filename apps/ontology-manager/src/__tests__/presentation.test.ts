import { describe, expect, it } from "vitest";
import { brandProperties } from "@ontomato/design-tokens";
import { ossBrand } from "@ontomato/design-tokens/oss";
import { ossPresentation } from "../presentation";

describe("open-source Manager presentation", () => {
  it("takes its colours from the open-source brand source, the same source as the workbench theme", () => {
    for (const mode of ["light", "dark"] as const) {
      const properties = ossPresentation.themeProperties[mode];
      const brand = brandProperties(ossBrand, mode);
      expect(properties).toMatchObject(brand);
      // Everything else is a component property, never a second copy of a colour role.
      expect(Object.keys(properties).filter((name) => !(name in brand) && !name.startsWith("--manager-"))).toEqual([]);
    }
  });

  it("colours graph nodes with the brand's categorical palette of each theme", () => {
    expect(ossPresentation.nodePalette).toBe(ossBrand.dataviz);
  });
});
