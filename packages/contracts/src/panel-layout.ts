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

export interface PanelLayoutContainer {
  kind: "container";
  tag: "div" | "section";
  flow: "row" | "column" | "grid";
  gap: "none" | "small" | "medium" | "large";
  when?: PanelLayoutCondition;
  children: PanelLayoutNode[];
  position: PanelLayoutPosition;
}

export interface PanelLayoutMember {
  kind: "member";
  ref: string;
  position: PanelLayoutPosition;
}

export type PanelLayoutNode = PanelLayoutContainer | PanelLayoutMember;

export class PanelLayoutError extends Error {
  constructor(public readonly position: PanelLayoutPosition, message: string) {
    super(`${position.line}:${position.column} ${message}`);
    this.name = "PanelLayoutError";
  }
}

interface Attribute {
  value: string;
  offset: number;
}

const memberAttributes = new Set(["ref"]);
const containerAttributes = new Set(["flow", "gap", "when", "eq", "ne"]);

/** Parse the direct layout subset without browser HTML repair or interpretation. */
export function parsePanelLayout(html: string, manifest: DirectPanelManifest): PanelLayoutNode[] {
  const lineStarts = [0];
  for (const match of html.matchAll(/\r\n?|\n/gu)) lineStarts.push(match.index + match[0].length);
  function positionAt(offset: number): PanelLayoutPosition {
    let line = 0;
    let end = lineStarts.length;
    while (end - line > 1) {
      const middle = (line + end) >>> 1;
      if (lineStarts[middle] <= offset) line = middle;
      else end = middle;
    }
    return { offset, line: line + 1, column: offset - lineStarts[line] + 1 };
  }

  let offset = 0;
  function take(pattern: RegExp): RegExpExecArray | null {
    pattern.lastIndex = offset;
    const token = pattern.exec(html);
    if (token) offset = pattern.lastIndex;
    return token;
  }
  function fail(at: number, message: string): never {
    throw new PanelLayoutError(positionAt(at), message);
  }

  function attributes(allowed: ReadonlySet<string>): Map<string, Attribute> {
    const attrs = new Map<string, Attribute>();
    while (true) {
      const space = take(/[ \t\r\n\f]+/y);
      if (take(/>/y)) return attrs;
      const at = offset;
      const name = space && take(/[A-Za-z_][A-Za-z0-9_.:-]*/y)?.[0];
      if (!name) fail(at, "Expected a quoted attribute or '>'");
      if (!allowed.has(name)) fail(at, `Unknown attribute '${name}'`);
      if (attrs.has(name)) fail(at, `Duplicate attribute '${name}'`);
      const value = take(/[ \t\r\n\f]*=[ \t\r\n\f]*(?:"([^"<]*)"|'([^'<]*)')/y);
      if (!value) fail(at, `Expected a quoted value for '${name}'`);
      attrs.set(name, { value: value[1] ?? value[2], offset: at });
    }
  }

  function choice<T extends string>(attrs: Map<string, Attribute>, name: string, values: readonly T[], fallback: T): T {
    const attr = attrs.get(name);
    if (!attr) return fallback;
    const value = values.find(value => value === attr.value);
    if (!value) fail(attr.offset, `Invalid value for '${name}'`);
    return value;
  }

  function condition(attrs: Map<string, Attribute>, start: number): PanelLayoutCondition | undefined {
    const when = attrs.get("when");
    const eq = attrs.get("eq");
    const ne = attrs.get("ne");
    if (!when && !eq && !ne) return undefined;
    if (!when || Boolean(eq) === Boolean(ne)) fail((when ?? eq ?? ne)?.offset ?? start, "A condition needs 'when' and one of 'eq' or 'ne'");
    const field = manifest.state[when.value];
    if (!Object.hasOwn(manifest.state, when.value)) fail(when.offset, `Undeclared state '${when.value}'`);
    const comparison = (eq ?? ne)!;
    let value: unknown;
    try {
      value = JSON.parse(comparison.value);
    } catch (error) {
      if (error instanceof SyntaxError) fail(comparison.offset, "Expected a JSON scalar or null");
      throw error;
    }
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")
      fail(comparison.offset, "Expected a JSON scalar or null");
    if (!matchesDirectPanelValue(field.type, value)) fail(comparison.offset, `Comparison does not match state '${when.value}'`);
    return { state: when.value, operator: eq ? "eq" : "ne", value };
  }

  const roots: PanelLayoutNode[] = [];
  const parents: { tag: string; node: PanelLayoutNode }[] = [];
  const placed = new Set<string>();
  while (offset < html.length) {
    take(/[ \t\r\n\f]+/y);
    if (offset === html.length) break;
    const start = offset;
    const closing = take(/<\/([a-z][a-z0-9-]*)[ \t\r\n\f]*>/y);
    if (closing) {
      if (parents.at(-1)?.tag !== closing[1]) fail(start, `Unexpected closing tag '${closing[1]}'`);
      parents.pop();
      continue;
    }
    const tag = take(/<([a-z][a-z0-9-]*)/y)?.[1];
    if (tag !== "div" && tag !== "section" && tag !== "panel-member")
      fail(start, tag ? `Unknown tag '${tag}'` : "Expected a layout container or member");
    const parent = parents.at(-1)?.node;
    if (parent?.kind === "member") fail(start, "A panel member has no children");
    const attrs = attributes(tag === "panel-member" ? memberAttributes : containerAttributes);
    let node: PanelLayoutNode;
    if (tag === "panel-member") {
      const ref = attrs.get("ref");
      if (!ref) fail(start, "A panel member needs a 'ref'");
      if (!Object.hasOwn(manifest.members, ref.value)) fail(ref.offset, `Undeclared member '${ref.value}'`);
      if (placed.has(ref.value)) fail(ref.offset, `Member '${ref.value}' already has a layout position`);
      placed.add(ref.value);
      node = { kind: "member", ref: ref.value, position: positionAt(start) };
    } else {
      const when = condition(attrs, start);
      node = {
        kind: "container", tag,
        flow: choice(attrs, "flow", ["row", "column", "grid"], "column"),
        gap: choice(attrs, "gap", ["none", "small", "medium", "large"], "medium"),
        ...(when && { when }), children: [], position: positionAt(start),
      };
    }
    (parent ? parent.children : roots).push(node);
    parents.push({ tag, node });
  }
  const unclosed = parents.at(-1);
  if (unclosed) fail(unclosed.node.position.offset, `Unclosed tag '${unclosed.tag}'`);
  return roots;
}
