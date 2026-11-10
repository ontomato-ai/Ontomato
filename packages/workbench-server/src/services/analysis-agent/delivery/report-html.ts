import type {
  CheckboxInputNode,
  CodeBlockNode,
  HeadingNode,
  ImageNode,
  InlineCodeNode,
  LinkNode,
  ListNode,
  ParsedNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextNode,
} from "@ontomato/markdown";
import { childrenOf } from "./markdown-nodes";

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * A report's text drawn as HTML for print, from the tree pages draw (@ontomato/markdown), so it reads the same: code
 * stays preformatted text, except a block that `charts` maps to the HTML of its chart.
 */
export function reportHtml(nodes: readonly ParsedNode[], charts: ReadonlyMap<ParsedNode, string>): string {
  const draw = (list: readonly ParsedNode[]): string => list.map(drawNode).join("");
  const cell = (node: TableCellNode) => {
    const tag = node.header ? "th" : "td";
    return `<${tag}${node.align ? ` style="text-align:${node.align}"` : ""}>${draw(node.children)}</${tag}>\n`;
  };
  const row = (node: TableRowNode) => `<tr>\n${node.cells.map(cell).join("")}</tr>\n`;

  function drawNode(node: ParsedNode): string {
    switch (node.type) {
      case "text":
        return escapeHtml((node as TextNode).content);
      case "hardbreak":
        return "<br>\n";
      case "strong":
        return `<strong>${draw(childrenOf(node))}</strong>`;
      case "emphasis":
        return `<em>${draw(childrenOf(node))}</em>`;
      case "strikethrough":
        return `<del>${draw(childrenOf(node))}</del>`;
      case "inline_code":
        return `<code>${escapeHtml((node as InlineCodeNode).code)}</code>`;
      case "link": {
        const { href, title } = node as LinkNode;
        return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${draw(childrenOf(node))}</a>`;
      }
      case "image": {
        const { src, alt, title } = node as ImageNode;
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
      }
      case "checkbox_input":
        return `<input type="checkbox" disabled${(node as CheckboxInputNode).checked ? " checked" : ""}>`;
      case "paragraph":
        return `<p>${draw(childrenOf(node))}</p>\n`;
      case "heading": {
        const { level } = node as HeadingNode;
        return `<h${level}>${draw(childrenOf(node))}</h${level}>\n`;
      }
      case "list": {
        const { ordered, start } = node as ListNode;
        const tag = ordered ? "ol" : "ul";
        return `<${tag}${ordered && start !== undefined && start !== 1 ? ` start="${start}"` : ""}>\n${draw(childrenOf(node))}</${tag}>\n`;
      }
      case "list_item":
        return `<li>${draw(childrenOf(node))}</li>\n`;
      case "blockquote":
        return `<blockquote>\n${draw(childrenOf(node))}</blockquote>\n`;
      case "code_block": {
        const { language, code } = node as CodeBlockNode;
        return (
          charts.get(node) ??
          `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code)}</code></pre>\n`
        );
      }
      case "table": {
        const { header, rows } = node as TableNode;
        return `<table>\n<thead>\n${row(header)}</thead>\n<tbody>\n${rows.map(row).join("")}</tbody>\n</table>\n`;
      }
      case "thematic_break":
        return "<hr>\n";
      default:
        return draw(childrenOf(node));
    }
  }

  return draw(nodes);
}
