import type { MarkdownIt, MarkdownToken, ParseOptions } from "markstream-vue";

// The product Markdown dialect: what a text means in every page, as in the server's PDF and PPT exports (content
// rendering spec). These two rules are its only departures from markstream's defaults.

/** A single newline is a line break, not a space: soft breaks become hard ones before the parser builds nodes. */
function promoteSoftBreaks(tokens: MarkdownToken[]): MarkdownToken[] {
  for (const token of tokens) {
    if (token.type === "softbreak") token.type = "hardbreak";
    if (token.children) promoteSoftBreaks(token.children);
  }
  return tokens;
}

export const parseOptions: ParseOptions = { preTransformTokens: promoteSoftBreaks };

/**
 * Only paired double tildes strike through; a single tilde is ordinary text, so ranges such as 1~2 stay as written.
 * markstream reads a pair of single tildes as subscript, so that rule is off.
 */
export function productMarkdownIt(md: MarkdownIt): MarkdownIt {
  return md.disable("sub");
}
