import type { ListNode, ParsedNode, TableNode, TableRowNode } from "@ontomato/markdown";

/** The nodes directly inside a node of the product Markdown's tree, in reading order. */
export function childrenOf(node: ParsedNode): readonly ParsedNode[] {
  switch (node.type) {
    case "list":
      return (node as ListNode).items;
    case "table":
      return [(node as TableNode).header, ...(node as TableNode).rows];
    case "table_row":
      return (node as TableRowNode).cells;
    default:
      return (node as { children?: ParsedNode[] | null }).children ?? [];
  }
}

/** Every node of one type in a parsed text, nested ones included, in reading order. */
export function nodesOfType<T extends ParsedNode>(nodes: readonly ParsedNode[], type: T["type"]): T[] {
  return nodes.flatMap((node) => [...(node.type === type ? [node as T] : []), ...nodesOfType<T>(childrenOf(node), type)]);
}
