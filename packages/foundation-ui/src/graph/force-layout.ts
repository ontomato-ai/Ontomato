import { G6_LABEL_SIZE, G6_LABEL_WIDTH, G6_NODE_SIZE } from "./g6-elements";
import type { LayoutRoom, RelationLayout, RelationLayoutLook } from "./relation-layout";
import type { GraphCanvasEdge, GraphCanvasNode, GraphCanvasPoint } from "./types";

/*
 * Deterministic radial + force-directed layout for ontology and conceptual graphs.
 * Connected components open radially around their highest-degree hub and relax with spring, repulsion, and collision
 * forces so edges fan out cleanly with room for labels and never pierce unrelated node labels. Separate components
 * and isolated nodes are then packed to match the viewport aspect ratio so the whole graph stays readable at a glance.
 */

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

function seededRandom(seed = 20260915) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function measureBounds(points: ReadonlyMap<string, Point>, padX: number, padTop: number, padBottom: number): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points.values()) {
    if (point.x - padX < minX) minX = point.x - padX;
    if (point.x + padX > maxX) maxX = point.x + padX;
    if (point.y - padTop < minY) minY = point.y - padTop;
    if (point.y + padBottom > maxY) maxY = point.y + padBottom;
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Lays out a single connected component radially from its hub, then runs deterministic spring-repulsion-collision
 * relaxation so edges have generous length for labels and no two nodes or labels overlap.
 */
function layoutComponent(
  members: readonly string[],
  root: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  edges: readonly { source: string; target: string }[],
  nodeSize: number,
  labelSize: number,
  rand: () => number,
): Map<string, Point> {
  const linkDist = Math.max(180, nodeSize * 3);
  const minCenterDist = Math.max(nodeSize + 64, 128);
  const labelHeight = Math.round(labelSize * 1.4 + 10);
  const minVerticalClearance = nodeSize + labelHeight + 28;
  const labelSpanX = Math.min(G6_LABEL_WIDTH, Math.max(120, nodeSize * 2.2));

  // BFS radial seeding: root at origin, 1-hop around a full circle, deeper hops fanning outward along parent angle.
  const depth = new Map<string, number>([[root, 0]]);
  const parent = new Map<string, string>();
  const children = new Map<string, string[]>(members.map((id) => [id, []]));
  const queue = [root];
  while (queue.length) {
    const current = queue.shift()!;
    const nextDepth = depth.get(current)! + 1;
    for (const next of adjacency.get(current) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, nextDepth);
        parent.set(next, current);
        children.get(current)!.push(next);
        queue.push(next);
      }
    }
  }

  const coords = new Map<string, Point>([[root, { x: 0, y: 0 }]]);
  const angles = new Map<string, number>([[root, 0]]);
  const placeChildren = (nodeId: string) => {
    const kids = children.get(nodeId) ?? [];
    if (!kids.length) return;
    const origin = coords.get(nodeId)!;
    const d = depth.get(nodeId)!;
    const baseAngle = d === 0 ? -Math.PI * 0.78 : angles.get(nodeId)!;
    const spread = d === 0 ? Math.PI * 2 : Math.min(Math.PI * 1.1, Math.max(Math.PI / 3, (kids.length - 1) * 0.65));
    kids.forEach((kid, index) => {
      const angle = d === 0
        ? baseAngle + (index * spread) / kids.length
        : kids.length === 1
          ? baseAngle
          : baseAngle - spread / 2 + (index * spread) / (kids.length - 1);
      const jitter = (rand() - 0.5) * 0.08;
      const theta = angle + jitter;
      angles.set(kid, theta);
      coords.set(kid, {
        x: origin.x + Math.cos(theta) * linkDist,
        y: origin.y + Math.sin(theta) * linkDist,
      });
      placeChildren(kid);
    });
  };
  placeChildren(root);

  if (members.length <= 2) {
    return coords;
  }

  // Deterministic force-directed relaxation with collision avoidance.
  const velocity = new Map<string, Point>(members.map((id) => [id, { x: 0, y: 0 }]));
  const iterations = 120;
  const repulsion = Math.max(36000, linkDist * linkDist * 1.45);
  const springK = 0.055;
  const damping = 0.78;
  const maxStep = 28;

  for (let step = 0; step < iterations; step += 1) {
    const cooling = 1 - step / (iterations * 1.15);
    const forces = new Map<string, Point>(members.map((id) => [id, { x: 0, y: 0 }]));

    // Pairwise repulsion.
    for (let i = 0; i < members.length; i += 1) {
      const aId = members[i]!;
      const a = coords.get(aId)!;
      const fa = forces.get(aId)!;
      for (let j = i + 1; j < members.length; j += 1) {
        const bId = members[j]!;
        const b = coords.get(bId)!;
        const fb = forces.get(bId)!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const distSq = dx * dx + dy * dy + 1;
        const dist = Math.sqrt(distSq);
        if (dist < 0.01) {
          dx = (rand() - 0.5) * 2;
          dy = (rand() - 0.5) * 2;
        }
        const mag = repulsion / distSq;
        const fx = (dx / dist) * mag;
        const fy = (dy / dist) * mag;
        fa.x -= fx;
        fa.y -= fy;
        fb.x += fx;
        fb.y += fy;
      }
    }

    // Spring attraction along edges toward target linkDist.
    for (const edge of edges) {
      const a = coords.get(edge.source);
      const b = coords.get(edge.target);
      if (!a || !b || edge.source === edge.target) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const stretch = (dist - linkDist) * springK;
      const fx = (dx / dist) * stretch;
      const fy = (dy / dist) * stretch;
      const fa = forces.get(edge.source)!;
      const fb = forces.get(edge.target)!;
      fa.x += fx;
      fa.y += fy;
      fb.x -= fx;
      fb.y -= fy;
    }

    // Gentle centering pull so the component stays cohesive.
    let cx = 0;
    let cy = 0;
    for (const point of coords.values()) {
      cx += point.x;
      cy += point.y;
    }
    cx /= members.length;
    cy /= members.length;
    for (const id of members) {
      const p = coords.get(id)!;
      const f = forces.get(id)!;
      f.x -= (p.x - cx) * 0.012;
      f.y -= (p.y - cy) * 0.012;
    }

    // Integrate velocity and clamp displacement.
    for (const id of members) {
      const p = coords.get(id)!;
      const v = velocity.get(id)!;
      const f = forces.get(id)!;
      v.x = (v.x + f.x * cooling) * damping;
      v.y = (v.y + f.y * cooling) * damping;
      const mag = Math.hypot(v.x, v.y);
      if (mag > maxStep) {
        v.x = (v.x / mag) * maxStep;
        v.y = (v.y / mag) * maxStep;
      }
      p.x += v.x;
      p.y += v.y;
    }

    // Hard collision separation (radial + vertical label clearance).
    for (let i = 0; i < members.length; i += 1) {
      const a = coords.get(members[i]!)!;
      for (let j = i + 1; j < members.length; j += 1) {
        const b = coords.get(members[j]!)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist < minCenterDist) {
          const push = (minCenterDist - dist) / 2;
          const nx = dist > 0.01 ? dx / dist : 1;
          const ny = dist > 0.01 ? dy / dist : 0;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        } else if (Math.abs(dx) < labelSpanX * 0.65 && Math.abs(dy) < minVerticalClearance) {
          const pushY = (minVerticalClearance - Math.abs(dy)) / 2;
          const sign = dy >= 0 ? 1 : -1;
          a.y -= sign * pushY;
          b.y += sign * pushY;
        }
      }
    }
  }

  return coords;
}

