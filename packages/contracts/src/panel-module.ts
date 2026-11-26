import { init, parse } from "es-module-lexer";
import {
  SDK_RENAMED_EXPORTS,
  SDK_UI_ENTRY_SPECIFIER,
  sdkRenamedExportByImpl,
  sdkThemeTokenReplacement,
  sdkUiComponentByImplExport,
  sdkUiComponentByImplTag,
  sdkUiComponentByTag,
  sdkUiDirectiveByImplName,
  sdkUiForbiddenByImplExport,
  sdkUiForbiddenByImplTag,
} from "./sdk-ui-map";

/** The module namespaces supplied by the direct panel host. */
export const panelModuleSpecifiers = {
  vue: "vue",
  sdk: "@ontomato/sdk/panel",
} as const;

/** Where a member's own inputs come from, and where a value that follows the page goes. */
export const projectionSlotInputsGuidance =
  "Use :inputs on <projection> only inside a component's scoped slot, where an instance is the row's or the item's. Bind the member's other inputs in panel.json with { state }, { state, field }, or { output }, and pass a value that follows the page with :values.";

/** What a placement on `<Projection>` may carry. */
export const projectionPlacementGuidance =
  "An attribute on <Projection> configures nothing: write a fixed value in the member's config in panel.json, and a value that follows the page through :values. <Projection> takes slot, inputs, values, class, style, key, ref, listeners and Vue control directives.";

export type PanelModuleSpecifier = typeof panelModuleSpecifiers[keyof typeof panelModuleSpecifiers];

/**
 * The official module entries that component packages and author-registered components may import.
 * Excludes third-party bare specifiers such as `element-plus` and `echarts`; UI primitives come from
 * `@ontomato/sdk/ui` and charts come from `@ontomato/sdk/chart`.
 */
export const componentOfficialSpecifiers = [
  "vue",
  "@ontomato/sdk",
  SDK_UI_ENTRY_SPECIFIER,
  "@ontomato/sdk/panel",
  "@ontomato/sdk/base",
  "@ontomato/sdk/graph",
  "@ontomato/sdk/chart",
  "@ontomato/sdk/markdown",
  "@ontomato/sdk/form",
  "@ontomato/sdk/code",
  "@ontomato/sdk/preview",
  "@ontomato/sdk/chat",
] as const;

export type ComponentOfficialSpecifier = typeof componentOfficialSpecifiers[number];

const officialComponentSet = new Set<string>(componentOfficialSpecifiers);

function isPanelModuleSpecifier(specifier: string | undefined): specifier is PanelModuleSpecifier {
  return Object.values(panelModuleSpecifiers).some(allowed => allowed === specifier);
}

export function isComponentOfficialSpecifier(specifier: string): specifier is ComponentOfficialSpecifier {
  return officialComponentSet.has(specifier);
}

/** Read import and export facts from an ES module without executing it. */
export async function readModuleFacts(source: string, name?: string) {
  await init;
  const [imports, exports] = parse(source, name);
  return { imports, exports };
}

/** Validate the imports and return the exact spans the direct host can replace with its module URLs. */
export async function panelModuleImports(source: string) {
  const { imports } = await readModuleFacts(source);
  return imports.flatMap(({ specifier, type, start, end }) => {
    if (specifier === null) return [];
    if (!isPanelModuleSpecifier(specifier)) {
      const hint = specifier === "element-plus" || specifier?.startsWith("element-plus/")
        ? `; use <sdk-*> tags in panel.html or usePanelContext().notify() from ${panelModuleSpecifiers.sdk}`
        : specifier === "echarts" || specifier?.startsWith("echarts/")
          ? "; use <e-chart> in panel.html or the MetricChart projection component instead"
          : "";
      throw new Error(`A panel's module imports ${specifier ?? "a computed module"}, which the platform does not give it${hint}`);
    }
    return [{ specifier, start, end, dynamic: type === "dynamic" }];
  });
}

export interface ComponentModuleImport {
  readonly specifier: string;
  readonly start: number;
  readonly end: number;
  readonly dynamic: boolean;
  readonly kind: "official" | "own" | "relative";
}

