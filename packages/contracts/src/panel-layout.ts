import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { matchesDirectPanelValue, type DirectPanelManifest } from "./panel-manifest";

export interface PanelLayoutPosition {
  offset: number;
  line: number;
  column: number;
}

export interface PanelLayoutCondition {
  state: string;
  operator: "eq" | "ne";
  value: string | number | boolean | null;
}

export interface PanelLayoutElement {
  kind: "element";
  tag: string;
  attrs: Record<string, string>;
  when?: PanelLayoutCondition;
  each?: string;
  children: PanelLayoutNode[];
  position: PanelLayoutPosition;
}

export interface PanelLayoutMember {
  kind: "member";
  ref: string;
  attrs: Record<string, string>;
  position: PanelLayoutPosition;
}

export interface PanelLayoutText {
  kind: "text";
  value: string;
  position: PanelLayoutPosition;
}

export type PanelLayoutNode = PanelLayoutElement | PanelLayoutMember | PanelLayoutText;

export interface PanelLayoutDocument {
  nodes: PanelLayoutNode[];
  css?: string;
}

export class PanelLayoutError extends Error {
  constructor(public readonly position: PanelLayoutPosition, message: string) {
    super(`${position.line}:${position.column} ${message}`);
    this.name = "PanelLayoutError";
  }
}

const scriptTags = new Set(["script", "iframe", "object", "embed"]);
const addressAttributes = new Set(["action", "background", "cite", "data", "formaction", "href", "longdesc", "poster", "src", "xlink:href"]);
const legacyAttributes = new Set(["flow", "gap", "fill"]);
const scriptDiagnostic = "Panel HTML cannot contain scripts. Use members and events for interactions.";

type HtmlNode = DefaultTreeAdapterTypes.ChildNode;
type SourceLocation = NonNullable<HtmlNode["sourceCodeLocation"]>;
const startOfDocument: PanelLayoutPosition = { offset: 0, line: 1, column: 1 };

function positionOf(location: SourceLocation | null | undefined, parent: PanelLayoutPosition): PanelLayoutPosition {
  return location ? { offset: location.startOffset, line: location.startLine, column: location.startCol } : parent;
}

function attributeName({ name, prefix }: DefaultTreeAdapterTypes.Element["attrs"][number]): string {
  return prefix ? `${prefix}:${name}` : name;
}

function diagnoseScripts(input: HtmlNode[], parentPosition: PanelLayoutPosition): void {
  for (const node of input) {
    if (!defaultTreeAdapter.isElementNode(node)) continue;
    const position = positionOf(node.sourceCodeLocation, parentPosition);
    if (scriptTags.has(node.tagName))
      throw new PanelLayoutError(position, `<${node.tagName}> is not allowed. ${scriptDiagnostic}`);
    for (const attr of node.attrs) {
      const name = attributeName(attr);
      const at = positionOf(node.sourceCodeLocation?.attrs?.[name], position);
      if (/^on/iu.test(name)) throw new PanelLayoutError(at, `Attribute '${name}' is not allowed. ${scriptDiagnostic}`);
      if (addressAttributes.has(name) && /^\s*javascript:/iu.test(attr.value.replace(/[\t\n\r]/gu, "")))
        throw new PanelLayoutError(at, `Attribute '${name}' uses a javascript: address. ${scriptDiagnostic}`);
    }
    diagnoseScripts("content" in node ? node.content.childNodes : node.childNodes, position);
  }
}