/**
 * Places every node by deterministic radial force-directed layout: each connected component radiates organically around
 * its most connected hub with generous edge length and collision clearance, and components plus isolated nodes are
 * packed onto shelves that best fit the available canvas room.
 */
export function layoutByForce(
  nodes: readonly GraphCanvasNode[],
  edges: readonly GraphCanvasEdge[],
  room: LayoutRoom,
  look: RelationLayoutLook = {},
): RelationLayout {
  if (!nodes.length) return { positions: new Map(), root: undefined };

  const nodeSize = look.nodeSize ?? G6_NODE_SIZE;
  const labelSize = look.labelSize ?? G6_LABEL_SIZE;
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const { source, target } of edges) {
    if (source === target || !adjacency.has(source) || !adjacency.has(target)) continue;
    adjacency.get(source)!.add(target);
    adjacency.get(target)!.add(source);
  }
  const byOrder = (a: string, b: string) => order.get(a)! - order.get(b)!;
  const degree = (id: string) => adjacency.get(id)!.size;

  // Separate connected components (largest first) and isolated nodes.
  const seen = new Set<string>();
  const components: { root: string; members: string[] }[] = [];
  const alone: string[] = [];
  for (const { id } of nodes) {
    if (seen.has(id)) continue;
    if (!degree(id)) {
      seen.add(id);
      alone.push(id);
      continue;
    }
    const members: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length) {
      const current = queue.shift()!;
      members.push(current);
      for (const next of [...adjacency.get(current)!].sort(byOrder)) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    members.sort(byOrder);
    const root = members.reduce((best, candidate) => (degree(candidate) > degree(best) ? candidate : best));
    components.push({ root, members });
  }
  components.sort((a, b) => b.members.length - a.members.length || byOrder(a.root, b.root));

  const rand = seededRandom();
  const padX = Math.max(G6_LABEL_WIDTH / 2, nodeSize);
  const padTop = nodeSize / 2 + 24;
  const padBottom = nodeSize / 2 + Math.round(labelSize * 1.5) + 20;
  const gap = Math.max(96, Math.round(nodeSize * 1.5));

  interface PlacedBlock {
    points: Map<string, Point>;
    bounds: Bounds;
  }

  const blocks: PlacedBlock[] = components.map(({ root, members }) => {
    const memberSet = new Set(members);
    const componentEdges = edges.filter((e) => memberSet.has(e.source) && memberSet.has(e.target));
    const points = layoutComponent(members, root, adjacency, componentEdges, nodeSize, labelSize, rand);
    return { points, bounds: measureBounds(points, padX, padTop, padBottom) };
  });

  // Pack isolated nodes into a tidy sparse grid block whose columns adapt to the room width.
  if (alone.length) {
    const cellX = Math.max(G6_LABEL_WIDTH + 48, nodeSize * 3.2);
    const cellY = Math.max(nodeSize + Math.round(labelSize * 1.5) + 48, 128);
    const cols = room.width >= room.height
      ? Math.min(alone.length, Math.max(2, Math.ceil(Math.sqrt(alone.length * 1.8))))
      : Math.min(alone.length, Math.max(1, Math.ceil(Math.sqrt(alone.length * 0.8))));
    const points = new Map<string, Point>();
    alone.forEach((id, index) => {
      points.set(id, {
        x: (index % cols) * cellX,
        y: Math.floor(index / cols) * cellY,
      });
    });
    blocks.push({ points, bounds: measureBounds(points, padX, padTop, padBottom) });
  }

  // Choose the shelf arrangement (horizontal rows of blocks) that maximizes the fit zoom inside `room`.
  const safeW = Math.max(320, room.width);
  const safeH = Math.max(320, room.height);
  const totalWidth = blocks.reduce((sum, block) => sum + block.bounds.width, 0) + gap * Math.max(0, blocks.length - 1);
  const maxBlockWidth = Math.max(...blocks.map((block) => block.bounds.width));

  interface Shelf {
    blocks: PlacedBlock[];
    width: number;
    height: number;
  }

  const pack = (maxShelfWidth: number): Shelf[] => {
    const shelves: Shelf[] = [];
    for (const block of blocks) {
      const target = shelves.find((shelf) => shelf.width + gap + block.bounds.width <= maxShelfWidth);
      if (target) {
        target.blocks.push(block);
        target.width += gap + block.bounds.width;
        target.height = Math.max(target.height, block.bounds.height);
      } else {
        shelves.push({ blocks: [block], width: block.bounds.width, height: block.bounds.height });
      }
    }
    return shelves;
  };

  // Evaluate candidate shelf widths (every prefix/subset width boundary between widest block and single row).
  const candidateWidths = new Set<number>([maxBlockWidth, totalWidth]);
  for (let i = 0; i < blocks.length; i += 1) {
    let acc = blocks[i]!.bounds.width;
    candidateWidths.add(acc);
    for (let j = i + 1; j < blocks.length; j += 1) {
      acc += gap + blocks[j]!.bounds.width;
      candidateWidths.add(acc);
    }
  }

  let bestShelves = pack(maxBlockWidth);
  let bestZoom = -1;
  for (const width of candidateWidths) {
    const shelves = pack(width);
    const totalW = Math.max(...shelves.map((shelf) => shelf.width));
    const totalH = shelves.reduce((sum, shelf) => sum + shelf.height, 0) + gap * Math.max(0, shelves.length - 1);
    const zoom = Math.min(safeW / totalW, safeH / totalH);
    if (zoom > bestZoom) {
      bestZoom = zoom;
      bestShelves = shelves;
    }
  }

  // Place shelves centered horizontally on the widest shelf so the graph looks balanced in the canvas.
  const widestShelf = Math.max(...bestShelves.map((shelf) => shelf.width));
  const positions = new Map<string, GraphCanvasPoint>();
  let top = 0;
  for (const shelf of bestShelves) {
    let left = (widestShelf - shelf.width) / 2;
    for (const block of shelf.blocks) {
      const offsetX = left - block.bounds.minX;
      const offsetY = top + (shelf.height - block.bounds.height) / 2 - block.bounds.minY;
      for (const [id, point] of block.points) {
        positions.set(id, {
          x: Math.round(point.x + offsetX),
          y: Math.round(point.y + offsetY),
        });
      }
      left += block.bounds.width + gap;
    }
    top += shelf.height + gap;
  }

  return { positions, root: components[0]?.root ?? alone[0] };
}
