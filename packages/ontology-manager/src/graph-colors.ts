/**
 * Graph canvas colours read from the page's colour roles at the graph element, in either mode. G6 and X6 draw on a
 * canvas or SVG attributes, so they take resolved values; the roles themselves come from the edition's brand source.
 * Nodes and edges carry no shadow (DESIGN: graph node, flat data shell).
 */
export function readGraphColors(element: Element) {
  const styles = getComputedStyle(element);
  const role = (name: string) => styles.getPropertyValue(name).trim();
  return {
    /** ink: node labels */
    text: role("--el-text-color-primary"),
    /** muted: edge labels */
    muted: role("--el-text-color-secondary"),
    /** surface: label backgrounds and the ring around nodes */
    surface: role("--el-bg-color"),
    /** line-strong: edges */
    edge: role("--el-border-color-dark"),
    /** line: the canvas dot grid */
    line: role("--el-border-color"),
    nodeStroke: role("--el-bg-color"),
    primary: role("--el-color-primary"),
    /** Search and path hits. */
    highlight: role("--el-color-warning"),
    highlightSoft: role("--el-color-warning-light-7"),
    success: role("--el-color-success"),
    successSoft: role("--el-color-success-light-9"),
    shadow: "transparent",
  };
}

export type GraphColors = ReturnType<typeof readGraphColors>;
