import type { BrandMode, BrandSource } from "./index";
import { brandProperties } from "./index";

/*
 * Themes of applications, panels and panel members: the public design variables, the one shape their overrides take,
 * the check at the boundary, the merge of the layers and their conversion to CSS custom properties.
 *
 * Layers, each overriding only its own scope: platform default (the declared defaults below, foundation.css) → the
 * deployment's brand (its BrandSource, installed by `installBrandTheme`) → the application's theme → the placed panel →
 * the member. A layer is `{light?, dark?}`, each a sparse map of variable name to value; a name it does not set is
 * inherited from the layer around it through CSS. On a page the layers sit on nested elements, so CSS inheritance does
 * the merge; a popup or an isolated frame, which is outside that nesting, gets the merged values of the instance that
 * opened it.
 */

export type TokenType = "color" | "length" | "shadow";

/** The public shadow levels; an override names a level, the platform maps it to the matching `--elevation-*`. */
export const SHADOW_LEVELS = ["flat", "panel", "overlay", "modal"] as const;
export type ShadowLevel = (typeof SHADOW_LEVELS)[number];

/** Variable name → value, for one mode. */
export type TokenValues = Readonly<Record<string, string>>;

/** One theme layer (application, panel or member). */
export interface ThemeOverrides {
  light?: TokenValues;
  dark?: TokenValues;
}

/**
 * A declared default: a value of the variable's type, or the name of a platform variable of the same type, which the
 * variable then follows. Colours may give one value per mode.
 */
export type TokenDefault = string | { light: string; dark: string };

/** One declared variable, as `tokens.json` of the SDK and the `tokens` file of a component package list it. */
export interface TokenDeclaration {
  name: string;
  type: TokenType;
  default: TokenDefault;
  /** The components that read it; platform variables are read by every component and carry none. */
  components?: readonly string[];
}

/** A rejected theme or declaration: `path` points at the offending entry, e.g. `dark.--el-color-primary`. */
export class ThemeError extends Error {
  constructor(
    readonly path: string,
    reason: string
  ) {
    super(`${path}: ${reason}`);
    this.name = "ThemeError";
  }
}

// The first public list (design "设计变量的公开清单"). Names, types and purposes are a promise to panel authors;
// colour values come from the brand, the length values are the ones foundation.css declares.
const COLORS = [
  "--el-color-primary",
  "--on-primary",
  "--brand-link",
  "--el-text-color-primary",
  "--el-text-color-regular",
  "--el-text-color-secondary",
  "--el-bg-color",
  "--el-bg-color-page",
  "--el-bg-color-overlay",
  "--el-border-color",
  "--el-color-success",
  "--el-color-warning",
  "--el-color-danger",
  "--el-color-info",
];

const LENGTHS: Readonly<Record<string, string>> = {
  "--text-xs": "12px",
  "--text-sm": "13px",
  "--text-base": "14px",
  "--text-lg": "16px",
  "--text-xl": "20px",
  "--leading-xs": "16px",
  "--leading-sm": "20px",
  "--leading-base": "22px",
  "--leading-lg": "24px",
  "--leading-xl": "28px",
  "--radius-xs": "4px",
  "--radius-sm": "6px",
  "--radius-md": "8px",
  "--radius-lg": "12px",
  "--radius-full": "9999px",
  "--spacing-sm": "8px",
  "--spacing-md": "12px",
  "--spacing-lg": "16px",
  "--control-height-sm": "28px",
  "--control-height": "32px",
  "--control-height-lg": "40px",
};

const PLATFORM_TYPES: Readonly<Record<string, TokenType>> = {
  ...Object.fromEntries(COLORS.map((name) => [name, "color"])),
  ...Object.fromEntries(Object.keys(LENGTHS).map((name) => [name, "length"])),
  ...Object.fromEntries(SHADOW_LEVELS.map((level) => [`--shadow-${level}`, "shadow"])),
};

/** The platform's public variables with their defaults, the colours taken from the edition's brand. */
export function platformTokens(brand: BrandSource): TokenDeclaration[] {
  const light = brandProperties(brand, "light");
  const dark = brandProperties(brand, "dark");
  return [
    ...COLORS.map((name): TokenDeclaration => ({ name, type: "color", default: { light: light[name], dark: dark[name] } })),
    ...Object.entries(LENGTHS).map(([name, value]): TokenDeclaration => ({ name, type: "length", default: value })),
    ...SHADOW_LEVELS.map((level): TokenDeclaration => ({ name: `--shadow-${level}`, type: "shadow", default: level })),
  ];
}

