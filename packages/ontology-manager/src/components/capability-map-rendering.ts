/**
 * Geometry and labels for the capability map.
 *
 * <p>Positions are computed rather than measured, for the same reason the instance graph computes its overview: there
 * is no force simulation to settle, so a redraw lands in the same place and a screenshot from yesterday still matches
 * the graph from today. Nodes are laid out in one ring per layer — governance inside, capability outside — because
 * authority flows outward: a subject holds a role, the role reaches a capability. A ring also keeps the two layers
 * visually separate without drawing a border between them.</p>
 */

export type CapabilityLayer = "governance" | "capability";

export interface CapabilityNode {
  id: string;
  kind: "subject" | "role" | "action" | "workflow" | "trigger" | "metric" | "function" | "skill";
  layer: CapabilityLayer;
  label: string;
  detail: string;
}

export interface CapabilityEdge {
  from: string;
  to: string;
  label: string;
  derived?: boolean;
}

const TAU = Math.PI * 2;

/** The golden angle spreads nodes evenly without rows collapsing onto each other. */
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * One ring per layer, nodes distributed by the golden angle so two nodes never share a spoke.
 *
 * <p>A layer with a single node sits at the centre rather than on a degenerate ring: a ring of radius zero would put
 * it under the other layer's first node.</p>
 */
export function capabilityMapPositions(nodes: CapabilityNode[]) {
  const governance = nodes.filter((node) => node.layer === "governance");
  const capability = nodes.filter((node) => node.layer === "capability");
  const positions: Record<string, { x: number; y: number }> = {};

  const placeRing = (items: CapabilityNode[], baseRadius: number, growth: number, angleOffset: number) => {
    if (items.length === 0) return;
    if (items.length === 1) {
      const only = items[0]!;
      positions[only.id] = { x: 0, y: 0 };
      return;
    }
    // Radius grows with the square root of the count so spacing stays roughly constant as a domain grows.
    const radius = baseRadius + Math.sqrt(items.length) * growth;
    items.forEach((node, index) => {
      const angle = angleOffset + index * GOLDEN_ANGLE;
      positions[node.id] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
  };

  placeRing(governance, 0, 150, 0);
  placeRing(capability, 300, 210, Math.PI / 7);
  return positions;
}

/**
 * A node's label, cut at a readable length.
 *
 * <p>Cut by code point rather than by UTF-16 unit: a CJK name sliced mid-surrogate would draw a replacement glyph.
 * The threshold is generous here because a capability name ("审批通过@v5") carries more meaning than an instance id.</p>
 */
export function capabilityNodeLabel(label: string | undefined, limit = 22) {
  const text = label?.trim() || "—";
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : text;
}

/** One node's neighbours, for the relation list beside the graph. */
export function capabilityNeighbours(edges: CapabilityEdge[], id: string) {
  return edges.filter((edge) => edge.from === id || edge.to === id);
}
