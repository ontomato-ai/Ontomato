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

export type PanelModuleSpecifier = typeof panelModuleSpecifiers[keyof typeof panelModuleSpecifiers];

/**
 * The official module entries that component packages and author-registered components may import.
 * Excludes `element-plus` and any `element-plus/*` subpath; UI primitives come from `@ontomato/sdk/ui`.
 */
export const componentOfficialSpecifiers = [
  "vue",
  "echarts",
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
  | "forbidden-export"
  | "forbidden-viewport-unit"
  | "forbidden-hardcoded-color"
  | "forbidden-hardcoded-font-size"
  | "forbidden-pane-column-width"
  | "forbidden-panel-overlay"
  | "forbidden-panel-data-display";

export interface SdkAuthoringViolation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly kind: SdkAuthoringViolationKind;
  readonly found: string;
  readonly replacement: string | null;
  readonly message: string;
}

/**
 * Single switch controlling whether panel authoring CSS checks reject viewport-relative length
 * units (`vh`, `vw`, `vmin`, `vmax`, `vi`, `vb`, and their `s`/`l`/`d` variants).
 *
 * Kept `false` while existing built-in panels finish migrating off viewport height formulas and
 * inline modal cards to normal content-box CSS and `<sdk-dialog>` / `<sdk-drawer>`. Flip this
 * constant to `true` to enforce the rule globally across `panel check`, built-in checks, and CI.
 */
export const REJECT_VIEWPORT_UNITS = false;

/**
 * Single switch controlling whether panel authoring checks reject unified page-paradigm
 * violations: hardcoded colors, hardcoded font sizes, handwritten pane column widths, panel-authored
 * dialogs/drawers, and SDK data-display primitives in panel templates.
 *
 * Kept `false` while existing built-in panels migrate to the unified page paradigm. Pass
 * `{ strictParadigm: true }` (or `--strict-paradigm` in `panel check`) to enforce both viewport-unit
 * and paradigm rules immediately, or flip this constant to `true` once migration completes.
 */
export const REJECT_PARADIGM_VIOLATIONS = false;

export interface CheckAuthoringStylesOptions {
  readonly rejectViewportUnits?: boolean;
  readonly rejectParadigmViolations?: boolean;
  readonly strictParadigm?: boolean;
}

export interface CheckAuthoringTemplateOptions extends CheckAuthoringStylesOptions {
  readonly allowedSdkTags?: ReadonlySet<string>;
}

