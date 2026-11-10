import {
  getMarkdown,
  parseMarkdownToStructure,
  type MarkdownIt,
  type MarkdownToken,
  type ParsedNode,
} from "stream-markdown-parser";

export type {
  BlockquoteNode,
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
} from "stream-markdown-parser";

/*
 * The product Markdown: the one definition every page and every export reads a text with (content rendering spec).
 * It is GFM plus two rules, a single newline is a line break and a single tilde is plain text; raw HTML is text, and
 * whatever the parser reads beyond GFM shows as written. The parser is markstream's, and so is the tree it reads a
 * text into: pages draw that tree with markstream-vue, which applies productMarkdown to its own parser, and exports
 * draw the same tree from parseProductMarkdown.
 */

/** The parser rules switched off, each a syntax markstream adds to GFM. */
const beyondGfm = [
  // ~subscript~: a single tilde is plain text, so ranges such as 1~2 stay as written.
  "sub",
  // ^superscript^, ==highlight== and ++insertion++.
  "sup",
  "mark",
  "ins",
  // Math: $inline$ and \(inline\), $$block$$ and \[block\]; amounts such as $100 stay text.
  "math",
  "math_block",
  "explicit_math_block",
  // Footnotes: [^1], ^[inline] and the [^1]: definitions, which read as link definitions again.
  "footnote_ref",
  "footnote_inline",
  "footnote_def",
  "footnote_tail",
  // ::: containers, named (tip, warning, ...) or not.
  "container_admonition",
  "container_info",
  "container_warning",
  "container_error",
  "container_tip",
  "container_danger",
  "container_note",
  "container_caution",
  "vmr_container_fallback",
  // Typographic replacements: "quotes" and 'quotes' stay straight, --, (c), ... and +- stay as typed.
  "replacements",
  "smartquotes",
];

/**
 * The rules that work on the parsed text: a single newline breaks the line; raw HTML, which markstream still cuts out
 * of the text as tags, is text again; and a bare address stays a link only with a scheme, after www. or as an email
 * address, as in GFM, so bare domain names such as example.com, main.py or deploy.sh are plain text.
 */
function readAsProduct(children: MarkdownToken[]) {
  for (let i = children.length - 1; i >= 0; i--) {
    const token = children[i];
    if (token.type === "softbreak") token.type = "hardbreak";
    else if (token.type === "html_inline" || token.type === "html_block") token.type = "text";
    else if (token.type === "link_open" && token.markup === "linkify") {
      const text = children[i + 1];
      const address = text.content!;
      const href = token.attrs!.find(([name]) => name === "href")![1];
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(address) && !address.startsWith("www.") && !href.startsWith("mailto:"))
        children.splice(i, 3, text);
    }
  }
}

/** Makes one of markstream's parsers read the product Markdown; pages pass it to markstream-vue as customMarkdownIt. */
export function productMarkdown(md: MarkdownIt): MarkdownIt {
  md.set({ html: false });
  // [1] badges: markstream's citation rule shares its name with the block rule that reads standard [label]: url link
  // definitions, which GFM has, so only the inline one is switched off.
  md.inline.ruler.disable("reference");
  md.disable(beyondGfm);
  md.core.ruler.push("product_markdown", (state: { tokens: MarkdownToken[] }) => {
    for (const { children } of state.tokens) if (children) readAsProduct(children);
  });
  return md;
}

const parser = productMarkdown(getMarkdown("product-markdown"));

/** A finished text in the product Markdown as markstream's node tree, the tree pages draw, for exports to draw it too. */
export function parseProductMarkdown(source: string): ParsedNode[] {
  return parseMarkdownToStructure(source, parser, { final: true });
}
