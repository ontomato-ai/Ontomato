import DOMPurify, { type RemovedAttribute, type RemovedElement } from "dompurify";

/*
 * What the platform guarantees about a panel drawn in its own document (standard part two, layout): its HTML carries no
 * script, and its CSS reaches only this panel. Both are done here, once, as the panel is drawn; the parser's check at
 * registration only tells the author early.
 */

/** The panel's HTML with anything that could run removed, and whether anything was. */
export interface CleanedPanelHtml {
  html: string;
  removed: boolean;
}

/**
 * Cleans a panel's HTML with DOMPurify. Besides ordinary HTML and its one `<style>` block, it keeps only the platform's
 * own writing: the member element and the attributes that show a part on a condition or repeat it over a list.
 */
export function cleanPanelHtml(html: string): CleanedPanelHtml {
  // Nothing to clean: DOMPurify would report the empty body it makes for it as removed.
  if (!html) return { html, removed: false };
  const cleaned = DOMPurify.sanitize(html, {
    // A layout may start with its `<style>` block; without this the parser's head would take it away.
    FORCE_BODY: true,
    ADD_TAGS: ["panel-member", "style"],
    // A link may open in a new tab; browsers open those without a handle back to this page.
    ADD_ATTR: ["ref", "when", "eq", "ne", "each", "target"],
  });
  return { html: cleaned, removed: DOMPurify.removed.some(entry => !isBodyMarker(entry)) };
}

/** The empty element `FORCE_BODY` puts first and takes out again: DOMPurify lists it as removed, though it was its own. */
function isBodyMarker(entry: RemovedElement | RemovedAttribute) {
  return "element" in entry && entry.element.nodeName === "REMOVE" && !entry.element.hasChildNodes()
    && !(entry.element instanceof Element && entry.element.attributes.length);
}

/** The panel's CSS tried to reach past its own panel: it applies nowhere. */
export class PanelStyleOutsideError extends Error {}

/**
 * The panel's CSS as a stylesheet that reaches only this instance's own layout. It is scoped to the instance's element
 * and stops at what each member draws: the panel places its members, the components' looks are their own, and a value
 * the panel gives a design variable still reaches them by inheritance. The browser parses the CSS; a stylesheet whose
 * outermost level is anything but that one scope wrote its way out of it, and none of it applies.
 */
export function scopedPanelStyle(css: string, instance: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`@scope ([data-panel-instance="${instance}"]) to ([data-member] > *) {\n${css}\n}`);
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

/** Splits a panel's HTML in an inert document: nothing in it loads or runs while it is read. */
export function splitCodedPanelHtml(html: string): CodedPanelHtml {
  const inert = document.implementation.createHTMLDocument("");
  inert.body.innerHTML = html;
  const root = inert.getElementById("app");
  if (!root) throw new Error("A panel's HTML designates the element its component mounts into as #app");
  return {
    template: root.innerHTML,
    rootAttributes: Object.fromEntries([...root.attributes].filter(({ name }) => name !== "id").map(({ name, value }) => [name, value])),
    css: [...inert.querySelectorAll("style")].map(style => style.textContent ?? "").join("\n"),
  };
}
