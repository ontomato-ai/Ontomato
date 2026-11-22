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
  | "forbidden-viewport-unit";

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

export interface CheckAuthoringStylesOptions {
  readonly rejectViewportUnits?: boolean;
}

export interface CheckAuthoringTemplateOptions extends CheckAuthoringStylesOptions {
  readonly allowedSdkTags?: ReadonlySet<string>;
}

const CSS_VIEWPORT_UNIT_PATTERN =
  /(?<![A-Za-z0-9_.#\\-])([+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?(?:[sld]?v(?:min|max|[whib])))(?![A-Za-z0-9_-])/giu;

const VIEWPORT_UNIT_REPLACEMENT =
  "fill the parent content box with normal CSS and a rem/px min-height, or use <sdk-dialog>/<sdk-drawer> for overlays";

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
  readonly tagEnd: number;
  readonly tagText: string;
}

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
      let j = i + 2;
      while (j < len && /[A-Za-z0-9-]/u.test(sanitized[j]!)) j++;
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
    while (nameEnd < len && /[A-Za-z0-9-]/u.test(sanitized[nameEnd]!)) nameEnd++;
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
    tags.push({ tagName, nameOffset, tagStart, tagEnd, tagText });
    i = tagEnd;
  }
  return tags;
}

/** Parse attributes of a single opening tag `<Name ...>` with exact offsets relative to `tagText`. */
function readTagAttributes(tagText: string): TemplateAttribute[] {
  const attrs: TemplateAttribute[] = [];
  const len = tagText.length;
  let i = 1;
  while (i < len && /[A-Za-z0-9-]/u.test(tagText[i]!)) i++;
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
 * `REJECT_VIEWPORT_UNITS` or `options.rejectViewportUnits`) viewport length units.
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
  const rejectViewport = options.rejectViewportUnits ?? REJECT_VIEWPORT_UNITS;
  if (rejectViewport) {
    for (const match of stripped.matchAll(CSS_VIEWPORT_UNIT_PATTERN)) {
      const found = match[0];
      const message = `Do not use viewport unit '${found}'; ${VIEWPORT_UNIT_REPLACEMENT}`;
      violations.push(makeViolation(
        fullSource, file, baseOffset + match.index!, "forbidden-viewport-unit", found, VIEWPORT_UNIT_REPLACEMENT, message,
      ));
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
  const styleOptions: CheckAuthoringStylesOptions = {
    ...(options.rejectViewportUnits !== undefined && { rejectViewportUnits: options.rejectViewportUnits }),
  };
  // Preserve offsets by blanking comments and script bodies while scanning <style> bodies separately.
  let sanitized = template.replace(/<!--[\s\S]*?-->/gu, match => match.replace(/[^\r\n]/gu, " "));
  sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, match => match.replace(/[^\r\n]/gu, " "));
  sanitized = sanitized.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/giu, (full, body: string, offset: number) => {
    const bodyOffset = offset + full.indexOf(body);
    violations.push(...checkAuthoringStyles(body, file, bodyOffset, template, styleOptions));
    return full.replace(/[^\r\n]/gu, " ");
  });

  const openingTags = scanTemplateOpeningTags(sanitized);

  for (const tag of openingTags) {
    const attrs = readTagAttributes(tag.tagText);
    const rawTag = tag.tagName;
    const kebab = toKebabCase(rawTag);

    // 1. Check static inline `style="..."` / `style='...'` attributes.
    for (const attr of attrs) {
      if (attr.name.toLowerCase() === "style" && attr.value !== undefined && attr.valueOffset !== undefined) {
        violations.push(
          ...checkAuthoringStyles(attr.value, file, tag.tagStart + attr.valueOffset, template, styleOptions),
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
