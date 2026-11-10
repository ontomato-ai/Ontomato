import type {
  CheckboxInputNode,
  CodeBlockNode,
  HeadingNode,
  ImageNode,
  InlineCodeNode,
  LinkNode,
  ParsedNode,
  TableCellNode,
  TableNode,
  TextNode,
} from "@ontomato/markdown";
import { childrenOf, nodesOfType } from "./markdown-nodes";

/** A run of slide text with the inline formatting a page shows for it, as PowerPoint text properties. */
export interface PptRun {
  text: string;
  options: { bold?: boolean; italic?: boolean; strike?: "sngStrike"; fontFace?: string; hyperlink?: { url: string } };
}

/** The inline nodes of a text in the product Markdown as runs: bold, italic, struck through, code and links as on a page. */
export function pptRuns(nodes: readonly ParsedNode[], options: PptRun["options"] = {}): PptRun[] {
  return nodes.flatMap((node): PptRun[] => {
    switch (node.type) {
      case "text":
        return [{ text: (node as TextNode).content, options }];
      case "hardbreak":
        return [{ text: "\n", options }];
      case "strong":
        return pptRuns(childrenOf(node), { ...options, bold: true });
      case "emphasis":
        return pptRuns(childrenOf(node), { ...options, italic: true });
      case "strikethrough":
        return pptRuns(childrenOf(node), { ...options, strike: "sngStrike" });
      case "inline_code":
        return [{ text: (node as InlineCodeNode).code, options: { ...options, fontFace: "Consolas" } }];
      case "link":
        return pptRuns(childrenOf(node), { ...options, hyperlink: { url: (node as LinkNode).href } });
      case "image":
        return [{ text: (node as ImageNode).alt, options }];
      case "checkbox_input":
        return [{ text: (node as CheckboxInputNode).checked ? "☑" : "☐", options }];
      default:
        return pptRuns(childrenOf(node), options);
    }
  });
}

export function runsText(runs: readonly PptRun[]): string {
  return runs.map((run) => run.text).join("");
}

/** The runs cut after `maxLength` characters, `ending` marking the cut. */
export function cutRuns(runs: readonly PptRun[], maxLength: number, ending: string): PptRun[] {
  if (runsText(runs).length <= maxLength) return [...runs];
  const cut: PptRun[] = [];
  let left = maxLength;
  for (const run of runs) {
    if (run.text.length >= left) {
      cut.push({ text: `${run.text.slice(0, left)}${ending}`, options: run.options });
      break;
    }
    cut.push(run);
    left -= run.text.length;
  }
  return cut;
}

/** A table cell on a slide: its runs, and the alignment its column has on the page. */
export interface PptCell {
  runs: PptRun[];
  align?: TableCellNode["align"];
}

function pptCell(cell: TableCellNode): PptCell {
  return { runs: pptRuns(cell.children), align: cell.align };
}

/** The text's tables, every cell with its runs and its column's alignment. */
export function pptTables(nodes: readonly ParsedNode[]): { columns: PptCell[]; rows: PptCell[][] }[] {
  return nodesOfType<TableNode>(nodes, "table").map(({ header, rows }) => ({
    columns: header.cells.map(pptCell),
    rows: rows.map((row) => row.cells.map(pptCell)),
  }));
}

/** The text of the first heading of level 1 to 3. */
export function firstHeading(nodes: readonly ParsedNode[]): string | undefined {
  const heading = nodesOfType<HeadingNode>(nodes, "heading").find((node) => node.level <= 3);
  return heading && runsText(pptRuns(heading.children)).trim();
}

/** The code of the text's ```html blocks, the charts an answer carries. */
export function htmlBlocks(nodes: readonly ParsedNode[]): string[] {
  return nodesOfType<CodeBlockNode>(nodes, "code_block")
    .filter((block) => block.language === "html")
    .map((block) => block.code.trim());
}

/** A line of runs without the white space at its two ends. */
function trimRuns(line: readonly PptRun[]): PptRun[] {
  return line.map((run, index) => {
    let text = run.text;
    if (index === 0) text = text.trimStart();
    if (index === line.length - 1) text = text.trimEnd();
    return { text, options: run.options };
  });
}

/**
 * A section's prose as one caption: each line of its paragraphs, list items and headings, except lines that only
 * repeat one of `titles`, joined by "；" and cut after `maxLength` characters. Tables and code are left out.
 */
export function captionRuns(nodes: readonly ParsedNode[], titles: readonly string[], maxLength = 160): PptRun[] {
  const lines: PptRun[][] = [];
  const visit = (node: ParsedNode) => {
    switch (node.type) {
      case "paragraph":
      case "heading": {
        let line: PptRun[] = [];
        for (const run of pptRuns(childrenOf(node))) {
          if (run.text === "\n") {
            lines.push(trimRuns(line));
            line = [];
          } else line.push({ text: run.text.replace(/\s{2,}/g, " "), options: run.options });
        }
        lines.push(trimRuns(line));
        return;
      }
      case "table":
      case "code_block":
      case "thematic_break":
        return;
      default:
        childrenOf(node).forEach(visit);
    }
  };
  nodes.forEach(visit);
  const caption = lines
    .filter((line) => runsText(line) && !titles.includes(runsText(line)))
    .flatMap((line, index) => (index ? [{ text: "；", options: {} }, ...line] : line));
  return cutRuns(caption, maxLength, "");
}
