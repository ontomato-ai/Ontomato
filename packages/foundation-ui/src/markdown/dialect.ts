import type { MarkdownIt, MarkdownToken, ParseOptions } from "markstream-vue";

// The product Markdown dialect is GFM, plus two rules: a single newline is a line break, and a single tilde is plain
// text (content rendering spec). Whatever markstream reads beyond GFM is switched off here, so it shows as written,
// as in the server's PDF and PPT exports.

/** A single newline is a line break, not a space: soft breaks become hard ones before the parser builds nodes. */
function promoteSoftBreaks(tokens: MarkdownToken[]): MarkdownToken[] {
  for (const token of tokens) {
    if (token.type === "softbreak") token.type = "hardbreak";
    if (token.children) promoteSoftBreaks(token.children);
  }
  return tokens;
}

/**
 * GFM links a bare address only when it has a scheme, starts with www. or is an email address. markstream also links
 * bare domain names, such as example.com, main.py or deploy.sh: those links go back to their plain text.
 */
function unlinkBareDomains(tokens: MarkdownToken[]): MarkdownToken[] {
  for (const { children } of tokens) {
    if (!children) continue;
    for (let i = children.length - 1; i >= 0; i--) {
      const open = children[i];
      if (open.type !== "link_open" || open.markup !== "linkify") continue;
      const text = children[i + 1];
      const address = text.content!;
      const href = open.attrs!.find(([name]) => name === "href")![1];
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(address) || address.startsWith("www.") || href.startsWith("mailto:")) continue;
      children.splice(i, 3, text);
    }
  }
  return tokens;
}

export const parseOptions: ParseOptions = {
  preTransformTokens: (tokens) => unlinkBareDomains(promoteSoftBreaks(tokens)),
};

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
  // Footnotes: [^1], ^[inline] and the [^1]: definitions, which read as link definitions again, as in the exports.
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

export function productMarkdownIt(md: MarkdownIt): MarkdownIt {
  // [1] badges: markstream's citation rule shares its name with the block rule that reads standard [label]: url link
  // definitions, which GFM has, so only the inline one is switched off.
  md.inline.ruler.disable("reference");
  return md.disable(beyondGfm);
}
