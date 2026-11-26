import {
  APPLICATION,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
} from "@ontomato/contracts/platform-object-types";
import { productTypes } from "@ontomato/contracts/product-assets";
import type { ProductGraph } from "@ontomato/contracts/product-graph";
import { unwrapJsonField } from "./display-value";
import type { ObjectListRef } from "./object-list-types";

/** Column categories in a layered product asset reference graph. */
export type ProductAssetGraphCategory = ProductGraph["nodes"][number]["category"];

/** Relationship types connecting nodes in a product asset reference graph. */
export type ProductAssetGraphRelation = ProductGraph["edges"][number]["relation"];

/** One node in a product asset reference graph. */
export type ProductAssetGraphNode = ProductGraph["nodes"][number];

/** One directed relationship edge in a product asset reference graph. */
export type ProductAssetGraphEdge = Omit<ProductGraph["edges"][number], "storage"> & {
  readonly storage?: ProductGraph["edges"][number]["storage"];
};

/** Product asset reference graph payload accepted by `ProductAssetGraph`. */
export interface ProductAssetGraphData {
  readonly nodes: readonly ProductAssetGraphNode[];
  readonly edges: readonly ProductAssetGraphEdge[];
}

/** Real asset identity emitted when the reader opens an asset node in `ProductAssetGraph`. */
export interface ProductAssetGraphTarget {
  /** Product asset primary key (`node.assetId`). */
  readonly assetId: string;
  /** Platform object type ID resolved from the asset's kind. */
  readonly className: string;
  /** Primary key matching `assetId` for `ObjectListRef` compatibility. */
  readonly primaryKey: string;
  /** Graph node identifier (`node.id`). */
  readonly id: string;
  /** Display name of the asset. */
  readonly name: string;
  /** Asset document kind (`page`, `application`, `object-projection`, etc.). */
  readonly kind: string;
  /** Asset column category. */
  readonly category: ProductAssetGraphCategory;
  /** Platform object reference (`{ className, primaryKey }`). */
  readonly ref: ObjectListRef;
}

/** Left-to-right column order matching the product asset architecture layers. */
export const PRODUCT_ASSET_COLUMN_ORDER: readonly ProductAssetGraphCategory[] = [
  "principal",
  "bundle",
  "composition",
  "element",
  "ontology",
  "legacy",
];

export const PRODUCT_ASSET_CARD_WIDTH = 220;
export const PRODUCT_ASSET_CARD_HEIGHT = 54;
export const PRODUCT_ASSET_COLUMN_PITCH = 300;
export const PRODUCT_ASSET_COLUMN_OFFSET_X = 10;
export const PRODUCT_ASSET_ROW_PITCH = 94;
export const PRODUCT_ASSET_ROW_OFFSET_Y = 44;

export interface ProductAssetGraphColumn {
  readonly id: ProductAssetGraphCategory;
  readonly nodes: readonly ProductAssetGraphNode[];
}

export interface ProductAssetGraphLayout {
  readonly visibleColumns: readonly ProductAssetGraphColumn[];
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly validEdges: readonly ProductAssetGraphEdge[];
  readonly width: number;
  readonly height: number;
}

function isGraphObject(value: unknown): value is ProductAssetGraphData {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Array.isArray((value as { nodes?: unknown }).nodes)
    && Array.isArray((value as { edges?: unknown }).edges)
  );
}

/**
 * Extracts a `ProductAssetGraphData` payload from a direct graph object, `{ graph }`, or a `PanelRecord` whose
 * `fields.graph` (or `fields`) holds `{ nodes, edges }`.
 */
export function extractProductAssetGraph(raw: unknown): ProductAssetGraphData | null {
  const candidate = unwrapJsonField(raw);
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  if (isGraphObject(candidate)) return candidate;
  const record = candidate as Record<string, unknown>;
  if ("graph" in record) {
    const nested = unwrapJsonField(record.graph);
    if (isGraphObject(nested)) return nested;
  }
  if ("fields" in record && record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)) {
    const fields = record.fields as Record<string, unknown>;
    if ("graph" in fields) {
      const fromField = unwrapJsonField(fields.graph);
      if (isGraphObject(fromField)) return fromField;
    }
    if (isGraphObject(fields)) return fields;
  }
  return null;
}

