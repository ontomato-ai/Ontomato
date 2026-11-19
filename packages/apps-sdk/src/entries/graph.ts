// Interactive G6 graph components: a dedicated module because G6 is large, so panels that draw no G6 graph (or only
// the light SVG canvas of `@ontomato/sdk/base`) never download it.
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
export { default as OntologyGraph } from "../base/OntologyGraph.vue";
export type {
  PlatformGraphEdge,
  PlatformGraphNeighborsQuery,
  PlatformGraphNeighborsResult,
  PlatformGraphNode,
  PlatformGraphRelationKindSpec,
  PlatformGraphRelationStatus,
  PlatformGraphSchema,
  PlatformGraphStatus,
  PlatformGraphTypeCount,
  PlatformGraphTypeSpec,
  PlatformObjectGraph,
} from "../panel/platform-objects";
