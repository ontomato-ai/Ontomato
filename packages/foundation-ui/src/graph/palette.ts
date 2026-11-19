/*
 * The colours a graph gives its categories: the edition's categorical palette (`--chart-1`, `--chart-2`, … in the brand
 * stylesheet, DESIGN.md `dataviz.categorical`), the same one charts take. Light and dark have the same number of
 * colours in the same order, so a category keeps its slot when the mode changes.
 */

/** The categorical palette in effect at `element`: `--chart-1`, `--chart-2`, … up to the first the brand does not set. */
export function readGraphPalette(element: Element): string[] {
  const style = getComputedStyle(element);
  const palette: string[] = [];
  let value = style.getPropertyValue("--chart-1").trim();
  while (value) {
    palette.push(value);
    value = style.getPropertyValue(`--chart-${palette.length + 1}`).trim();
  }
  return palette;
}

/**
 * Which colour of a palette of `size` a category takes. A category listed in `categories` takes the colour of its place
 * in the list, so a fixed set of kinds gets distinct colours in a fixed order; any other is placed by a hash of its name,
 * so it keeps its colour whatever else the graph holds.
 */
export function graphCategorySlot(category: string, categories: readonly string[], size: number): number {
  const index = categories.indexOf(category);
  if (index >= 0) return index % size;
  let hash = 5381;
  for (const character of category) hash = (hash * 33) ^ character.charCodeAt(0);
  return (hash >>> 0) % size;
}
