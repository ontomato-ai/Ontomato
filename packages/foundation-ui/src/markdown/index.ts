import { parseProductMarkdown } from "@ontomato/markdown";

export { default as MarkdownView } from "./MarkdownView.vue";
/** markstream's own paragraph drawing, for a caller that draws a paragraph's children under a rule of its own. */
export { ParagraphNode } from "markstream-vue";

export interface MarkdownLink {
  href: string;
  text: string;
}

/** Links parsed from a text in the product Markdown, in document order. */
export function markdownLinks(source: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object" || !("type" in value)) return;
    if (value.type === "link" && "href" in value && typeof value.href === "string") {
      const text = "text" in value && typeof value.text === "string" ? value.text.trim() : "";
      links.push({ href: value.href, text });
    }
    Object.values(value).forEach(visit);
  }
  visit(parseProductMarkdown(source));
  return links;
}
