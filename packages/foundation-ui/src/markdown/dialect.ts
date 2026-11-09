import type { MarkdownIt, MarkdownToken, ParseOptions } from "markstream-vue";

// The product Markdown dialect is GFM, plus two rules: a single newline is a line break, and a single tilde is plain
// text. A text then means the same in every page as in the server's PDF and PPT exports (content rendering spec).
// markstream's syntax beyond GFM is switched off below, so its markers show as written. Still differing from the
// exports: markstream's [1] citation badges, its typographic replacements ("quotes", --, (c), ...) and links on bare
// domain names such as example.com.

/** A single newline is a line break, not a space: soft breaks become hard ones before the parser builds nodes. */
function promoteSoftBreaks(tokens: MarkdownToken[]): MarkdownToken[] {
  for (const token of tokens) {
    if (token.type === "softbreak") token.type = "hardbreak";
    if (token.children) promoteSoftBreaks(token.children);
  }
  return tokens;
}

export const parseOptions: ParseOptions = { preTransformTokens: promoteSoftBreaks };

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
];

export function productMarkdownIt(md: MarkdownIt): MarkdownIt {
  return md.disable(beyondGfm);
}
