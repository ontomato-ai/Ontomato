import type { ParseOptions } from "markstream-vue";

export const SHELL_MARKDOWN_ID = "agent-shell";

interface TokenLike {
  type: string;
  children?: TokenLike[] | null;
}

/**
 * Single newlines are line breaks in every product delivery channel (content rendering spec),
 * so soft breaks are promoted before the parser builds nodes.
 */
function promoteSoftBreaks<T extends TokenLike>(tokens: T[]): T[] {
  for (const token of tokens) {
    if (token.type === "softbreak") token.type = "hardbreak";
    if (token.children) promoteSoftBreaks(token.children);
  }
  return tokens;
}

export const shellParseOptions: ParseOptions = {
  preTransformTokens: promoteSoftBreaks as NonNullable<ParseOptions["preTransformTokens"]>,
};
