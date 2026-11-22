import { expect, it } from "vitest";
import { zoomKeepingNamesApart } from "../name-room";

/*
 * Where a fit stops shrinking a graph whose names keep their size on screen (panelisation lead, 2026-11-22): at the
 * smallest zoom at which no two names overlap, so one fit either shows the whole graph with every name, or stops where
 * names would start to cover one another. Names are boxes of fixed screen size centred under their nodes; two of them
 * are apart once they clear each other side to side or top to bottom.
 */

const name = (x: number, y: number, width = 100, height = 16) => ({ x, y, width, height });

it("needs two names in one row to clear each other side to side", () => {
  // 220 graph units apart, names 100 and 120 wide with 4 to spare: 114 pixels between centres.
  expect(zoomKeepingNamesApart([name(0, 0, 100), name(220, 0, 120)], 4)).toBeCloseTo(114 / 220);
});

it("needs two names in one column to clear each other top to bottom", () => {
  expect(zoomKeepingNamesApart([name(0, 0), name(0, 76)], 4)).toBeCloseTo(20 / 76);
});

it("takes the easier way apart for a pair, and the hardest pair for the graph", () => {
  // Diagonal neighbours clear each other top to bottom long before side to side.
  const diagonal = zoomKeepingNamesApart([name(0, 0, 160), name(220, 76, 160)], 4);
  expect(diagonal).toBeCloseTo(20 / 76);
  // The graph needs what its tightest pair needs.
  expect(zoomKeepingNamesApart([name(0, 0, 160), name(220, 76, 160), name(440, 76, 160)], 4)).toBeCloseTo(164 / 220);
});

it("needs nothing of a graph of one name or none", () => {
  expect(zoomKeepingNamesApart([name(0, 0)], 4)).toBe(0);
  expect(zoomKeepingNamesApart([], 4)).toBe(0);
});