/** Parses the layout and diagnoses authoring mistakes. The browser host sanitizes HTML before rendering. */
export function parsePanelLayout(html: string, manifest: DirectPanelManifest): PanelLayoutDocument {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  diagnoseScripts(fragment.childNodes, startOfDocument);
  const placed = new Set<string>();
  let css: string | undefined;

  function condition(
    when: string | undefined, eq: string | undefined, ne: string | undefined, at: (name: string) => PanelLayoutPosition,
  ): PanelLayoutCondition | undefined {
    if (when === undefined && eq === undefined && ne === undefined) return undefined;
    if (!when || (eq === undefined) === (ne === undefined))
      throw new PanelLayoutError(at(when !== undefined ? "when" : eq !== undefined ? "eq" : "ne"), "A condition needs 'when' and one of 'eq' or 'ne'");
    if (!Object.hasOwn(manifest.state, when)) throw new PanelLayoutError(at("when"), `Undeclared state '${when}'`);
    const operator = eq === undefined ? "ne" : "eq";
    const comparison = (eq ?? ne)!;
    let value: unknown;
    try {
      value = JSON.parse(comparison);
    } catch (error) {
      if (error instanceof SyntaxError) throw new PanelLayoutError(at(operator), "Expected a JSON scalar or null");
      throw error;
    }
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      throw new PanelLayoutError(at(operator), "Expected a JSON scalar or null");
    if (!matchesDirectPanelValue(manifest.state[when].type, value))
      throw new PanelLayoutError(at(operator), `Comparison does not match state '${when}'`);
    return { state: when, operator, value };
  }

  function parseNodes(
    input: HtmlNode[], parentPosition: PanelLayoutPosition, repeat?: string,
  ): PanelLayoutNode[] {
    const nodes: PanelLayoutNode[] = [];
    for (const node of input) {
      const position = positionOf(node.sourceCodeLocation, parentPosition);
      if (defaultTreeAdapter.isTextNode(node)) {
        nodes.push({ kind: "text", value: node.value, position });
        continue;
      }
      if (!defaultTreeAdapter.isElementNode(node)) continue;
      const tag = node.tagName;
      const at = (name: string) => positionOf(node.sourceCodeLocation?.attrs?.[name], position);
      const attrs = Object.fromEntries(node.attrs.map(attr => [attributeName(attr), attr.value]));
      for (const name of legacyAttributes) {
        if (Object.hasOwn(attrs, name)) throw new PanelLayoutError(at(name), `Use CSS for layout instead of '${name}'`);
      }
      if (tag === "style") {
        if (css !== undefined) throw new PanelLayoutError(position, "Use only one <style> block in panel HTML");
        css = node.childNodes.filter(defaultTreeAdapter.isTextNode).map(child => child.value).join("");
        continue;
      }
      if (tag === "panel-member") {
        const { ref, ...memberAttrs } = attrs;
        for (const name of Object.keys(memberAttrs)) {
          if (name !== "class" && name !== "style") throw new PanelLayoutError(at(name), `Unknown member attribute '${name}'`);
        }
        if (!ref) throw new PanelLayoutError(at("ref"), "A panel member needs a 'ref'");
        if (!node.sourceCodeLocation?.endTag) throw new PanelLayoutError(position, "An explicit closing </panel-member> is required");
        if (node.childNodes.some(child => defaultTreeAdapter.isElementNode(child) ||
          (defaultTreeAdapter.isTextNode(child) && child.value.trim())))
          throw new PanelLayoutError(position, "A panel member has no children");
        if (ref.startsWith("$state.")) {
          const field = ref.slice("$state.".length);
          if (!Object.hasOwn(manifest.state, field) || manifest.state[field].type.kind !== "placement")
            throw new PanelLayoutError(at("ref"), `Expected a placement state field: '${field}'`);
        } else {
          if (!Object.hasOwn(manifest.members, ref)) throw new PanelLayoutError(at("ref"), `Undeclared member '${ref}'`);
          if (placed.has(ref)) throw new PanelLayoutError(at("ref"), `Member '${ref}' already has a layout position`);
          if (!repeat && Object.values(manifest.members[ref].inputs ?? {}).some(input => "item" in input))
            throw new PanelLayoutError(at("ref"), "A member that reads the repeat item must be inside a repeat");
          placed.add(ref);
        }
        nodes.push({ kind: "member", ref, attrs: memberAttrs, position });
        continue;
      }
      const { when, eq, ne, each, ...elementAttrs } = attrs;
      const comparison = condition(when, eq, ne, at);
      if (each !== undefined && (!Object.hasOwn(manifest.state, each) || manifest.state[each].type.kind !== "list"))
        throw new PanelLayoutError(at("each"), `Expected a list state field: '${each}'`);
      nodes.push({
        kind: "element", tag, attrs: elementAttrs, position,
        ...(comparison && { when: comparison }), ...(each !== undefined && { each }),
        children: parseNodes(node.childNodes, position, each ?? repeat),
      });
    }
    return nodes;
  }

  const nodes = parseNodes(fragment.childNodes, startOfDocument);
  return { nodes, ...(css !== undefined && { css }) };
}
