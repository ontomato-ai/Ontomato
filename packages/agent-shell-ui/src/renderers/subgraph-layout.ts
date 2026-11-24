import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";

/**
 * Projects a `QuerySubgraph` into an ABC-style ontology query path layout (object classes connected by
 * ontology relations) plus compact operation/output lineage details. Consumes only the graph's declared
 * nodes, edges and filters; never parses DSL/Python or invents relationships.
 */

type GraphNode = QuerySubgraph["nodes"][number];
type ClassNode = Extract<GraphNode, { kind: "class" }>;
type FieldNode = Extract<GraphNode, { kind: "field" }>;
type OperationNode = Extract<GraphNode, { kind: "operation" }>;
type OutputNode = Extract<GraphNode, { kind: "output" }>;
type RelationEdge = Extract<QuerySubgraph["edges"][number], { kind: "relation" }>;
type DependencyEdge = Extract<QuerySubgraph["edges"][number], { kind: "dependency" }>;
type GraphFilter = QuerySubgraph["filters"][number];

export interface SubgraphFilterItem {
  id: string;
  label: string;
  expression: string;
  /** Human-readable field labels on this class targeted by the filter, if any. */
  targetFieldLabels: string[];
}

export interface SubgraphFieldItem {
  id: string;
  label: string;
  attrName: string;
  /** True when at least one filter targets this field. */
  filtered: boolean;
}

export interface SubgraphClassNode {
  id: string;
  label: string;
  className: string;
  variable: string;
  /** True when the same query contains another occurrence with the same label or className. */
  showVariable: boolean;
  fields: SubgraphFieldItem[];
  filters: SubgraphFilterItem[];
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SubgraphRelationEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  displayLabel: string;
  tooltip: string;
  direction: RelationEdge["direction"];
  path: string;
  labelX: number;
  labelY: number;
  startArrow: boolean;
  endArrow: boolean;
}

export interface SubgraphQueryBand {
  queryId: string;
  queryLabel: string;
  classes: SubgraphClassNode[];
  edges: SubgraphRelationEdge[];
  width: number;
  height: number;
}

export interface SubgraphInputRef {
  id: string;
  label: string;
  role: DependencyEdge["role"];
}

export interface SubgraphOperationItem {
  id: string;
  label: string;
  operation: OperationNode["operation"];
  queryId: string | null;
  queryLabel: string | null;
  expression: string;
  inputs: SubgraphInputRef[];
  filters: SubgraphFilterItem[];
}

export interface SubgraphOutputItem {
  id: string;
  label: string;
  key: string;
  sourceId: string | null;
  sourceLabel: string | null;
  filters: SubgraphFilterItem[];
}

export interface SubgraphModel {
  bands: SubgraphQueryBand[];
  operations: SubgraphOperationItem[];
  outputs: SubgraphOutputItem[];
  unattachedFilters: SubgraphFilterItem[];
  hasClasses: boolean;
  hasDetails: boolean;
}

const CARD_HEIGHT = 58;
const CARD_MIN_WIDTH = 148;
const CARD_MAX_WIDTH = 220;
const ROW_GAP = 22;
const MIN_COL_GAP = 112;
const PAD_X = 20;
const PAD_Y = 18;
const ARROW_SETBACK = 2;

const WIDE_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;

/** Deterministic approximate pixel width so layout is identical across browsers, SSR and tests. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    if (WIDE_CHAR.test(ch)) width += fontSize;
    else if (/[A-ZMW@#%&]/.test(ch)) width += fontSize * 0.68;
    else if (/[il1.,:;|!'" ]/.test(ch)) width += fontSize * 0.34;
    else width += fontSize * 0.56;
  }
  return width;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hopSuffix(hops: RelationEdge["hops"]): string {
  if (hops.min === 1 && hops.max === 1) return "";
  return ` [${hops.min}–${hops.max ?? "∞"}]`;
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/** Cubic Bezier point at t = 0.5. */
function cubicMid(
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
) {
  return {
    x: 0.125 * x0 + 0.375 * x1 + 0.375 * x2 + 0.125 * x3,
    y: 0.125 * y0 + 0.375 * y1 + 0.375 * y2 + 0.125 * y3,
  };
}

