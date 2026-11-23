import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

/*
 * What the platform does with a panel's `panel.html` as it runs the panel in its own document: it takes the template its
 * `#app` holds, and scopes its CSS to the panel's instance.
 */

/** The panel's CSS tried to reach past its own panel: it applies nowhere. */
export class PanelStyleOutsideError extends Error {}

/**
 * The panel's CSS as a stylesheet that reaches only this instance's own element and stops at any nested panel boundary
 * (`[data-panel-instance]`), never leaking into sibling or nested panels. The browser parses the CSS; a stylesheet whose
 * outermost level is anything but that one scope wrote its way out of it, and none of it applies.
 */
export function scopedPanelStyle(css: string, instance: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`@scope ([data-panel-instance="${instance}"]) to ([data-panel-instance]) {\n${css}\n}`);
  if (sheet.cssRules.length !== 1 || !(sheet.cssRules[0] instanceof CSSScopeRule))
    throw new PanelStyleOutsideError("The panel's CSS reaches outside its panel");
  return sheet;
}

/** Applies a panel's stylesheet to the document, and returns what takes it away again. */
export function adoptPanelStyle(sheet: CSSStyleSheet): () => void {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  return () => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(adopted => adopted !== sheet);
  };
}

/** A panel's `panel.html`, split into what the platform does with each part. */
export interface CodedPanelHtml {
  /** The component's template: what the panel's `#app` element holds. */
  template: string;
  /** The `#app` element's own attributes, which the element the instance mounts into carries. */
  rootAttributes: Record<string, string>;
  /** The panel's CSS, scoped to the instance by its host. */
  css: string;
}

/**
 * Splits a panel's HTML as written. When an `#app` element is present, the template is the source text between `#app`'s
 * tags (never HTML-reserialized, so Vue syntax like `#slot` and camelCase attributes is preserved). When `#app` is
 * omitted, the non-`<style>` HTML itself is the template.
 */
export function splitCodedPanelHtml(html: string): CodedPanelHtml {
  let root: DefaultTreeAdapterTypes.Element | undefined;
  const styles: string[] = [];
  const styleRanges: { start: number; end: number }[] = [];
  const visit = (node: DefaultTreeAdapterTypes.ChildNode) => {
    if (!("tagName" in node)) return;
    if (node.tagName === "style") {
      styles.push(node.childNodes.map(child => "value" in child ? child.value : "").join(""));
      if (node.sourceCodeLocation) {
        styleRanges.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset });
      }
    }
    if (!root && node.attrs.some(({ name, value }) => name === "id" && value === "app")) root = node;
    for (const child of node.tagName === "template" ? (node as DefaultTreeAdapterTypes.Template).content.childNodes : node.childNodes) visit(child);
  };
  parseFragment(html, { sourceCodeLocationInfo: true }).childNodes.forEach(visit);
  if (root) {
    const { startTag, endTag } = root.sourceCodeLocation!;
    return {
      template: html.slice(startTag!.endOffset, endTag!.startOffset),
      rootAttributes: Object.fromEntries(root.attrs.filter(({ name }) => name !== "id").map(({ name, value }) => [name, value])),
      css: styles.join("\n"),
    };
  }
  const sorted = styleRanges.sort((a, b) => a.start - b.start);
  let template = "";
  let cursor = 0;
  for (const { start, end } of sorted) {
    if (start > cursor) template += html.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  template += html.slice(cursor);
  return {
    template: template.trim(),
    rootAttributes: {},
    css: styles.join("\n"),
  };
}
