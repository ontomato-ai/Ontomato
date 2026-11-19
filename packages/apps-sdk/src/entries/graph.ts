// The graph canvas drawn by G6, for graphs a reader pans, zooms and drags. It has its own module because G6 is large: a
// panel that draws no such graph, or only the light SVG canvas of `@ontomato/sdk/base`, never downloads it.
export {
  G6GraphCanvas,
  type GraphCanvasEdge,
  type GraphCanvasElement,
  type GraphCanvasLayout,
  type GraphCanvasNode,
  type GraphCanvasPoint,
  type GraphCanvasSelection,
  type GraphCanvasTone,
  type GraphCanvasViewport,
} from "@ontomato/foundation-ui/graph/g6";
