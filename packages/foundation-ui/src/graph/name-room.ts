/*
 * Where a fit stops shrinking a graph whose names keep their size on screen at every zoom (panelisation lead,
 * 2026-11-22): at the smallest zoom at which no two names overlap. Below it the canvas hides a name that would cover
 * another, so a fit that went lower would show the whole graph without some of its names; a reader may still zoom
 * further themselves.
 */

/** A node's name: its node's place in graph units, and the box it is drawn in on screen, in pixels. */
export interface NameBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The smallest zoom at which every two names clear each other, side to side or top to bottom, by `spare` pixels: each
 * pair needs the lesser of the two ways apart, and the graph what its tightest pair needs.
 */
export function zoomKeepingNamesApart(names: readonly NameBox[], spare: number): number {
  let needed = 0;
  for (let a = 0; a < names.length; a += 1) for (let b = a + 1; b < names.length; b += 1) {
    const [one, other] = [names[a]!, names[b]!];
    const across = Math.abs(one.x - other.x), down = Math.abs(one.y - other.y);
    const sideways = across ? ((one.width + other.width) / 2 + spare) / across : Infinity;
    const stacked = down ? ((one.height + other.height) / 2 + spare) / down : Infinity;
    needed = Math.max(needed, Math.min(sideways, stacked));
  }
  return needed;
}