function layoutBand(
  queryId: string,
  queryLabel: string,
  classNodes: ClassNode[],
  relationEdges: RelationEdge[],
  fieldsByClass: Map<string, SubgraphFieldItem[]>,
  filtersByClass: Map<string, SubgraphFilterItem[]>,
): SubgraphQueryBand {
  const labelCounts = new Map<string, number>();
  const classNameCounts = new Map<string, number>();
  for (const node of classNodes) {
    labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1);
    classNameCounts.set(node.className, (classNameCounts.get(node.className) ?? 0) + 1);
  }

  const orderIndex = new Map(classNodes.map((n, index) => [n.id, index]));

  // Build effective directed adjacency for left-to-right layering (ignoring self-loops).
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const node of classNodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of relationEdges) {
    if (edge.source === edge.target) continue;
    const from = edge.direction === "reverse" ? edge.target : edge.source;
    const to = edge.direction === "reverse" ? edge.source : edge.target;
    if (!outgoing.has(from) || !incoming.has(to)) continue;
    outgoing.get(from)!.push(to);
    incoming.get(to)!.push(from);
  }

  // Longest-path DAG rank with bounded iterations so cycles converge deterministically.
  const colOf = new Map<string, number>();
  for (const node of classNodes) colOf.set(node.id, 0);
  const maxSteps = Math.max(0, classNodes.length - 1);
  for (let step = 0; step < maxSteps; step++) {
    let changed = false;
    for (const node of classNodes) {
      const parentCol = colOf.get(node.id)!;
      for (const next of outgoing.get(node.id)!) {
        const current = colOf.get(next)!;
        if (parentCol + 1 > current && parentCol + 1 <= maxSteps) {
          colOf.set(next, parentCol + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Group into columns and order each column by predecessor barycenter to reduce crossings.
  const maxCol = Math.max(0, ...colOf.values());
  const columns: ClassNode[][] = Array.from({ length: maxCol + 1 }, () => []);
  for (const node of classNodes) columns[colOf.get(node.id)!]!.push(node);

  const rowOf = new Map<string, number>();
  for (let col = 0; col <= maxCol; col++) {
    const group = columns[col]!;
    if (col > 0) {
      group.sort((a, b) => {
        const parentsA = incoming.get(a.id)!.filter((p) => (colOf.get(p) ?? 0) < col);
        const parentsB = incoming.get(b.id)!.filter((p) => (colOf.get(p) ?? 0) < col);
        const avgA = parentsA.length
          ? parentsA.reduce((sum, p) => sum + (rowOf.get(p) ?? 0), 0) / parentsA.length
          : Number.POSITIVE_INFINITY;
        const avgB = parentsB.length
          ? parentsB.reduce((sum, p) => sum + (rowOf.get(p) ?? 0), 0) / parentsB.length
          : Number.POSITIVE_INFINITY;
        if (avgA !== avgB) return avgA - avgB;
        return (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0);
      });
    }
    group.forEach((node, row) => rowOf.set(node.id, row));
  }

  // Compute each node's natural width and each column's width.
  const nodeWidth = new Map<string, number>();
  const colWidths = columns.map((group) => {
    let maxW = CARD_MIN_WIDTH;
    for (const node of group) {
      const showVar = (labelCounts.get(node.label) ?? 0) > 1 || (classNameCounts.get(node.className) ?? 0) > 1;
      const titleWidth = estimateTextWidth(node.label, 13) + (showVar ? estimateTextWidth(node.variable, 11) + 18 : 0) + 46;
      const w = clamp(Math.ceil(titleWidth), CARD_MIN_WIDTH, CARD_MAX_WIDTH);
      nodeWidth.set(node.id, w);
      if (w > maxW) maxW = w;
    }
    return maxW;
  });

  // Compute dynamic horizontal gaps between adjacent columns from the widest relation pill crossing each gap,
  // plus room for same-column arcs that bulge to the right of a column.
  const colGaps = Array.from({ length: maxCol }, () => MIN_COL_GAP);
  for (const edge of relationEdges) {
    const c1 = colOf.get(edge.source);
    const c2 = colOf.get(edge.target);
    if (c1 === undefined || c2 === undefined) continue;
    const display = `${edge.label}${hopSuffix(edge.hops)}`;
    const pillW = clamp(Math.ceil(estimateTextWidth(display, 11) + 20), 56, 176);
    if (Math.abs(c1 - c2) === 1) {
      const gapIndex = Math.min(c1, c2);
      colGaps[gapIndex] = Math.max(colGaps[gapIndex]!, pillW + 44);
    } else if (c1 === c2 && edge.source !== edge.target && c1 < maxCol) {
      colGaps[c1] = Math.max(colGaps[c1]!, 46 + pillW + 24);
    }
  }

  // Column x offsets.
  const colX: number[] = [];
  let cursorX = PAD_X;
  for (let col = 0; col <= maxCol; col++) {
    colX.push(cursorX);
    cursorX += colWidths[col]! + (col < maxCol ? colGaps[col]! : 0);
  }
  const contentRight = cursorX + PAD_X;

  // Vertically center shorter columns relative to the tallest column.
  const maxRows = Math.max(1, ...columns.map((group) => group.length));
  const totalGridHeight = maxRows * CARD_HEIGHT + (maxRows - 1) * ROW_GAP;

  const placed = new Map<string, SubgraphClassNode>();
  const placedList: SubgraphClassNode[] = [];
  for (let col = 0; col <= maxCol; col++) {
    const group = columns[col]!;
    const groupHeight = group.length * CARD_HEIGHT + Math.max(0, group.length - 1) * ROW_GAP;
    const startY = PAD_Y + (totalGridHeight - groupHeight) / 2;
    group.forEach((node, row) => {
      const w = nodeWidth.get(node.id)!;
      const x = colX[col]! + (colWidths[col]! - w) / 2;
      const y = startY + row * (CARD_HEIGHT + ROW_GAP);
      const showVariable = (labelCounts.get(node.label) ?? 0) > 1 || (classNameCounts.get(node.className) ?? 0) > 1;
      const item: SubgraphClassNode = {
        id: node.id,
        label: node.label,
        className: node.className,
        variable: node.variable,
        showVariable,
        fields: fieldsByClass.get(node.id) ?? [],
        filters: filtersByClass.get(node.id) ?? [],
        col,
        row,
        x,
        y,
        width: w,
        height: CARD_HEIGHT,
      };
      placed.set(node.id, item);
      placedList.push(item);
    });
  }

  // Group parallel relation edges between the same pair of nodes so curves fan apart cleanly.
  const pairGroups = new Map<string, RelationEdge[]>();
  for (const edge of relationEdges) {
    const key = pairKey(edge.source, edge.target);
    pairGroups.set(key, [...(pairGroups.get(key) ?? []), edge]);
  }

  let minY = 0;
  let maxY = PAD_Y * 2 + totalGridHeight;
  let maxX = contentRight;
  let minX = 0;

  type RawEdge = {
    edge: RelationEdge;
    displayLabel: string;
    tooltip: string;
    startArrow: boolean;
    endArrow: boolean;
    points: [number, number, number, number, number, number, number, number];
    labelX: number;
    labelY: number;
  };
  const rawEdges: RawEdge[] = [];

  for (const edge of relationEdges) {
    const src = placed.get(edge.source);
    const tgt = placed.get(edge.target);
    if (!src || !tgt) continue;
    const siblings = pairGroups.get(pairKey(edge.source, edge.target)) ?? [edge];
    const siblingIndex = siblings.indexOf(edge);
    const offsetIndex = siblingIndex - (siblings.length - 1) / 2;

    const suffix = hopSuffix(edge.hops);
    const displayLabel = `${edge.label}${suffix}`;
    const meta = edge.name === edge.relationType ? edge.name : `${edge.name} · ${edge.relationType}`;
    const tooltip = `${displayLabel}\n${meta}`;
    const startArrow = edge.direction === "reverse" || edge.direction === "both";
    const endArrow = edge.direction === "forward" || edge.direction === "both";
    const startPad = startArrow ? ARROW_SETBACK : 0;
    const endPad = endArrow ? ARROW_SETBACK : 0;

    let points: [number, number, number, number, number, number, number, number];
    let labelX: number;
    let labelY: number;

    if (src.id === tgt.id) {
      // Self-loop above the class card.
      const cx = src.x + src.width / 2;
      const top = src.y;
      const loopHeight = 46 + siblingIndex * 24;
      const spread = 24 + siblingIndex * 6;
      const x0 = cx - 16;
      const y0 = top - startPad;
      const x1 = cx - spread - 18;
      const y1 = top - loopHeight;
      const x2 = cx + spread + 18;
      const y2 = top - loopHeight;
      const x3 = cx + 16;
      const y3 = top - endPad;
      points = [x0, y0, x1, y1, x2, y2, x3, y3];
      const mid = cubicMid(x0, y0, x1, y1, x2, y2, x3, y3);
      labelX = mid.x;
      labelY = mid.y - 6;
      const pillHalf = clamp(estimateTextWidth(displayLabel, 11) / 2 + 12, 30, 90);
      minY = Math.min(minY, labelY - 20);
      minX = Math.min(minX, labelX - pillHalf - PAD_X);
      maxX = Math.max(maxX, labelX + pillHalf + PAD_X);
    } else if (src.col === tgt.col) {
      // Same-column edge: arc gently to the right side of the column so the pill clears both cards cleanly.
      const bulge = 38 + Math.abs(offsetIndex) * 26 + Math.max(0, Math.abs(src.row - tgt.row) - 1) * 14;
      const x0 = src.x + src.width + startPad;
      const y0 = src.y + src.height / 2;
      const x3 = tgt.x + tgt.width + endPad;
      const y3 = tgt.y + tgt.height / 2;
      const cx = Math.max(x0, x3) + bulge;
      points = [x0, y0, cx, y0, cx, y3, x3, y3];
      const mid = cubicMid(x0, y0, cx, y0, cx, y3, x3, y3);
      labelX = mid.x;
      labelY = mid.y;
      const pillHalf = clamp(estimateTextWidth(displayLabel, 11) / 2 + 12, 30, 90);
      maxX = Math.max(maxX, labelX + pillHalf + PAD_X);
    } else if (Math.abs(src.col - tgt.col) === 1) {
      // Adjacent columns: crisp left-to-right (or right-to-left) S-curve.
      const forward = src.col < tgt.col;
      const x0 = forward ? src.x + src.width + startPad : src.x - startPad;
      const y0 = src.y + src.height / 2;
      const x3 = forward ? tgt.x - endPad : tgt.x + tgt.width + endPad;
      const y3 = tgt.y + tgt.height / 2;
      const cx = (x0 + x3) / 2;
      const dyOffset = offsetIndex * 30;
      points = [x0, y0, cx, y0 + dyOffset, cx, y3 + dyOffset, x3, y3];
      const mid = cubicMid(x0, y0, cx, y0 + dyOffset, cx, y3 + dyOffset, x3, y3);
      labelX = mid.x;
      labelY = mid.y;
      minY = Math.min(minY, labelY - 18);
      maxY = Math.max(maxY, labelY + 18);
    } else {
      // Multi-column skip or back-edge: arch above (or below) intermediate columns so it never crosses cards.
      const archAbove = offsetIndex <= 0;
      const clearance = 30 + Math.abs(offsetIndex) * 26;
      const x0 = src.x + src.width / 2;
      const x3 = tgt.x + tgt.width / 2;
      const y0 = archAbove ? src.y - startPad : src.y + src.height + startPad;
      const y3 = archAbove ? tgt.y - endPad : tgt.y + tgt.height + endPad;
      const spanMinY = Math.min(src.y, tgt.y);
      const spanMaxY = Math.max(src.y + src.height, tgt.y + tgt.height);
      const ctrlY = archAbove ? Math.min(PAD_Y, spanMinY) - clearance : Math.max(PAD_Y + totalGridHeight, spanMaxY) + clearance;
      points = [x0, y0, x0, ctrlY, x3, ctrlY, x3, y3];
      const mid = cubicMid(x0, y0, x0, ctrlY, x3, ctrlY, x3, y3);
      labelX = mid.x;
      labelY = mid.y;
      minY = Math.min(minY, labelY - 18);
      maxY = Math.max(maxY, labelY + 18);
    }

    rawEdges.push({ edge, displayLabel, tooltip, startArrow, endArrow, points, labelX, labelY });
  }

  // Shift everything so top/left margins stay clean and non-negative.
  const shiftY = minY < 0 ? Math.ceil(-minY + 4) : 0;
  const shiftX = minX < 0 ? Math.ceil(-minX + 4) : 0;
  if (shiftY || shiftX) {
    for (const node of placedList) {
      node.x += shiftX;
      node.y += shiftY;
    }
  }

  const edges: SubgraphRelationEdge[] = rawEdges.map(({ edge, displayLabel, tooltip, startArrow, endArrow, points, labelX, labelY }) => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = points;
    const path = `M ${x0 + shiftX} ${y0 + shiftY} C ${x1 + shiftX} ${y1 + shiftY}, ${x2 + shiftX} ${y2 + shiftY}, ${x3 + shiftX} ${y3 + shiftY}`;
    return {
      id: edge.id,
      sourceId: edge.source,
      targetId: edge.target,
      label: edge.label,
      displayLabel,
      tooltip,
      direction: edge.direction,
      path,
      labelX: labelX + shiftX,
      labelY: labelY + shiftY,
      startArrow,
      endArrow,
    };
  });

  return {
    queryId,
    queryLabel,
    classes: placedList,
    edges,
    width: Math.ceil(maxX + shiftX),
    height: Math.ceil(maxY + shiftY),
  };
}

/** Builds the complete ABC path + calculation/output lineage view model from a `QuerySubgraph`. */
export function buildSubgraphModel(graph: QuerySubgraph): SubgraphModel {
  const byId = new Map<string, GraphNode>(graph.nodes.map((node) => [node.id, node]));
  const queryLabels = new Map(graph.queries.map((q) => [q.id, q.label]));

  const ownerOfField = new Map<string, string>();
  const fieldsOfClass = new Map<string, FieldNode[]>();
  const dependenciesByTarget = new Map<string, DependencyEdge[]>();

  for (const edge of graph.edges) {
    if (edge.kind === "contains") {
      ownerOfField.set(edge.target, edge.source);
      const field = byId.get(edge.target);
      if (field?.kind === "field") {
        fieldsOfClass.set(edge.source, [...(fieldsOfClass.get(edge.source) ?? []), field]);
      }
    } else if (edge.kind === "dependency") {
      dependenciesByTarget.set(edge.target, [...(dependenciesByTarget.get(edge.target) ?? []), edge]);
    }
  }

  // Record every filter against every target it hits (class, field -> owning class, operation, output).
  const filteredFieldIds = new Set<string>();
  const classFilterMap = new Map<string, Map<string, SubgraphFilterItem>>();
  const nodeFilters = new Map<string, SubgraphFilterItem[]>();
  const unattachedFilters: SubgraphFilterItem[] = [];

  const attachClassFilter = (classId: string, filter: GraphFilter, fieldLabel: string | null) => {
    let perClass = classFilterMap.get(classId);
    if (!perClass) {
      perClass = new Map();
      classFilterMap.set(classId, perClass);
    }
    const existing = perClass.get(filter.id);
    if (existing) {
      if (fieldLabel && !existing.targetFieldLabels.includes(fieldLabel)) existing.targetFieldLabels.push(fieldLabel);
    } else {
      perClass.set(filter.id, {
        id: filter.id,
        label: filter.label,
        expression: filter.expression,
        targetFieldLabels: fieldLabel ? [fieldLabel] : [],
      });
    }
  };

  const attachNodeFilter = (nodeId: string, filter: GraphFilter) => {
    const list = nodeFilters.get(nodeId) ?? [];
    if (!list.some((item) => item.id === filter.id)) {
      list.push({ id: filter.id, label: filter.label, expression: filter.expression, targetFieldLabels: [] });
      nodeFilters.set(nodeId, list);
    }
  };

  for (const filter of graph.filters) {
    let attached = false;
    for (const targetId of filter.targetIds) {
      const target = byId.get(targetId);
      if (!target) continue;
      if (target.kind === "class") {
        attachClassFilter(target.id, filter, null);
        attached = true;
      } else if (target.kind === "field") {
        filteredFieldIds.add(target.id);
        const ownerId = ownerOfField.get(target.id);
        if (ownerId) {
          attachClassFilter(ownerId, filter, target.label);
          attached = true;
        }
      } else if (target.kind === "operation" || target.kind === "output") {
        attachNodeFilter(target.id, filter);
        attached = true;
      }
    }
    if (!attached) {
      unattachedFilters.push({ id: filter.id, label: filter.label, expression: filter.expression, targetFieldLabels: [] });
    }
  }

  // Convert class field lists and filter maps to presentation items.
  const fieldsByClass = new Map<string, SubgraphFieldItem[]>();
  for (const [classId, fields] of fieldsOfClass) {
    fieldsByClass.set(
      classId,
      fields.map((f) => ({
        id: f.id,
        label: f.label,
        attrName: f.attrName,
        filtered: filteredFieldIds.has(f.id),
      })),
    );
  }
  const filtersByClass = new Map<string, SubgraphFilterItem[]>();
  for (const [classId, map] of classFilterMap) filtersByClass.set(classId, [...map.values()]);

  // Build one ABC object-path band per query that declares class nodes.
  const bands: SubgraphQueryBand[] = [];
  for (const query of graph.queries) {
    const classNodes = graph.nodes.filter((n): n is ClassNode => n.kind === "class" && n.queryId === query.id);
    if (!classNodes.length) continue;
    const classIds = new Set(classNodes.map((n) => n.id));
    const relations = graph.edges.filter(
      (e): e is RelationEdge => e.kind === "relation" && classIds.has(e.source) && classIds.has(e.target),
    );
    bands.push(layoutBand(query.id, query.label, classNodes, relations, fieldsByClass, filtersByClass));
  }

  // Detect duplicate field labels across classes so operation/output input references stay unambiguous.
  const placedClassById = new Map(bands.flatMap((band) => band.classes.map((node) => [node.id, node])));
  const fieldLabelCount = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind === "field") fieldLabelCount.set(node.label, (fieldLabelCount.get(node.label) ?? 0) + 1);
  }
  const inputLabelOf = (nodeId: string): string => {
    const node = byId.get(nodeId);
    if (!node) return nodeId;
    if (node.kind === "field" && (fieldLabelCount.get(node.label) ?? 0) > 1) {
      const owner = placedClassById.get(ownerOfField.get(node.id) ?? "");
      if (owner) {
        const prefix = owner.showVariable ? `${owner.label} (${owner.variable})` : owner.label;
        return `${prefix} · ${node.label}`;
      }
    }
    return node.label;
  };

  // Order operations by dependency depth, placing per-query operations before cross-query (`queryId: null`) ones.
  const operationNodes = graph.nodes.filter((n): n is OperationNode => n.kind === "operation");
  const depthMemo = new Map<string, number>();
  const opDepth = (id: string, visiting = new Set<string>()): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = (dependenciesByTarget.get(id) ?? [])
      .map((edge) => byId.get(edge.source))
      .filter((node): node is OperationNode => node?.kind === "operation");
    const depth = parents.length ? 1 + Math.max(...parents.map((p) => opDepth(p.id, visiting))) : 0;
    visiting.delete(id);
    depthMemo.set(id, depth);
    return depth;
  };
  const queryOrder = new Map(graph.queries.map((q, index) => [q.id, index]));
  const orderedOps = [...operationNodes].sort((a, b) => {
    const aCross = a.queryId === null ? 1 : 0;
    const bCross = b.queryId === null ? 1 : 0;
    if (aCross !== bCross) return aCross - bCross;
    const da = opDepth(a.id);
    const db = opDepth(b.id);
    if (da !== db) return da - db;
    const qa = a.queryId !== null ? (queryOrder.get(a.queryId) ?? 0) : Number.MAX_SAFE_INTEGER;
    const qb = b.queryId !== null ? (queryOrder.get(b.queryId) ?? 0) : Number.MAX_SAFE_INTEGER;
    return qa - qb;
  });

  const operations: SubgraphOperationItem[] = orderedOps.map((op) => ({
    id: op.id,
    label: op.label,
    operation: op.operation,
    queryId: op.queryId,
    queryLabel: op.queryId !== null ? (queryLabels.get(op.queryId) ?? null) : null,
    expression: op.expression,
    inputs: (dependenciesByTarget.get(op.id) ?? []).map((edge) => ({
      id: edge.source,
      label: inputLabelOf(edge.source),
      role: edge.role,
    })),
    filters: nodeFilters.get(op.id) ?? [],
  }));

  const outputs: SubgraphOutputItem[] = graph.nodes
    .filter((n): n is OutputNode => n.kind === "output")
    .map((out) => {
      const valueEdge = (dependenciesByTarget.get(out.id) ?? []).find((edge) => edge.role === "value");
      return {
        id: out.id,
        label: out.label,
        key: out.key,
        sourceId: valueEdge?.source ?? null,
        sourceLabel: valueEdge ? inputLabelOf(valueEdge.source) : null,
        filters: nodeFilters.get(out.id) ?? [],
      };
    });

  return {
    bands,
    operations,
    outputs,
    unattachedFilters,
    hasClasses: bands.length > 0,
    hasDetails: operations.length > 0 || outputs.length > 0 || unattachedFilters.length > 0,
  };
}
