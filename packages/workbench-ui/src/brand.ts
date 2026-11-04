import type { BrandSource } from "@ontomato/design-tokens";

/*
 * The edition's brand source, installed once by startWorkbenchWeb next to the generated stylesheet. Code that needs
 * the colour values themselves rather than CSS variables (ECharts options, gradients) reads them from here.
 */
let brand: BrandSource | null = null;

export function installWorkbenchBrand(next: BrandSource): void {
  brand = next;
}

export function workbenchBrand(): BrandSource {
  if (!brand) throw new Error("The workbench brand source is not installed (startWorkbenchWeb installs it)");
  return brand;
}
