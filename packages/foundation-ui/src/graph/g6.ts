// The G6 graph canvas: its own entry, so a page or panel that draws only the light SVG canvas never downloads G6.
export { default as G6GraphCanvas } from "./G6GraphCanvas.vue";
export { G6_LABEL_SIZE, G6_LABEL_WIDTH, G6_NODE_SIZE } from "./g6-elements";
export { graphCategorySlot, readGraphPalette } from "./palette";
export type {
  GraphCanvasEdge,
  GraphCanvasElement,
  GraphCanvasLayout,
  GraphCanvasNode,
  GraphCanvasPoint,
  GraphCanvasSelection,
  GraphCanvasTone,
  GraphCanvasViewport,
} from "./types";