const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const ALPHA = `${NUMBER}%?`;
const CHANNEL = `${NUMBER}%?`;
const HUE = `${NUMBER}(?:deg)?`;
const COLOR_FORMS = [
  "#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})",
  "transparent",
  String.raw`rgba?\(\s*${CHANNEL}\s*,\s*${CHANNEL}\s*,\s*${CHANNEL}\s*(?:,\s*${ALPHA}\s*)?\)`,
  String.raw`rgba?\(\s*${CHANNEL}\s+${CHANNEL}\s+${CHANNEL}\s*(?:\/\s*${ALPHA}\s*)?\)`,
  String.raw`hsla?\(\s*${HUE}\s*,\s*${NUMBER}%\s*,\s*${NUMBER}%\s*(?:,\s*${ALPHA}\s*)?\)`,
  String.raw`hsla?\(\s*${HUE}\s+${NUMBER}%\s+${NUMBER}%\s*(?:\/\s*${ALPHA}\s*)?\)`,
];
const COLOR = new RegExp(`^(?:${COLOR_FORMS.map((form) => `(?:${form})`).join("|")})$`, "i");
const LENGTH = new RegExp(`^(?:0|${NUMBER}(?:px|rem|em|%|vh|vw))$`);

/** Literal values only: no url(), var(), calc() or any other CSS gets through, because nothing but these forms does. */
function literalReason(type: TokenType, value: string): string | null {
  if (type === "color") return COLOR.test(value) ? null : "not a colour literal (#hex, rgb(), hsl() or transparent)";
  if (type === "length") return LENGTH.test(value) ? null : "not a non-negative length in px, rem, em, %, vh or vw";
  return (SHADOW_LEVELS as readonly string[]).includes(value) ? null : `not a shadow level (${SHADOW_LEVELS.join(", ")})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new ThemeError(path ? `${path}.${key}` : key, "unknown field");
}

/**
 * The check at the boundary for a theme layer from outside (an application's theme, a panel's or a member's
 * overrides): every name must be a platform variable or one the given installed packages declare, and every value a
 * literal of its type. Throws a ThemeError at the first offending entry.
 */
export function validateTheme(input: unknown, packageTokens: readonly TokenDeclaration[] = []): ThemeOverrides {
  const types: Record<string, TokenType> = { ...PLATFORM_TYPES };
  for (const token of packageTokens) types[token.name] = token.type;
  if (!isRecord(input)) throw new ThemeError("theme", "not an object");
  onlyKeys(input, ["light", "dark"], "");
  for (const mode of ["light", "dark"] as const) {
    const values = input[mode];
    if (values === undefined) continue;
    if (!isRecord(values)) throw new ThemeError(mode, "not an object");
    for (const [name, value] of Object.entries(values)) {
      const path = `${mode}.${name}`;
      const type = types[name];
      if (!type) throw new ThemeError(path, "not a declared design variable");
      if (typeof value !== "string") throw new ThemeError(path, "not a string");
      const reason = literalReason(type, value);
      if (reason) throw new ThemeError(path, reason);
    }
  }
  return input as ThemeOverrides;
}

const NAME = /^--[a-z0-9]+(?:-[a-z0-9]+)*$/;

function defaultReason(type: TokenType, value: unknown): string | null {
  if (typeof value !== "string") return "not a string";
  if (value.startsWith("--")) return PLATFORM_TYPES[value] === type ? null : `not a platform ${type} variable`;
  return literalReason(type, value);
}

/**
 * The check of a package's `tokens` declaration (`{tokens: [...]}`, JSON): every name starts with `--<prefix>-` and is
 * not a platform name, the type is known, the components are listed, and the default is a literal of the type or a
 * platform variable of the same type. The official components use the prefix `sdk`. Throws a ThemeError at the first
 * offending entry and returns the declarations otherwise.
 */
export function validateTokenDeclaration(input: unknown, prefix: string): TokenDeclaration[] {
  if (!isRecord(input)) throw new ThemeError("tokens", "not an object");
  onlyKeys(input, ["tokens"], "");
  if (!Array.isArray(input.tokens)) throw new ThemeError("tokens", "not an array");
  const names = new Set<string>();
  input.tokens.forEach((token: unknown, index) => {
    const path = `tokens[${index}]`;
    if (!isRecord(token)) throw new ThemeError(path, "not an object");
    onlyKeys(token, ["name", "type", "components", "default"], path);
    const { name, type, components } = token;
    if (typeof name !== "string" || !NAME.test(name) || !name.startsWith(`--${prefix}-`))
      throw new ThemeError(`${path}.name`, `not a variable name starting with --${prefix}-`);
    if (PLATFORM_TYPES[name] || names.has(name)) throw new ThemeError(`${path}.name`, `${name} is already declared`);
    names.add(name);
    if (type !== "color" && type !== "length" && type !== "shadow") throw new ThemeError(`${path}.type`, "not color, length or shadow");
    if (!Array.isArray(components) || components.length === 0 || !components.every((c) => typeof c === "string" && c.length > 0))
      throw new ThemeError(`${path}.components`, "not a non-empty list of component names");
    const value = token.default;
    if (isRecord(value)) {
      onlyKeys(value, ["light", "dark"], `${path}.default`);
      for (const mode of ["light", "dark"] as const) {
        const reason = defaultReason(type, value[mode]);
        if (reason) throw new ThemeError(`${path}.default.${mode}`, reason);
      }
    } else {
      const reason = defaultReason(type, value);
      if (reason) throw new ThemeError(`${path}.default`, reason);
    }
  });
  return input.tokens as TokenDeclaration[];
}

/**
 * `tokens.json` of an SDK release: the platform variables with the edition's brand colours as defaults, then the
 * official components' own variables (checked like any package's, under the prefix `sdk`).
 */
export function tokensManifest(brand: BrandSource, official: unknown) {
  return { shadows: SHADOW_LEVELS, tokens: [...platformTokens(brand), ...validateTokenDeclaration(official, "sdk")] };
}

/** Layers in order, the later winning per name; light and dark merge independently, names nobody sets stay absent. */
export function mergeTheme(...layers: readonly ThemeOverrides[]): { light: TokenValues; dark: TokenValues } {
  return {
    light: Object.assign({}, ...layers.map((layer) => layer.light)),
    dark: Object.assign({}, ...layers.map((layer) => layer.dark)),
  };
}

const SURFACE = "--el-bg-color";
const INK = "--el-text-color-primary";

function mixed(color: string, base: string, percent: number) {
  return `color-mix(in srgb, var(${color}) ${percent}%, var(${base}))`;
}

/** Element Plus's ladder of one colour, derived the way `brandProperties` derives it: toward surface, dark-2 toward ink. */
function ladder(name: string, color: string) {
  return {
    [`--el-color-${name}-light-3`]: mixed(color, SURFACE, 70),
    [`--el-color-${name}-light-5`]: mixed(color, SURFACE, 50),
    [`--el-color-${name}-light-7`]: mixed(color, SURFACE, 30),
    [`--el-color-${name}-light-8`]: mixed(color, SURFACE, 20),
    [`--el-color-${name}-light-9`]: mixed(color, SURFACE, 10),
    [`--el-color-${name}-dark-2`]: mixed(color, INK, 80),
  };
}

/**
 * Properties the brand derives from a public colour. A scope that sets one of `inputs` declares them again, as
 * references, so they follow the new value there and in everything inside it (a primary override also moves the button
 * hover, the plain-button tint and the ladders Element Plus reads).
 */
const DERIVED: readonly { inputs: readonly string[]; properties: Readonly<Record<string, string>> }[] = [
  {
    inputs: ["--el-color-primary", SURFACE, INK],
    properties: {
      ...ladder("primary", "--el-color-primary"),
      "--brand-primary-hover": mixed("--el-color-primary", INK, 90),
      "--brand-primary-tint": mixed("--el-color-primary", SURFACE, 10),
    },
  },
  {
    inputs: ["--el-color-success", SURFACE, INK],
    properties: { ...ladder("success", "--el-color-success"), "--el-color-success-text": "var(--el-color-success)" },
  },
  { inputs: ["--el-color-warning", SURFACE, INK], properties: ladder("warning", "--el-color-warning") },
  { inputs: ["--el-color-info", SURFACE, INK], properties: ladder("info", "--el-color-info") },
  {
    inputs: ["--el-color-danger", SURFACE, INK],
    properties: { ...ladder("danger", "--el-color-danger"), "--el-color-error": "var(--el-color-danger)", ...ladder("error", "--el-color-danger") },
  },
  {
    inputs: ["--el-border-color", SURFACE],
    properties: {
      "--el-border-color-light": mixed("--el-border-color", SURFACE, 75),
      "--el-border-color-lighter": mixed("--el-border-color", SURFACE, 50),
      "--el-border-color-extra-light": mixed("--el-border-color", SURFACE, 25),
    },
  },
  { inputs: [SURFACE], properties: { "--el-fill-color-blank": `var(${SURFACE})` } },
];

/**
 * The CSS custom properties for one mode's checked values: shadow levels become their `--elevation-*`, the other values
 * stand as given, and the brand's derived properties of every colour set here follow. (A checked colour or length is
 * never a level name, so the level is recognised by its value.)
 */
export function themeProperties(values: TokenValues): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const [name, value] of Object.entries(values))
    properties[name] = (SHADOW_LEVELS as readonly string[]).includes(value) ? `var(--elevation-${value})` : value;
  for (const { inputs, properties: derived } of DERIVED) if (inputs.some((input) => input in values)) Object.assign(properties, derived);
  return properties;
}

const written = new WeakMap<HTMLElement, readonly string[]>();

/**
 * Writes a scope's theme onto its element for the given mode, replacing what an earlier call wrote there: an
 * application, panel or member root with its own layer, a popup or an isolated frame's root with the merged layers of
 * the instance that opened it.
 */
export function applyTheme(element: HTMLElement, theme: ThemeOverrides, mode: BrandMode) {
  for (const name of written.get(element) ?? []) element.style.removeProperty(name);
  const properties = themeProperties(theme[mode] ?? {});
  for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, value);
  written.set(element, Object.keys(properties));
}
