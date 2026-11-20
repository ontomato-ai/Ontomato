import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";
import { parseProductMarkdown, type ImageNode, type LinkNode, type ParsedNode } from "@ontomato/markdown";

/**
 * The `.dataset.json` files an answer cites: every link and image of its own text, wherever the Markdown nests them
 * (paragraphs, list items, table cells, quotes). Code is text, not a citation; it has no link nodes.
 */
export function citedDatasetPaths(answer: string): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (value === null || typeof value !== "object" || !("type" in value)) return;
    const node = value as ParsedNode;
    const target = node.type === "link" ? (node as LinkNode).href : node.type === "image" ? (node as ImageNode).src : undefined;
    const path = target === undefined ? null : artifactPath(target);
    if (path?.endsWith(".dataset.json")) paths.add(path);
    for (const child of Object.values(node)) if (typeof child === "object") visit(child);
  };
  visit(parseProductMarkdown(answer));
  return [...paths];
}
