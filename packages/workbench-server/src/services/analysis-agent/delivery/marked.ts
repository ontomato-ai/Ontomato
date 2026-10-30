import { Marked, type MarkedExtension } from "marked";

/** The product Markdown dialect shared by every server-side renderer. */
export const productMarkdownOptions: MarkedExtension = {
  gfm: true,
  breaks: true,
  tokenizer: {
    del(source) {
      // Returning false delegates double-tilde syntax to Marked's built-in tokenizer.
      if (source.startsWith("~~")) return false;

      // A single tilde is ordinary text in the product Markdown dialect.
      return undefined;
    },
  },
};

export const marked = new Marked(productMarkdownOptions);