/** Validate ES imports in a component package or author component module. */
export async function componentModuleImports(
  source: string,
  options: { readonly ownEntries?: ReadonlySet<string>; readonly allowRelative?: boolean } = {},
): Promise<ComponentModuleImport[]> {
  const { imports } = await readModuleFacts(source);
  const allowRelative = options.allowRelative ?? true;
  const resolved: ComponentModuleImport[] = [];
  for (const { specifier, type, start, end } of imports) {
    if (specifier === null) continue;
    if (specifier === undefined) {
      throw new Error("A component module cannot use a computed dynamic import");
    }
    if (specifier === "element-plus" || specifier.startsWith("element-plus/")) {
      throw new Error(`Component module imports '${specifier}'; import SDK UI primitives from '${SDK_UI_ENTRY_SPECIFIER}' instead`);
    }
    if (specifier === "echarts" || specifier.startsWith("echarts/")) {
      throw new Error(`Component module imports '${specifier}'; import chart components from '@ontomato/sdk/chart' instead`);
    }
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (isRelative) {
      if (!allowRelative) {
        throw new Error(`Component module imports relative module '${specifier}', which is not allowed here`);
      }
      resolved.push({ specifier, start, end, dynamic: type === "dynamic", kind: "relative" });
      continue;
    }
    if (options.ownEntries?.has(specifier)) {
      resolved.push({ specifier, start, end, dynamic: type === "dynamic", kind: "own" });
      continue;
    }
    if (isComponentOfficialSpecifier(specifier)) {
      resolved.push({ specifier, start, end, dynamic: type === "dynamic", kind: "official" });
      continue;
    }
    throw new Error(`Component module imports '${specifier}', which is outside the official SDK entries`);
  }
  return resolved;
}

export type SdkAuthoringViolationKind =
  | "forbidden-tag"
  | "unknown-sdk-tag"
  | "forbidden-import"
  | "forbidden-directive"
  | "forbidden-token"
  | "forbidden-selector"
  | "forbidden-export"
  | "forbidden-direct-api"
  | "projection-inputs-outside-slot"
  | "projection-placement-attribute"
  | "projection-config-duplicate"
  | "projection-config-literal";

export interface SdkAuthoringViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly kind: SdkAuthoringViolationKind;
  readonly found: string;
  readonly replacement: string | null;
  readonly message: string;
}

export interface CheckAuthoringTemplateOptions {
  readonly allowedSdkTags?: ReadonlySet<string>;
}

export interface CheckAuthoringScriptOptions {
  /** Whether the checked module is a panel script (`panel.mjs`) or a component module. Defaults to `"component"`. */
  readonly target?: "panel" | "component";
}

interface TemplateAttribute {
  readonly name: string;
  readonly nameOffset: number;
  readonly value: string | undefined;
  readonly valueOffset: number | undefined;
}

interface TemplateOpeningTag {
  readonly tagName: string;
  readonly nameOffset: number;
  readonly tagStart: number;
  readonly attributes: readonly TemplateAttribute[];
  readonly insideScopedSlot: boolean;
}

const templateTagNameChar = /[A-Za-z0-9_.:-]/u;