function kindRank(kind: string): number {
  const index = productTypes.findIndex((type) => type.kind === kind);
  return index < 0 ? productTypes.length : index;
}

/** Computes column card coordinates, SVG dimensions, and drawable edges for a product asset graph. */
export function computeProductAssetGraphLayout(graph: ProductAssetGraphData): ProductAssetGraphLayout {
  const visibleColumns: ProductAssetGraphColumn[] = [];
  const positions = new Map<string, { readonly x: number; readonly y: number }>();

  for (const category of PRODUCT_ASSET_COLUMN_ORDER) {
    const nodes = graph.nodes
      .filter((node) => node.category === category)
      .slice()
      .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    if (!nodes.length) continue;
    const columnIndex = visibleColumns.length;
    visibleColumns.push({ id: category, nodes });
    nodes.forEach((node, rowIndex) => {
      positions.set(node.id, {
        x: columnIndex * PRODUCT_ASSET_COLUMN_PITCH + PRODUCT_ASSET_COLUMN_OFFSET_X,
        y: rowIndex * PRODUCT_ASSET_ROW_PITCH + PRODUCT_ASSET_ROW_OFFSET_Y,
      });
    });
  }

  const validEdges = graph.edges.filter((edge) => positions.has(edge.source) && positions.has(edge.target));
  const width = Math.max(PRODUCT_ASSET_COLUMN_PITCH, visibleColumns.length * PRODUCT_ASSET_COLUMN_PITCH);
  const height = Math.max(
    160,
    ...visibleColumns.map((column) => column.nodes.length * PRODUCT_ASSET_ROW_PITCH + 50),
  );

  return { visibleColumns, positions, validEdges, width, height };
}

/** Computes the SVG cubic Bezier curve path between two laid-out product asset cards. */
export function productAssetEdgePath(
  edge: ProductAssetGraphEdge,
  positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): string {
  const from = positions.get(edge.source);
  const to = positions.get(edge.target);
  if (!from || !to) return "";
  const midYOffset = PRODUCT_ASSET_CARD_HEIGHT / 2;
  if (from.x === to.x) {
    const side = from.x + PRODUCT_ASSET_CARD_WIDTH;
    return `M ${side} ${from.y + midYOffset} C ${side + 64} ${from.y + midYOffset}, ${side + 64} ${to.y + midYOffset}, ${side} ${to.y + midYOffset}`;
  }
  const forward = to.x > from.x;
  const direction = forward ? 1 : -1;
  const startX = from.x + (forward ? PRODUCT_ASSET_CARD_WIDTH : 0);
  const startY = from.y + midYOffset;
  const endX = to.x + (forward ? 0 : PRODUCT_ASSET_CARD_WIDTH);
  const endY = to.y + midYOffset;
  const offset = edge.relation === "edit" ? 18 : 0;
  return `M ${startX} ${startY} C ${startX + 60 * direction} ${startY + offset}, ${endX - 60 * direction} ${endY + offset}, ${endX} ${endY}`;
}

/** Resolves the real platform object identity for a clickable product asset node (`null` for non-asset nodes). */
export function resolveProductAssetTarget(
  node: ProductAssetGraphNode,
  fallbackClassName?: string,
): ProductAssetGraphTarget | null {
  if (!node.assetId) return null;
  let className: string;
  if (
    node.kind === "object-projection"
    || node.kind === "collection-view"
    || node.kind === "metric-widget"
    || node.kind === "action-view"
  ) {
    className = PRODUCT_PROJECTION;
  } else if (node.kind === "page" || node.kind === "navigation") {
    className = PRODUCT_PANEL;
  } else if (node.kind === "application") {
    className = APPLICATION;
  } else if (fallbackClassName) {
    className = fallbackClassName;
  } else if (node.category === "element") {
    className = PRODUCT_PROJECTION;
  } else if (node.category === "bundle") {
    className = APPLICATION;
  } else {
    className = PRODUCT_PANEL;
  }
  const ref: ObjectListRef = { className, primaryKey: node.assetId };
  return {
    assetId: node.assetId,
    className,
    primaryKey: node.assetId,
    id: node.id,
    name: node.name,
    kind: node.kind,
    category: node.category,
    ref,
  };
}