const CSS_VIEWPORT_UNIT_PATTERN =
  /(?<![A-Za-z0-9_.#\\-])([+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?(?:[sld]?v(?:min|max|[whib])))(?![A-Za-z0-9_-])/giu;

const CSS_HEX_COLOR_PATTERN =
  /(?<![A-Za-z0-9_-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![A-Za-z0-9_-])/gu;

const CSS_COLOR_FUNCTION_START = /(?<![A-Za-z0-9_-])(?:rgba?|hsla?)\s*\(/giu;

const CSS_FONT_SIZE_LITERAL_PATTERN =
  /(?<![A-Za-z0-9_-])([+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:px|rem|em|pt|pc|ch|ex|cap|ic|lh|rlh|cm|mm|in|q|%|[sld]?v(?:min|max|[whib])|cq[whib]|cqmin|cqmax))(?![A-Za-z0-9_-])/giu;

const CSS_HARDCODED_PX_OR_REM_PATTERN =
  /(?<![A-Za-z0-9_-])([0-9]+(?:\.[0-9]+)?|\.[0-9]+)(px|rem)(?![A-Za-z0-9_-])/giu;

const CSS_FR_PATTERN = /(?<![A-Za-z0-9_-])([0-9]+(?:\.[0-9]+)?|\.[0-9]+)fr(?![A-Za-z0-9_-])/giu;

const CSS_PROPERTY_NAME_PATTERN = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9_-]*)$/u;

const PANE_SELECTOR_PATTERN =
  /(?:^|[^a-z])(?:aside|sidebar|side|pane|split|rail|explorer|inspector|left|right|drawer|columns?)(?:$|[^a-z])/iu;

const PANE_MIN_PX = 192;
const PANE_MIN_REM = 12;

const VIEWPORT_UNIT_REPLACEMENT =
  "fill the parent content box with normal CSS and a rem/px min-height, or use <sdk-dialog>/<sdk-drawer> for overlays";

const HARDCODED_COLOR_REPLACEMENT =
  "var(--sdk-text-color-primary) / var(--sdk-bg-color) / var(--ui-divider)";

const HARDCODED_FONT_SIZE_REPLACEMENT =
  "var(--text-xs) / var(--text-sm) / var(--text-base) / var(--text-lg)";

const PANE_COLUMN_WIDTH_REPLACEMENT =
  "<two-pane-layout> / <workbench-layout>";

const PANEL_OVERLAY_REPLACEMENT =
  "TwoPaneLayout / WorkbenchLayout detail pane, ObjectList row expansion (listRowDetail), or OperationButton parameter dialog";

const PANEL_DATA_DISPLAY_REPLACEMENT =
  "ObjectList / ObjectSummary / ObjectTree via <projection>, or plain HTML";

const PANEL_FORBIDDEN_OVERLAY_TAGS = new Set(["sdk-dialog", "sdk-drawer", "el-dialog", "el-drawer"]);

const PANEL_FORBIDDEN_DATA_DISPLAY_TAGS = new Set([
  "sdk-table",
  "sdk-table-v2",
  "sdk-pagination",
  "sdk-descriptions",
  "sdk-tree",
  "sdk-tree-v2",
  "el-table",
  "el-table-v2",
  "el-pagination",
  "el-descriptions",
  "el-tree",
  "el-tree-v2",
]);

interface CssDeclaration {
  readonly selector: string;
  readonly property: string;
  readonly value: string;
  readonly valueOffset: number;
}

/**
 * Extract property declarations with exact value offsets from comment/string-stripped CSS.
 * Supports both full stylesheets (with selectors, `@media`/`@container` blocks, and CSS nesting)
 * and bare declaration lists from inline `style="..."` attributes.
 */
function parseCssDeclarations(stripped: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  const selectors: string[] = [];
  let parenDepth = 0;
  let stmtStart = 0;
  let colonPos = -1;

  const flushDeclaration = (end: number) => {
    if (colonPos === -1) return;
    const rawProp = stripped.slice(stmtStart, colonPos);
    const property = rawProp.trim();
    if (!CSS_PROPERTY_NAME_PATTERN.test(property)) return;
    const rawVal = stripped.slice(colonPos + 1, end);
    const leadVal = rawVal.length - rawVal.trimStart().length;
    const value = rawVal.trim();
    if (!value) return;
    declarations.push({
      selector: selectors.at(-1) ?? "",
      property: property.toLowerCase(),
      value,
      valueOffset: colonPos + 1 + leadVal,
    });
  };

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]!;
    if (ch === "(") {
      parenDepth++;
      continue;
    }
    if (ch === ")") {
      if (parenDepth > 0) parenDepth--;
      continue;
    }
    if (parenDepth > 0) continue;
    if (ch === ":" && colonPos === -1) {
      colonPos = i;
      continue;
    }
    if (ch === "{") {
      const prelude = stripped.slice(stmtStart, i).trim();
      selectors.push(prelude.startsWith("@") ? (selectors.at(-1) ?? "") : prelude);
      stmtStart = i + 1;
      colonPos = -1;
      continue;
    }
    if (ch === ";" || ch === "}") {
      flushDeclaration(i);
      if (ch === "}") selectors.pop();
      stmtStart = i + 1;
      colonPos = -1;
    }
  }
  if (stmtStart < stripped.length) flushDeclaration(stripped.length);
  return declarations;
}

/** Split a CSS value on top-level whitespace while keeping function calls intact. */
function splitCssTopLevelTokens(value: string): { readonly text: string; readonly offset: number }[] {
  const cleaned = value.replace(/\s*!important\s*$/iu, "");
  const tokens: { readonly text: string; readonly offset: number }[] = [];
  let depth = 0;
  let bracketDepth = 0;
  let start = -1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]" && bracketDepth > 0) bracketDepth--;
    const isSpace = depth === 0 && bracketDepth === 0 && /\s/u.test(ch);
    if (isSpace) {
      if (start !== -1) {
        tokens.push({ text: cleaned.slice(start, i), offset: start });
        start = -1;
      }
    } else if (start === -1) {
      start = i;
    }
  }
  if (start !== -1) tokens.push({ text: cleaned.slice(start), offset: start });
  return tokens;
}