/** Skip a Vue `{{ ... }}` mustache interpolation while respecting string literals inside it. */
function findMustacheEnd(source: string, openIndex: number): number {
  const len = source.length;
  let i = openIndex + 2;
  let quote: string | null = null;
  while (i < len) {
    const ch = source[i]!;
    if (quote !== null) {
      if (ch === "\\" && i + 1 < len) {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === "}" && source[i + 1] === "}") {
      return i + 2;
    }
    i++;
  }
  return -1;
}

/**
 * Scan HTML/Vue opening tags from comment/script/style-blanked template text.
 * Skips Vue mustache interpolations and quoted attribute values so tags inside expressions or
 * attribute strings are not mistaken for template elements.
 */
function scanTemplateOpeningTags(sanitized: string): TemplateOpeningTag[] {
  const tags: TemplateOpeningTag[] = [];
  const ancestors: { name: string; scopedChildren: boolean }[] = [];
  const len = sanitized.length;
  let i = 0;

  while (i < len) {
    const ch = sanitized[i]!;
    if (ch === "{" && sanitized[i + 1] === "{") {
      const end = findMustacheEnd(sanitized, i);
      i = end !== -1 ? end : i + 2;
      continue;
    }
    if (ch !== "<") {
      i++;
      continue;
    }
    // Closing tag `</name>`
    if (sanitized[i + 1] === "/" && /[A-Za-z]/u.test(sanitized[i + 2] ?? "")) {
      const nameStart = i + 2;
      let j = nameStart;
      while (j < len && templateTagNameChar.test(sanitized[j]!)) j++;
      const closingName = sanitized.slice(nameStart, j).toLowerCase();
      for (let index = ancestors.length - 1; index >= 0; index--) {
        if (ancestors[index]!.name.toLowerCase() === closingName) {
          ancestors.length = index;
          break;
        }
      }
      while (j < len && sanitized[j] !== ">") j++;
      i = j < len ? j + 1 : len;
      continue;
    }
    // Opening tag `<Name ...>`
    if (!/[A-Za-z]/u.test(sanitized[i + 1] ?? "")) {
      i++;
      continue;
    }
    const tagStart = i;
    const nameOffset = i + 1;
    let nameEnd = nameOffset;
    while (nameEnd < len && templateTagNameChar.test(sanitized[nameEnd]!)) nameEnd++;
    const boundary = sanitized[nameEnd];
    if (boundary !== undefined && !/[\s/>]/u.test(boundary)) {
      i++;
      continue;
    }
    const tagName = sanitized.slice(nameOffset, nameEnd);
    let j = nameEnd;
    let quote: string | null = null;
    while (j < len) {
      const c = sanitized[j]!;
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }
    const tagEnd = j < len ? j + 1 : len;
    const tagText = sanitized.slice(tagStart, tagEnd);
    const attributes = readTagAttributes(tagText);
    const parent = ancestors.at(-1);
    const insideScopedSlot = parent?.scopedChildren ?? false;
    tags.push({ tagName, nameOffset, tagStart, attributes, insideScopedSlot });
    const lowerTag = tagName.toLowerCase();
    if (!htmlVoidTags.has(lowerTag) && !tagText.endsWith("/>")) {
      const slotOwner = lowerTag === "template" ? parent?.name : tagName;
      const opensScopedSlot = slotOwner !== undefined && canSupplySlotProps(slotOwner)
        && attributes.some(attr => /^(?:#.+|v-slot(?::.+)?)$/u.test(attr.name) && attr.value?.trim());
      ancestors.push({ name: tagName, scopedChildren: insideScopedSlot || opensScopedSlot });
    }
    i = tagEnd;
  }
  return tags;
}

/** Parse attributes of a single opening tag `<Name ...>` with exact offsets relative to `tagText`. */
function readTagAttributes(tagText: string): TemplateAttribute[] {
  const attrs: TemplateAttribute[] = [];
  const len = tagText.length;
  let i = 1;
  while (i < len && templateTagNameChar.test(tagText[i]!)) i++;
  while (i < len) {
    while (i < len && /[\s/]/u.test(tagText[i]!)) i++;
    if (i >= len || tagText[i] === ">") break;
    const nameOffset = i;
    while (i < len && !/[\s=/>]/u.test(tagText[i]!)) i++;
    const name = tagText.slice(nameOffset, i);
    if (!name) {
      i++;
      continue;
    }
    while (i < len && /\s/u.test(tagText[i]!)) i++;
    if (tagText[i] !== "=") {
      attrs.push({ name, nameOffset, value: undefined, valueOffset: undefined });
      continue;
    }
    i++; // skip '='
    while (i < len && /\s/u.test(tagText[i]!)) i++;
    const ch = tagText[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const valueOffset = i + 1;
      i = valueOffset;
      while (i < len && tagText[i] !== quote) i++;
      const value = tagText.slice(valueOffset, i);
      if (i < len) i++;
      attrs.push({ name, nameOffset, value, valueOffset });
    } else {
      const valueOffset = i;
      while (i < len && !/[\s/>]/u.test(tagText[i]!)) i++;
      const value = tagText.slice(valueOffset, i);
      attrs.push({ name, nameOffset, value, valueOffset });
    }
  }
  return attrs;
}

/**
 * Blank CSS comments, quoted strings, and unquoted `url(...)` bodies with spaces while preserving
 * line breaks so character offsets remain exact for line/column diagnostics.
 */
function stripCssCommentsAndStrings(css: string): string {
  const out: string[] = [];
  let i = 0;
  const len = css.length;
  while (i < len) {
    const ch = css[i]!;
    if (ch === "/" && css[i + 1] === "*") {
      out.push("  ");
      i += 2;
      while (i < len) {
        if (css[i] === "*" && css[i + 1] === "/") {
          out.push("  ");
          i += 2;
          break;
        }
        out.push(css[i] === "\n" || css[i] === "\r" ? css[i]! : " ");
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out.push(" ");
      i++;
      while (i < len) {
        const c = css[i]!;
        if (c === "\\" && i + 1 < len) {
          const next = css[i + 1]!;
          out.push(" ", next === "\n" || next === "\r" ? next : " ");
          i += 2;
          continue;
        }
        out.push(c === "\n" || c === "\r" ? c : " ");
        i++;
        if (c === quote) break;
      }
      continue;
    }
    if (
      (ch === "u" || ch === "U")
      && (css[i + 1] === "r" || css[i + 1] === "R")
      && (css[i + 2] === "l" || css[i + 2] === "L")
      && css[i + 3] === "("
      && (i === 0 || !/[A-Za-z0-9_-]/u.test(css[i - 1]!))
    ) {
      out.push(css.slice(i, i + 4));
      i += 4;
      while (i < len && (css[i] === " " || css[i] === "\t" || css[i] === "\n" || css[i] === "\r")) {
        out.push(css[i]!);
        i++;
      }
      if (i < len && css[i] !== '"' && css[i] !== "'") {
        while (i < len) {
          const c = css[i]!;
          if (c === "\\" && i + 1 < len) {
            const next = css[i + 1]!;
            out.push(" ", next === "\n" || next === "\r" ? next : " ");
            i += 2;
            continue;
          }
          if (c === ")") {
            out.push(")");
            i++;
            break;
          }
          out.push(c === "\n" || c === "\r" ? c : " ");
          i++;
        }
      }
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

function toKebabCase(name: string): string {
  return name.replace(/(?!^)[A-Z]/g, letter => "-" + letter).toLowerCase();
}

const overlayTags = new Set(["sdk-dialog", "sdk-drawer", "sdk-popover", "sdk-popconfirm", "sdk-tooltip"]);
const htmlVoidTags = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

/** Whether a tag's slot passes it values, which is what a placement inside it receives as member inputs. */
function canSupplySlotProps(tag: string): boolean {
  const lower = tag.toLowerCase();
  if (overlayTags.has(lower) || overlayTags.has(toKebabCase(tag))) return false;
  return lower === "projection" || lower === "component" || tag.includes("-") || /^[A-Z]/u.test(tag);
}

/** The names a placement on `<Projection>` may carry beyond its own inputs: nothing there configures the component. */
const placementAttributeName = /^(?:slot|inputs|values|class|style|key|ref)$/u;

function isPlacementAttribute(name: string): boolean {
  if (/^(?:@|v-on:)/u.test(name)) return true;
  if (/^v-(?:if|else|else-if|for|show|once|pre|cloak)(?:$|\.)/u.test(name)) return true;
  if (/^(?:#|v-slot(?::|$))/u.test(name)) return true;
  const bound = /^(?::|v-bind:)(.+)$/u.exec(name);
  return placementAttributeName.test(bound ? bound[1]! : name);
}

/** Whether the text is a value written as it is, rather than something the page computes. */
function isConstantLiteral(value: string): boolean {
  const text = value.trim();
  if (/^(?:true|false|null)$/u.test(text)) return true;
  if (/^-?\d+(?:\.\d+)?$/u.test(text)) return true;
  if (/^'(?:[^'\\]|\\.)*'$/u.test(text) || /^"(?:[^"\\]|\\.)*"$/u.test(text)) return true;
  return /^`[^`$]*`$/u.test(text);
}

/**
 * The statically written entries of an object literal, or `null` when the expression does not show them (a reference
 * to another value, a spread, a computed key).
 */
function objectLiteralEntries(expression: string): { key: string; value: string }[] | null {
  const text = expression.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  const body = text.slice(1, -1);
  const segments: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("{[(".includes(ch)) depth++;
    else if ("}])".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      segments.push(body.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(body.slice(start));
  const entries: { key: string; value: string }[] = [];
  for (const segment of segments) {
    const entry = segment.trim();
    if (!entry) continue;
    if (entry.startsWith("...") || entry.startsWith("[")) return null;
    const quoted = /^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)\s*(?::|$)([\s\S]*)$/u.exec(entry);
    const bare = quoted ? null : /^([A-Za-z_$][\w$]*)\s*(?::|$)([\s\S]*)$/u.exec(entry);
    if (!quoted && !bare) return null;
    entries.push({
      key: quoted ? (quoted[1] ?? quoted[2] ?? quoted[3]!) : bare![1]!,
      value: quoted ? quoted[4]! : bare![2]!,
    });
  }
  return entries;
}

function makeViolation(
  source: string,
  file: string,
  offset: number,
  kind: SdkAuthoringViolationKind,
  found: string,
  replacement: string | null,
  message: string,
): SdkAuthoringViolation {
  const { line, column } = lineAndColumn(source, offset);
  return { file, line, column, kind, found, replacement, message };
}

/**
 * Check a CSS block or stylesheet for unsupported selectors and third-party `--el-*` variables.
 */
export function checkAuthoringStyles(
  css: string,
  file: string,
  baseOffset = 0,
  fullSource = css,
): SdkAuthoringViolation[] {
  const violations: SdkAuthoringViolation[] = [];
  const stripped = stripCssCommentsAndStrings(css);
  for (const match of stripped.matchAll(/::v-deep(?![\w-])|:deep\(/gu)) {
    const found = match[0];
    const message = `Panel <style> uses native browser CSS. The host scopes it to the panel instance without Vue SFC compilation. The browser silently drops rules using '${found}'. Use a descendant selector such as '.wrap .sdk-owner-form'.`;
    violations.push(makeViolation(fullSource, file, baseOffset + match.index!, "forbidden-selector", found, null, message));
  }
  for (const match of stripped.matchAll(/--el-[a-z0-9-]+/gu)) {
    const found = match[0];
    const replacement = sdkThemeTokenReplacement(found);
    const message = replacement
      ? `Replace third-party theme variable '${found}' with '${replacement}'`
      : `Do not use third-party theme variable '${found}'; use a published --sdk-* or platform design token`;
    violations.push(makeViolation(fullSource, file, baseOffset + match.index!, "forbidden-token", found, replacement, message));
  }
  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Check a panel or application `theme` override object for third-party `--el-*` keys. */
export function checkAuthoringTheme(
  theme: { readonly light?: Readonly<Record<string, string>>; readonly dark?: Readonly<Record<string, string>> } | undefined,
  file: string,
): SdkAuthoringViolation[] {
  if (!theme) return [];
  const violations: SdkAuthoringViolation[] = [];
  for (const mode of ["light", "dark"] as const) {
    for (const key of Object.keys(theme[mode] ?? {})) {
      if (!key.startsWith("--el-")) continue;
      const replacement = sdkThemeTokenReplacement(key);
      const message = replacement
        ? `theme.${mode}.${key}: replace third-party variable '${key}' with '${replacement}'`
        : `theme.${mode}.${key}: do not use third-party variable '${key}'`;
      violations.push({
        file,
        line: 1,
        column: 1,
        kind: "forbidden-token",
        found: key,
        replacement,
        message,
      });
    }
  }
  return violations;
}

/** One member of a panel's declaration, as far as where its component's values are written matters. */
export interface ProjectionConfigMember {
  readonly config?: Readonly<Record<string, unknown>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

function duplicateValueViolation(file: string, member: string, name: string, where: string): SdkAuthoringViolation {
  return {
    file,
    line: 1,
    column: 1,
    kind: "projection-config-duplicate",
    found: name,
    replacement: null,
    message: `Member '${member}' writes '${name}' ${where}; a value has one owner: a fixed one in the member's config, a value that follows the page through its input.`,
  };
}

/**
 * Check that one member writes one value in one place: its fixed configuration in the declaration, or its input, never
 * both, and never the same input in the declaration and where the member is placed.
 */
export function checkProjectionConfigSources(
  members: Readonly<Record<string, ProjectionConfigMember>>,
  template: string | undefined,
  file: string,
): SdkAuthoringViolation[] {
  const violations: SdkAuthoringViolation[] = [];
  for (const [member, declaration] of Object.entries(members)) {
    const config = declaration.config ?? {};
    for (const name of Object.keys(declaration.inputs ?? {})) {
      if (Object.hasOwn(config, name)) violations.push(duplicateValueViolation(file, member, name, "in both config and inputs"));
    }
  }
  if (template === undefined) return violations;
  const sanitized = template
    .replace(/<!--[\s\S]*?-->/gu, match => match.replace(/[^\r\n]/gu, " "))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, match => match.replace(/[^\r\n]/gu, " "))
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/giu, match => match.replace(/[^\r\n]/gu, " "));
  for (const tag of scanTemplateOpeningTags(sanitized)) {
    if (tag.tagName.toLowerCase() !== "projection") continue;
    const slot = tag.attributes.find(attr => attr.name === "slot" || attr.name === ":slot" || attr.name === "v-bind:slot");
    if (slot?.value === undefined) continue;
    const member = slot.value.trim();
    const declaration = members[member];
    if (!declaration) continue;
    for (const attr of tag.attributes) {
      const bound = /^(?::|v-bind:)(inputs|values)$/u.exec(attr.name);
      if (!bound || attr.value === undefined) continue;
      const written = objectLiteralEntries(attr.value);
      for (const { key: name, value } of written ?? []) {
        if (Object.hasOwn(declaration.config ?? {}, name)) {
          violations.push(makeViolation(
            template, file, tag.tagStart + attr.nameOffset, "projection-config-duplicate", name, null,
            `Member '${member}' writes '${name}' in its config and again in the placement's :${bound[1]}; keep the value where it belongs: fixed presentation in config, a value that follows the page in :values.`,
          ));
        } else if (Object.hasOwn(declaration.inputs ?? {}, name)
          // `{ fromSlot: true }` declares that the slot supplies this input: the placement is its only source.
          && !(bound[1] === "inputs" && "fromSlot" in (declaration.inputs![name] as object))) {
          violations.push(makeViolation(
            template, file, tag.tagStart + attr.nameOffset, "projection-config-duplicate", name, null,
            `Member '${member}' binds input '${name}' in its declaration and again in the placement's :${bound[1]}; one input has one source.`,
          ));
        }
        if (bound[1] === "values" && isConstantLiteral(value)) {
          violations.push(makeViolation(
            template, file, tag.tagStart + attr.nameOffset, "projection-config-literal", name, null,
            `Member '${member}' writes '${name}' as a fixed value where the member is placed; a value that never changes belongs in the member's config, and :values carries only the ones that follow the page.`,
          ));
        }
      }
    }
  }
  return violations;
}

/** Check an HTML or Vue template (including inline `<style>` blocks and `style` attributes) for forbidden authoring patterns. */
export function checkAuthoringTemplate(
  template: string,
  file: string,
  options: CheckAuthoringTemplateOptions = {},
): SdkAuthoringViolation[] {
  const violations: SdkAuthoringViolation[] = [];
  // Preserve offsets by blanking comments and script bodies while scanning <style> bodies separately.
  let sanitized = template.replace(/<!--[\s\S]*?-->/gu, match => match.replace(/[^\r\n]/gu, " "));
  sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, match => match.replace(/[^\r\n]/gu, " "));
  sanitized = sanitized.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/giu, (full, body: string, offset: number) => {
    const bodyOffset = offset + full.indexOf(body);
    violations.push(...checkAuthoringStyles(body, file, bodyOffset, template));
    return full.replace(/[^\r\n]/gu, " ");
  });

  const openingTags = scanTemplateOpeningTags(sanitized);

  for (const tag of openingTags) {
    const attrs = tag.attributes;
    const rawTag = tag.tagName;
    const kebab = toKebabCase(rawTag);

    // 1. Check static inline `style="..."` / `style='...'` attributes.
    for (const attr of attrs) {
      if (attr.name.toLowerCase() === "style" && attr.value !== undefined && attr.valueOffset !== undefined) {
        violations.push(
          ...checkAuthoringStyles(attr.value, file, tag.tagStart + attr.valueOffset, template),
        );
      }
    }

    // 2. Check opening tags for <el-*>, <El*>, unknown <sdk-*>, and renamed exports.
    if (kebab.startsWith("el-")) {
      const mapped = sdkUiComponentByImplTag(kebab);
      if (mapped) {
        violations.push(makeViolation(
          template, file, tag.nameOffset, "forbidden-tag", rawTag, `<${mapped.sdkTag}>`,
          `Replace third-party tag <${rawTag}> with <${mapped.sdkTag}>`,
        ));
      } else {
        const forbidden = sdkUiForbiddenByImplTag(kebab);
        violations.push(makeViolation(
          template, file, tag.nameOffset, "forbidden-tag", rawTag, forbidden?.replacement ?? null,
          forbidden
            ? `Tag <${rawTag}> is not exposed by the SDK: ${forbidden.replacement}`
            : `Do not use third-party tag <${rawTag}>; use a published <sdk-*> component`,
        ));
      }
    } else if (kebab.startsWith("sdk-")) {
      const allowed = options.allowedSdkTags ? options.allowedSdkTags.has(kebab) : sdkUiComponentByTag(kebab) !== undefined;
      if (!allowed) {
        const forbidden = sdkUiForbiddenByImplTag(`el-${kebab.slice(4)}`);
        violations.push(makeViolation(
          template, file, tag.nameOffset, "unknown-sdk-tag", rawTag, forbidden?.replacement ?? null,
          forbidden
            ? `Tag <${rawTag}> is not part of the SDK UI list: ${forbidden.replacement}`
            : `Unknown SDK UI tag <${rawTag}>; choose a tag from the SDK UI catalogue`,
        ));
      }
    } else {
      const renamed = sdkRenamedExportByImpl(rawTag) ?? sdkRenamedExportByImpl(kebab);
      if (renamed) {
        violations.push(makeViolation(
          template, file, tag.nameOffset, "forbidden-export", rawTag, `<${renamed.sdkTag}>`,
          `Replace renamed component tag <${rawTag}> with <${renamed.sdkTag}>`,
        ));
      }
    }

    // 3. Check dynamic component `is="..."` / `:is="'...'"` / `v-bind:is="'...'"` and forbidden directives.
    for (const attr of attrs) {
      const lowerAttr = attr.name.toLowerCase();
      if (rawTag.toLowerCase() === "projection" && !tag.insideScopedSlot && /^(?:v-bind:|:)?inputs$/u.test(lowerAttr)) {
        violations.push(makeViolation(
          template, file, tag.tagStart + attr.nameOffset, "projection-inputs-outside-slot",
          attr.name, null, projectionSlotInputsGuidance,
        ));
      }
      if (rawTag.toLowerCase() === "projection" && !isPlacementAttribute(lowerAttr)) {
        violations.push(makeViolation(
          template, file, tag.tagStart + attr.nameOffset, "projection-placement-attribute",
          attr.name, null, projectionPlacementGuidance,
        ));
      }
      if ((lowerAttr === "is" || lowerAttr === ":is" || lowerAttr === "v-bind:is") && attr.value !== undefined) {
        const raw = attr.value.trim().replace(/^['"]|['"]$/gu, "");
        const isKebab = toKebabCase(raw);
        const offset = tag.tagStart + attr.nameOffset;
        if (isKebab.startsWith("el-")) {
          const mapped = sdkUiComponentByImplTag(isKebab);
          const forbidden = mapped ? undefined : sdkUiForbiddenByImplTag(isKebab);
          violations.push(makeViolation(
            template, file, offset, "forbidden-tag", raw, mapped ? mapped.sdkTag : (forbidden?.replacement ?? null),
            mapped
              ? `Replace third-party component '${raw}' with '${mapped.sdkTag}'`
              : `Do not reference third-party component '${raw}'${forbidden ? `: ${forbidden.replacement}` : ""}`,
          ));
        } else {
          const renamed = sdkRenamedExportByImpl(raw) ?? sdkRenamedExportByImpl(isKebab);
          if (renamed) {
            violations.push(makeViolation(
              template, file, offset, "forbidden-export", raw, renamed.sdkTag,
              `Replace renamed component '${raw}' with '${renamed.sdkTag}'`,
            ));
          }
        }
        continue;
      }

      if (lowerAttr.startsWith("v-")) {
        const directiveName = lowerAttr.split(/[.:]/u, 1)[0]!;
        const mapped = sdkUiDirectiveByImplName(directiveName);
        if (!mapped) continue;
        const foundName = attr.name.slice(0, directiveName.length);
        violations.push(makeViolation(
          template, file, tag.tagStart + attr.nameOffset, "forbidden-directive", foundName, mapped.sdkName,
          `Replace directive '${foundName}' with '${mapped.sdkName}'`,
        ));
      }
    }
  }

  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

const DIRECT_API_GUIDANCE = "Use a declared projection to read business data or invoke a registered operation instead";
const DIRECT_API_IDENTIFIERS = /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\b/gu;
const DIRECT_API_PATH_PATTERN = /\/api\//gu;
const REGEX_PRECEDING_CHAR = /[(=,:;[!?&|{+*\-~^%]/u;
const REGEX_PRECEDING_KEYWORD = /\b(?:return|case|throw|typeof|void|delete|in|of|new|yield|await)$/u;

function canStartRegexLiteral(source: string, slashIndex: number): boolean {
  let j = slashIndex - 1;
  while (j >= 0 && /\s/u.test(source[j]!)) j--;
  if (j < 0) return true;
  if (REGEX_PRECEDING_CHAR.test(source[j]!)) return true;
  const tail = source.slice(Math.max(0, j - 10), j + 1);
  return REGEX_PRECEDING_KEYWORD.test(tail);
}

/**
 * Simple lexical scan (no AST) that strips JS comments, regex literals, and string/template contents into an
 * offset-preserving code string while collecting string/template segments for hardcoded `/api/` path checks.
 */
function scanScriptLexemes(source: string): { codeOnly: string; stringSegments: Array<{ offset: number; text: string }> } {
  const out: string[] = [];
  const stringSegments: Array<{ offset: number; text: string }> = [];
  const len = source.length;
  // Stack of open brace depths for `${...}` interpolations inside template literals.
  const templateBraceDepths: number[] = [];
  let i = 0;

  const pushBlank = (text: string) => {
    for (let k = 0; k < text.length; k++) {
      const c = text[k]!;
      out.push(c === "\n" || c === "\r" ? c : " ");
    }
  };

  const scanTemplateChunk = () => {
    const segStart = i;
    while (i < len) {
      const c = source[i]!;
      if (c === "\\" && i + 1 < len) {
        pushBlank(source.slice(i, i + 2));
        i += 2;
        continue;
      }
      if (c === "`") {
        stringSegments.push({ offset: segStart, text: source.slice(segStart, i) });
        out.push(" ");
        i++;
        return;
      }
      if (c === "$" && source[i + 1] === "{") {
        stringSegments.push({ offset: segStart, text: source.slice(segStart, i) });
        out.push("${");
        i += 2;
        templateBraceDepths.push(0);
        return;
      }
      out.push(c === "\n" || c === "\r" ? c : " ");
      i++;
    }
    stringSegments.push({ offset: segStart, text: source.slice(segStart, i) });
  };

  while (i < len) {
    const ch = source[i]!;
    if (ch === "/" && source[i + 1] === "/") {
      const start = i;
      i += 2;
      while (i < len && source[i] !== "\n" && source[i] !== "\r") i++;
      pushBlank(source.slice(start, i));
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
      if (i < len) i += 2;
      pushBlank(source.slice(start, i));
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out.push(" ");
      i++;
      const segStart = i;
      while (i < len) {
        const c = source[i]!;
        if (c === "\\" && i + 1 < len) {
          pushBlank(source.slice(i, i + 2));
          i += 2;
          continue;
        }
        if (c === quote) {
          stringSegments.push({ offset: segStart, text: source.slice(segStart, i) });
          out.push(" ");
          i++;
          break;
        }
        out.push(c === "\n" || c === "\r" ? c : " ");
        i++;
      }
      continue;
    }
    if (ch === "`") {
      out.push(" ");
      i++;
      scanTemplateChunk();
      continue;
    }
    if (ch === "/" && canStartRegexLiteral(source, i)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < len && source[j] !== "\n" && source[j] !== "\r") {
        const c = source[j]!;
        if (c === "\\" && j + 1 < len) {
          j += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (closed) {
        pushBlank(source.slice(i, j));
        i = j;
        continue;
      }
    }
    if (templateBraceDepths.length > 0) {
      if (ch === "{") {
        templateBraceDepths[templateBraceDepths.length - 1]!++;
      } else if (ch === "}") {
        const top = templateBraceDepths[templateBraceDepths.length - 1]!;
        if (top === 0) {
          templateBraceDepths.pop();
          out.push("}");
          i++;
          scanTemplateChunk();
          continue;
        }
        templateBraceDepths[templateBraceDepths.length - 1] = top - 1;
      }
    }
    out.push(ch);
    i++;
  }

  return { codeOnly: out.join(""), stringSegments };
}

/**
 * Simple lexical/regex check blocking direct business API calls (`fetch`, `XMLHttpRequest`, `EventSource`,
 * `WebSocket`, and hardcoded `"/api/"` string/template paths) in panel and author-registered component scripts.
 */
export function checkAuthoringDirectApiCalls(source: string, file: string): SdkAuthoringViolation[] {
  const violations: SdkAuthoringViolation[] = [];
  const { codeOnly, stringSegments } = scanScriptLexemes(source);

  for (const match of codeOnly.matchAll(DIRECT_API_IDENTIFIERS)) {
    const found = match[0];
    violations.push(makeViolation(
      source,
      file,
      match.index!,
      "forbidden-direct-api",
      found,
      DIRECT_API_GUIDANCE,
      `Do not call '${found}' directly to request business APIs; read business data through a declared projection or invoke a registered operation instead`,
    ));
  }

  for (const segment of stringSegments) {
    for (const match of segment.text.matchAll(DIRECT_API_PATH_PATTERN)) {
      const found = match[0];
      violations.push(makeViolation(
        source,
        file,
        segment.offset + match.index!,
        "forbidden-direct-api",
        found,
        DIRECT_API_GUIDANCE,
        `Do not hardcode business API path '${found}'; read business data through a declared projection or invoke a registered operation instead`,
      ));
    }
  }

  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Check JS/TS script source for forbidden third-party imports, renamed SDK exports, and direct API calls. */
export async function checkAuthoringScript(
  source: string,
  file: string,
  options: CheckAuthoringScriptOptions = {},
): Promise<SdkAuthoringViolation[]> {
  const isPanel = options.target === "panel";
  const violations: SdkAuthoringViolation[] = [];
  const { imports } = await readModuleFacts(source, file);
  for (const entry of imports) {
    const { specifier, start, importStart, importEnd } = entry;
    if (specifier === "element-plus" || specifier?.startsWith("element-plus/")) {
      const statement = source.slice(importStart, importEnd);
      const namedBlock = /\{([^}]*)\}/u.exec(statement)?.[1];
      const mappedNames: string[] = [];
      if (namedBlock) {
        for (const raw of namedBlock.split(",").map(s => s.trim().split(/\s+as\s+/u)[0]?.trim()).filter(Boolean)) {
          if (raw === "ElMessageBox") {
            mappedNames.push(isPanel
              ? `ElMessageBox -> SdkMessageBox from "${panelModuleSpecifiers.sdk}"`
              : `ElMessageBox -> SdkMessageBox`);
            continue;
          }
          const comp = sdkUiComponentByImplExport(raw!);
          if (comp) {
            mappedNames.push(isPanel ? `${raw} -> <${comp.sdkTag}> in panel.html` : `${raw} -> ${comp.sdkExport}`);
            continue;
          }
          const forbidden = sdkUiForbiddenByImplExport(raw!);
          if (forbidden) {
            mappedNames.push(`${raw} -> ${forbidden.replacement}`);
            continue;
          }
        }
      }
      const replacement = isPanel
        ? (mappedNames.length
            ? mappedNames.join("; ")
            : `<sdk-*> tags in panel.html or ${panelModuleSpecifiers.sdk}`)
        : (mappedNames.length
            ? `import from "${SDK_UI_ENTRY_SPECIFIER}" (${mappedNames.join("; ")})`
            : SDK_UI_ENTRY_SPECIFIER);
      violations.push(makeViolation(
        source, file, start, "forbidden-import", specifier, replacement,
        `Do not import '${specifier}'; use '${replacement}'`,
      ));
    } else if (specifier === "echarts" || specifier?.startsWith("echarts/")) {
      const replacement = isPanel
        ? "<e-chart> in panel.html or the MetricChart projection component"
        : "@ontomato/sdk/chart";
      violations.push(makeViolation(
        source, file, start, "forbidden-import", specifier, replacement,
        `Do not import '${specifier}'; use '${replacement}'`,
      ));
    }
  }

  for (const renamed of SDK_RENAMED_EXPORTS) {
    const pattern = new RegExp(`\\b${renamed.implExport}\\b`, "gu");
    for (const match of source.matchAll(pattern)) {
      violations.push(makeViolation(
        source, file, match.index!, "forbidden-export", renamed.implExport, renamed.sdkExport,
        `Replace renamed SDK export '${renamed.implExport}' with '${renamed.sdkExport}' from '${renamed.module}'`,
      ));
    }
  }

  violations.push(...checkAuthoringDirectApiCalls(source, file));

  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}
