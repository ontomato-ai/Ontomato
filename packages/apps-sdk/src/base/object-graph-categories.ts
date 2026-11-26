import type { GraphCanvasEdge, GraphCanvasNode } from "@ontomato/foundation-ui/graph";

/*
 * A graph's categories, as the reader works with them: the legend that names them in the projection's order, and the
 * graph as it is left once the reader switches some off. What a category is, how many there are and what each is called
 * is the projection's (`categories`, `categoryLabels`, and the pointer `nodeCategory` reads it at); these are the same
 * whatever the categories stand for, a business ontology's classes or a layered ontology's layers.
 */

/** One category the legend offers: the value a node's category field holds, and the name the reader reads. */
export interface CategoryLegendEntry {
  readonly category: string;
  readonly label: string;
}

/**
 * The categories the legend offers, in the order the projection gives them — the `categories` it lists, or the ones its
 * `categoryLabels` names when it lists no order — each read as the name configured for it (`translate` resolves a
 * message key to the reader's language, any other text staying itself) or as its own value.
 */
export function categoryLegendEntries(
  categories: readonly string[],
  categoryLabels: Readonly<Record<string, string>>,
  translate: (text: string) => string,
): readonly CategoryLegendEntry[] {
  const listed = categories.length ? categories : Object.keys(categoryLabels);
  return listed.map((category) => ({ category, label: translate(categoryLabels[category] ?? category) }));
}

/** The category switched off, or back on: one click hides it, the next shows it again. */
export function toggledCategory(hidden: ReadonlySet<string>, category: string): ReadonlySet<string> {
  const next = new Set(hidden);
  if (!next.delete(category)) next.add(category);
  return next;
}

/**
 * The graph as the reader sees it with those categories switched off: one category's nodes go, and with them every edge
 * that ends at one of them, while the other categories stay as they are. A node the projection gives no category is
 * never one the reader switched off.
 */
export function categorizedGraphView<TNode extends GraphCanvasNode, TEdge extends GraphCanvasEdge>(
  nodes: readonly TNode[],
  links: readonly TEdge[],
  hidden: ReadonlySet<string>,
): { readonly nodes: readonly TNode[]; readonly links: readonly TEdge[] } {
  if (!hidden.size) return { nodes, links };
  const shown = nodes.filter((node) => node.category === undefined || !hidden.has(node.category));
  const shownIds = new Set(shown.map((node) => node.id));
  return { nodes: shown, links: links.filter((link) => shownIds.has(link.source) && shownIds.has(link.target)) };
}