/** Find balanced `rgb(...)`/`rgba(...)`/`hsl(...)`/`hsla(...)` calls with hardcoded channels. */
function findHardcodedColorFunctions(value: string): { readonly found: string; readonly offset: number }[] {
  const hits: { readonly found: string; readonly offset: number }[] = [];
  for (const match of value.matchAll(CSS_COLOR_FUNCTION_START)) {
    const start = match.index!;
    const openParen = start + match[0].length - 1;
    let depth = 1;
    let end = openParen + 1;
    while (end < value.length && depth > 0) {
      if (value[end] === "(") depth++;
      else if (value[end] === ")") depth--;
      end++;
    }
    if (depth !== 0) continue;
    const args = value.slice(openParen + 1, end - 1);
    // Allow variable-derived channel triplets such as `rgba(var(--sdk-color-primary-rgb), 0.12)`.
    if (/^\s*var\s*\(/iu.test(args)) continue;
    hits.push({ found: value.slice(start, end), offset: start });
  }
  return hits;
}

function hasPaneSizedHardcodedLength(value: string): boolean {
  for (const match of value.matchAll(CSS_HARDCODED_PX_OR_REM_PATTERN)) {
    const num = Number(match[1]);
    const unit = match[2]!.toLowerCase();
    if ((unit === "px" && num >= PANE_MIN_PX) || (unit === "rem" && num >= PANE_MIN_REM)) {
      return true;
    }
  }
  return false;
}

function isHandwrittenPaneGridColumns(value: string): boolean {
  const tracks = splitCssTopLevelTokens(value)
    .map(t => t.text)
    .filter(token => !token.startsWith("["));
  // Single-track layouts (including `1fr`, `minmax(0, 1fr)`, and `repeat(auto-fit, minmax(240px, 1fr))`)
  // are single columns or responsive form/card grids, not handwritten multi-pane splits.
  if (tracks.length < 2) return false;
  if (tracks.some(track => CSS_HARDCODED_PX_OR_REM_PATTERN.test(track))) {
    CSS_HARDCODED_PX_OR_REM_PATTERN.lastIndex = 0;
    return true;
  }
  CSS_HARDCODED_PX_OR_REM_PATTERN.lastIndex = 0;
  // Detect asymmetric fractional splits such as `minmax(0, 1.45fr) minmax(0, 1fr)` or `1fr 2fr`,
  // while allowing equal-width grids (`1fr 1fr`) and label-value pairs (`max-content 1fr`).
  const frWeights: number[] = [];
  for (const track of tracks) {
    for (const match of track.matchAll(CSS_FR_PATTERN)) {
      frWeights.push(Number(match[1]));
    }
  }
  return frWeights.length >= 2 && frWeights.some(weight => weight !== frWeights[0]);
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
 * Check a CSS block or stylesheet for third-party `--el-*` variables and (when enabled via
 * `REJECT_VIEWPORT_UNITS` / `REJECT_PARADIGM_VIOLATIONS` or `options.strictParadigm`) viewport
 * units, hardcoded colors, hardcoded font sizes, and handwritten pane column widths.
 */
export function checkAuthoringStyles(
  css: string,
  file: string,
  baseOffset = 0,
  fullSource = css,
  options: CheckAuthoringStylesOptions = {},
): SdkAuthoringViolation[] {
  const violations: SdkAuthoringViolation[] = [];
  const stripped = stripCssCommentsAndStrings(css);
  for (const match of stripped.matchAll(/--el-[a-z0-9-]+/gu)) {
    const found = match[0];
    const replacement = sdkThemeTokenReplacement(found);
    const message = replacement
      ? `Replace third-party theme variable '${found}' with '${replacement}'`
      : `Do not use third-party theme variable '${found}'; use a published --sdk-* or platform design token`;
    violations.push(makeViolation(fullSource, file, baseOffset + match.index!, "forbidden-token", found, replacement, message));
  }
  const rejectViewport = options.strictParadigm === true || (options.rejectViewportUnits ?? REJECT_VIEWPORT_UNITS);
  if (rejectViewport) {
    for (const match of stripped.matchAll(CSS_VIEWPORT_UNIT_PATTERN)) {
      const found = match[0];
      const message = `Do not use viewport unit '${found}'; ${VIEWPORT_UNIT_REPLACEMENT}`;
      violations.push(makeViolation(
        fullSource, file, baseOffset + match.index!, "forbidden-viewport-unit", found, VIEWPORT_UNIT_REPLACEMENT, message,
      ));
    }
  }
  const rejectParadigm = options.strictParadigm === true || (options.rejectParadigmViolations ?? REJECT_PARADIGM_VIOLATIONS);
  if (rejectParadigm) {
    for (const decl of parseCssDeclarations(stripped)) {
      // Rule A1: Reject hardcoded hex and rgb/rgba/hsl/hsla colors in declaration values.
      for (const match of decl.value.matchAll(CSS_HEX_COLOR_PATTERN)) {
        const found = match[0];
        violations.push(makeViolation(
          fullSource,
          file,
          baseOffset + decl.valueOffset + match.index!,
          "forbidden-hardcoded-color",
          found,
          HARDCODED_COLOR_REPLACEMENT,
          `Do not hardcode color '${found}'; use a platform theme variable such as var(--sdk-text-color-primary), var(--sdk-bg-color), or var(--ui-divider)`,
        ));
      }
      for (const hit of findHardcodedColorFunctions(decl.value)) {
        violations.push(makeViolation(
          fullSource,
          file,
          baseOffset + decl.valueOffset + hit.offset,
          "forbidden-hardcoded-color",
          hit.found,
          HARDCODED_COLOR_REPLACEMENT,
          `Do not hardcode color '${hit.found}'; use a platform theme variable such as var(--sdk-text-color-primary), var(--sdk-bg-color), or var(--ui-divider)`,
        ));
      }

      // Rule A2: Reject hardcoded literal font-size values (and explicit sizes in `font` shorthand).
      if (decl.property === "font-size" || decl.property === "font") {
        const scanValue = decl.property === "font"
          ? decl.value.replace(/\/\s*(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)[a-z%]*/giu, match => " ".repeat(match.length))
          : decl.value;
        for (const match of scanValue.matchAll(CSS_FONT_SIZE_LITERAL_PATTERN)) {
          const found = match[1]!;
          violations.push(makeViolation(
            fullSource,
            file,
            baseOffset + decl.valueOffset + match.index!,
            "forbidden-hardcoded-font-size",
            found,
            HARDCODED_FONT_SIZE_REPLACEMENT,
            `Do not hardcode font-size '${found}'; use typography tokens var(--text-xs), var(--text-sm), var(--text-base), or var(--text-lg)`,
          ));
        }
      }

      // Rule A3: Reject handwritten pane column widths.
      if (decl.property === "grid-template-columns" && isHandwrittenPaneGridColumns(decl.value)) {
        const cleaned = decl.value.replace(/\s*!important\s*$/iu, "");
        violations.push(makeViolation(
          fullSource,
          file,
          baseOffset + decl.valueOffset,
          "forbidden-pane-column-width",
          cleaned,
          PANE_COLUMN_WIDTH_REPLACEMENT,
          `Do not hardcode pane column width '${cleaned}' in 'grid-template-columns'; use <two-pane-layout> or <workbench-layout> instead`,
        ));
      } else if (decl.property === "flex-basis" && hasPaneSizedHardcodedLength(decl.value)) {
        const cleaned = decl.value.replace(/\s*!important\s*$/iu, "");
        violations.push(makeViolation(
          fullSource,
          file,
          baseOffset + decl.valueOffset,
          "forbidden-pane-column-width",
          cleaned,
          PANE_COLUMN_WIDTH_REPLACEMENT,
          `Do not hardcode pane column width '${cleaned}' in 'flex-basis'; use <two-pane-layout> or <workbench-layout> instead`,
        ));
      } else if (decl.property === "flex") {
        const tokens = splitCssTopLevelTokens(decl.value);
        const isFixedGrow = tokens[0]?.text === "0";
        const isPaneSelector = PANE_SELECTOR_PATTERN.test(decl.selector);
        if (isFixedGrow || isPaneSelector) {
          for (const token of tokens) {
            if (!hasPaneSizedHardcodedLength(token.text)) continue;
            violations.push(makeViolation(
              fullSource,
              file,
              baseOffset + decl.valueOffset + token.offset,
              "forbidden-pane-column-width",
              token.text,
              PANE_COLUMN_WIDTH_REPLACEMENT,
              `Do not hardcode pane column width '${token.text}' in 'flex'; use <two-pane-layout> or <workbench-layout> instead`,
            ));
          }
        }
      } else if (
        (decl.property === "width" || decl.property === "inline-size")
        && PANE_SELECTOR_PATTERN.test(decl.selector)
        && hasPaneSizedHardcodedLength(decl.value)
      ) {
        const cleaned = decl.value.replace(/\s*!important\s*$/iu, "");
        violations.push(makeViolation(
          fullSource,
          file,
          baseOffset + decl.valueOffset,
          "forbidden-pane-column-width",
          cleaned,
          PANE_COLUMN_WIDTH_REPLACEMENT,
          `Do not hardcode pane column width '${cleaned}' in '${decl.property}'; use <two-pane-layout> or <workbench-layout> instead`,
        ));
      }
    }
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

/** Check an HTML or Vue template (including inline `<style>` blocks and `style` attributes) for forbidden authoring patterns. */
export function checkAuthoringTemplate(
  template: string,
  file: string,
  options: CheckAuthoringTemplateOptions = {},
): SdkAuthoringViolation[] {
  const violations: SdkAuthoringViolation[] = [];
  const rejectParadigm = options.strictParadigm === true || (options.rejectParadigmViolations ?? REJECT_PARADIGM_VIOLATIONS);
  const styleOptions: CheckAuthoringStylesOptions = {
    ...(options.rejectViewportUnits !== undefined && { rejectViewportUnits: options.rejectViewportUnits }),
    ...(options.rejectParadigmViolations !== undefined && { rejectParadigmViolations: options.rejectParadigmViolations }),
    ...(options.strictParadigm !== undefined && { strictParadigm: options.strictParadigm }),
  };
  // Preserve offsets by blanking comments and script bodies while scanning <style> bodies separately.
  let sanitized = template.replace(/<!--[\s\S]*?-->/gu, match => match.replace(/[^\r\n]/gu, " "));
  sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, match => match.replace(/[^\r\n]/gu, " "));
  sanitized = sanitized.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/giu, (full, body: string, offset: number) => {
    const bodyOffset = offset + full.indexOf(body);
    violations.push(...checkAuthoringStyles(body, file, bodyOffset, template, styleOptions));
    return full.replace(/[^\r\n]/gu, " ");
  });

  // Check static inline `style="..."` / `style='...'` attributes inside opening tags.
  for (const tagMatch of sanitized.matchAll(/<[A-Za-z][^>]*>/gu)) {
    const tagText = tagMatch[0];
    const tagStart = tagMatch.index!;
    for (const attr of tagText.matchAll(/(?<=[\s/])style\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
      const value = attr[1] ?? attr[2] ?? "";
      const quoteOffset = attr[0].indexOf(attr[1] !== undefined ? '"' : "'") + 1;
      violations.push(
        ...checkAuthoringStyles(value, file, tagStart + attr.index! + quoteOffset, template, styleOptions),
      );
    }
  }

  const checkParadigmTag = (raw: string, kebab: string, offset: number): boolean => {
    if (!rejectParadigm) return false;
    if (PANEL_FORBIDDEN_OVERLAY_TAGS.has(kebab)) {
      violations.push(makeViolation(
        template,
        file,
        offset,
        "forbidden-panel-overlay",
        raw,
        PANEL_OVERLAY_REPLACEMENT,
        `Do not author dialog or drawer <${raw}> in a panel; place create/edit/detail in the detail pane of TwoPaneLayout or WorkbenchLayout, use ObjectList row expansion (listRowDetail) for child objects, and let OperationButton open parameter dialogs for parameterized one-off actions`,
      ));
      return true;
    }
    if (PANEL_FORBIDDEN_DATA_DISPLAY_TAGS.has(kebab)) {
      violations.push(makeViolation(
        template,
        file,
        offset,
        "forbidden-panel-data-display",
        raw,
        PANEL_DATA_DISPLAY_REPLACEMENT,
        `Do not render business data with <${raw}> in a panel; use official data components ObjectList, ObjectSummary, or ObjectTree via <projection>, or plain HTML for static content`,
      ));
      return true;
    }
    return false;
  };

  // 1. Check opening tags for <el-*>, <El*>, unknown <sdk-*>, paradigm rules, and renamed exports like <g6-graph-canvas>.
  for (const match of sanitized.matchAll(/<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/gu)) {
    const rawTag = match[1]!;
    const offset = match.index! + 1;
    const kebab = toKebabCase(rawTag);

    if (checkParadigmTag(rawTag, kebab, offset)) continue;

    if (kebab.startsWith("el-")) {
      const mapped = sdkUiComponentByImplTag(kebab);
      if (mapped) {
        violations.push(makeViolation(
          template, file, offset, "forbidden-tag", rawTag, `<${mapped.sdkTag}>`,
          `Replace third-party tag <${rawTag}> with <${mapped.sdkTag}>`,
        ));
      } else {
        const forbidden = sdkUiForbiddenByImplTag(kebab);
        violations.push(makeViolation(
          template, file, offset, "forbidden-tag", rawTag, forbidden?.replacement ?? null,
          forbidden
            ? `Tag <${rawTag}> is not exposed by the SDK: ${forbidden.replacement}`
            : `Do not use third-party tag <${rawTag}>; use a published <sdk-*> component`,
        ));
      }
      continue;
    }

    if (kebab.startsWith("sdk-")) {
      const allowed = options.allowedSdkTags ? options.allowedSdkTags.has(kebab) : sdkUiComponentByTag(kebab) !== undefined;
      if (!allowed) {
        const forbidden = sdkUiForbiddenByImplTag(`el-${kebab.slice(4)}`);
        violations.push(makeViolation(
          template, file, offset, "unknown-sdk-tag", rawTag, forbidden?.replacement ?? null,
          forbidden
            ? `Tag <${rawTag}> is not part of the SDK UI list: ${forbidden.replacement}`
            : `Unknown SDK UI tag <${rawTag}>; choose a tag from the SDK UI catalogue`,
        ));
      }
      continue;
    }

    const renamed = sdkRenamedExportByImpl(rawTag) ?? sdkRenamedExportByImpl(kebab);
    if (renamed) {
      violations.push(makeViolation(
        template, file, offset, "forbidden-export", rawTag, `<${renamed.sdkTag}>`,
        `Replace renamed component tag <${rawTag}> with <${renamed.sdkTag}>`,
      ));
    }
  }

  // 2. Check dynamic component `is="el-..."` / `:is="'el-...'"` / `is="sdk-dialog"` / `is="g6-graph-canvas"`.
  for (const match of sanitized.matchAll(/\b(?::|v-bind:)?is\s*=\s*(?:"([^"]*)"|'([^']*)')/giu)) {
    const raw = (match[1] ?? match[2] ?? "").trim().replace(/^['"]|['"]$/gu, "");
    const kebab = toKebabCase(raw);
    const offset = match.index!;
    if (checkParadigmTag(raw, kebab, offset)) continue;
    if (kebab.startsWith("el-")) {
      const mapped = sdkUiComponentByImplTag(kebab);
      const forbidden = mapped ? undefined : sdkUiForbiddenByImplTag(kebab);
      violations.push(makeViolation(
        template, file, offset, "forbidden-tag", raw, mapped ? mapped.sdkTag : (forbidden?.replacement ?? null),
        mapped
          ? `Replace third-party component '${raw}' with '${mapped.sdkTag}'`
          : `Do not reference third-party component '${raw}'${forbidden ? `: ${forbidden.replacement}` : ""}`,
      ));
    } else {
      const renamed = sdkRenamedExportByImpl(raw) ?? sdkRenamedExportByImpl(kebab);
      if (renamed) {
        violations.push(makeViolation(
          template, file, offset, "forbidden-export", raw, renamed.sdkTag,
          `Replace renamed component '${raw}' with '${renamed.sdkTag}'`,
        ));
      }
    }
  }

  // 3. Check forbidden third-party directives (v-loading, v-infinite-scroll, v-popover) inside element tags.
  for (const tagMatch of sanitized.matchAll(/<[A-Za-z][^>]*>/gu)) {
    const tagText = tagMatch[0];
    const tagStart = tagMatch.index!;
    for (const attr of tagText.matchAll(/(?<=[\s/])(v-[a-z][a-z0-9-]*)(?=[\s.:=/>]|$)/giu)) {
      const name = attr[1]!.toLowerCase();
      const mapped = sdkUiDirectiveByImplName(name);
      if (!mapped) continue;
      violations.push(makeViolation(
        template, file, tagStart + attr.index!, "forbidden-directive", attr[1]!, mapped.sdkName,
        `Replace directive '${attr[1]!}' with '${mapped.sdkName}'`,
      ));
    }
  }

  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Check JS/TS script source for forbidden `element-plus` imports and renamed SDK exports. */
export async function checkAuthoringScript(source: string, file: string): Promise<SdkAuthoringViolation[]> {
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
          const comp = sdkUiComponentByImplExport(raw!);
          if (comp) {
            mappedNames.push(`${raw} -> ${comp.sdkExport}`);
            continue;
          }
          const forbidden = sdkUiForbiddenByImplExport(raw!);
          if (forbidden) {
            mappedNames.push(`${raw} -> ${forbidden.replacement}`);
            continue;
          }
        }
      }
      const replacement = mappedNames.length
        ? `import from "${SDK_UI_ENTRY_SPECIFIER}" (${mappedNames.join("; ")})`
        : SDK_UI_ENTRY_SPECIFIER;
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

  return violations.sort((a, b) => a.line - b.line || a.column - b.column);
}
