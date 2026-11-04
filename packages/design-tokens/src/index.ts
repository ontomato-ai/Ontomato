import { contrastRatio, mix, rgbTriplet } from "./color";

/*
 * @ontomato/design-tokens: the design foundation and the brand layer of docs/design/DESIGN.md as code, free of
 * application code, so the workbench and the Ontology Manager page both depend on this package alone.
 *
 * Each edition keeps exactly one BrandSource (its colour roles in light and dark plus the categorical chart palette);
 * everything that needs a brand colour is generated from it here:
 * - the workbench stylesheet (`installBrandTheme`, called by `startWorkbenchWeb` in @ontomato/workbench-ui),
 * - the Ontology Manager presentation (`brandProperties` per theme for `themeProperties`, `dataviz` for `nodePalette`).
 * The role → Element Plus mapping follows DESIGN.md "Colour roles → Element Plus". Foundation values (type, spacing,
 * shape, density, shell, elevation, motion) and the component variable rules live in ./foundation.css
 * (`@ontomato/design-tokens/foundation.css`).
 */

export type BrandMode = "light" | "dark";

/** The colour roles of one mode (DESIGN.md front matter `colors.light` / `colors.dark`). */
export interface BrandColors {
  /** Shell panels: sidebar, list panel, admin navigation. */
  canvas: string;
  /** Workspace, tables, forms, input fills. */
  surface: string;
  /** Overlays: dialogs, popovers, dropdowns. */
  raised: string;
  /** Inset wells, code blocks, table head. */
  sunken: string;
  hover: string;
  line: string;
  lineStrong: string;
  ink: string;
  ink2: string;
  muted: string;
  /** Placeholders; at least 4.5:1 on surface and raised. */
  placeholder: string;
  /** Disabled text only (exempt from contrast). */
  faint: string;
  primary: string;
  /** Primary button hover; on-primary keeps at least 4.5:1 on it. */
  primaryHover: string;
  primaryPress: string;
  onPrimary: string;
  /** Selected state (current nav row, selected table row). */
  primarySoft: string;
  /**
   * Text drawn in the primary colour (links, active tab, active menu item, selected option) when it differs from
   * primary; such text uses primary otherwise. Needed when primary, chosen to carry on-primary text, is under 4.5:1
   * as text on canvas, surface or raised.
   */
  link?: string;
  /** The logo mark colour, when the edition defines one (never a text or button colour). */
  brandMark?: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface BrandSource {
  light: BrandColors;
  dark: BrandColors;
  /** Categorical chart and graph palette per mode, fixed order (DESIGN.md `dataviz.categorical-*`). */
  dataviz: Readonly<Record<BrandMode, readonly string[]>>;
}

const LADDER = [3, 5, 7, 8] as const;

/** Element Plus colour family: `light-N` mixes the colour with `surface` by N×10%; `light-9` and `dark-2` as given. */
function family(name: string, color: string, light9: string, dark2: string, surface: string) {
  const properties: Record<string, string> = {
    [`--el-color-${name}`]: color,
    [`--el-color-${name}-rgb`]: rgbTriplet(color),
  };
  for (const step of LADDER) properties[`--el-color-${name}-light-${step}`] = mix(color, surface, step / 10);
  properties[`--el-color-${name}-light-9`] = light9;
  properties[`--el-color-${name}-dark-2`] = dark2;
  return properties;
}

/** Status family: the soft fill (`light-9`) is the status at 10% over surface; `dark-2` moves toward ink. */
function statusFamily(name: string, color: string, colors: BrandColors) {
  return family(name, color, mix(color, colors.surface, 0.9), mix(color, colors.ink, 0.2), colors.surface);
}

/** Every brand custom property of one mode: the Element Plus variables plus the roles Element Plus lacks. */
export function brandProperties(brand: BrandSource, mode: BrandMode): Record<string, string> {
  const c = brand[mode];
  const palette = brand.dataviz[mode];
  const properties: Record<string, string> = {
    ...family("primary", c.primary, c.primarySoft, c.primaryPress, c.surface),
    ...statusFamily("success", c.success, c),
    ...statusFamily("warning", c.warning, c),
    ...statusFamily("danger", c.danger, c),
    ...statusFamily("error", c.danger, c),
    ...statusFamily("info", c.info, c),

    "--el-bg-color-page": c.canvas,
    "--el-bg-color": c.surface,
    "--el-bg-color-overlay": c.raised,

    "--el-fill-color": c.sunken,
    "--el-fill-color-light": c.hover,
    "--el-fill-color-lighter": mix(c.hover, c.surface, 0.5),
    "--el-fill-color-extra-light": mix(c.hover, c.surface, 0.75),
    "--el-fill-color-dark": c.line,
    "--el-fill-color-darker": c.lineStrong,
    "--el-fill-color-blank": c.surface,

    "--el-border-color": c.line,
    "--el-border-color-light": mix(c.line, c.surface, 0.25),
    "--el-border-color-lighter": mix(c.line, c.surface, 0.5),
    "--el-border-color-extra-light": mix(c.line, c.surface, 0.75),
    "--el-border-color-dark": c.lineStrong,
    "--el-border-color-darker": mix(c.lineStrong, c.muted, 0.25),

    "--el-text-color-primary": c.ink,
    "--el-text-color-regular": c.ink2,
    "--el-text-color-secondary": c.muted,
    "--el-text-color-placeholder": c.placeholder,
    // Not an Element Plus variable; existing pages use it for meta text, so it keeps the placeholder role.
    "--el-text-color-tertiary": c.placeholder,
    "--el-text-color-disabled": c.faint,
    "--el-disabled-text-color": c.faint,

    "--brand-primary-hover": c.primaryHover,
    "--on-primary": c.onPrimary,
    "--brand-link": c.link ?? c.primary,
    // Soft fill of primary tags and plain primary buttons: primary at 10% over surface, like the status soft fills.
    // It is not the selected background (primary-soft), which may be too strong for link text (enterprise dark 4.2:1).
    "--brand-primary-tint": primaryTint(c),
    "--brand-accent": c.accent,
    "--brand-accent-ink": c.accentInk,
    "--brand-accent-soft": c.accentSoft,
  };
  if (c.brandMark) properties["--brand-mark"] = c.brandMark;
  palette.forEach((color, index) => (properties[`--chart-${index + 1}`] = color));
  return properties;
}

function primaryTint(c: BrandColors) {
  return mix(c.primary, c.surface, 0.9);
}

function declarations(properties: Record<string, string>) {
  return Object.entries(properties)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
}

/** The workbench stylesheet: light on `:root`, dark on `html.dark` (the class the workbench theme toggles). */
export function brandStylesheet(brand: BrandSource) {
  return `:root {\n${declarations(brandProperties(brand, "light"))}\n}\nhtml.dark {\n${declarations(brandProperties(brand, "dark"))}\n}\n`;
}

const STYLE_ID = "ontomato-brand";

/**
 * Puts the brand stylesheet into the document head once. It is appended after the bundled stylesheets, so on equal
 * selectors it overrides Element Plus's own `:root` and `html.dark` defaults.
 */
export function installBrandTheme(brand: BrandSource, doc: Document = document) {
  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = brandStylesheet(brand);
}

const BODY_TEXT = 4.5;
const GRAPHIC = 3;

/**
 * Contrast pairs DESIGN.md requires, per mode: text colours on every surface they sit on, the selected background
 * included (selected rows use ink), placeholders on input fills, on-primary on the filled primary states, link text (all
 * primary-coloured text, also on the primary tint of tags and plain buttons), status text on surface and on its soft fill, accent text, and chart marks against the
 * surface. Returns one line per failing pair; empty when the brand passes.
 */
export function brandContrastFailures(brand: BrandSource): string[] {
  const failures: string[] = [];
  for (const mode of ["light", "dark"] as const) {
    const c = brand[mode];
    const check = (label: string, foreground: string, background: string, minimum: number) => {
      const ratio = contrastRatio(foreground, background);
      if (ratio < minimum) failures.push(`${mode} ${label}: ${ratio.toFixed(2)} < ${minimum}`);
    };
    const backgrounds = { canvas: c.canvas, surface: c.surface, raised: c.raised, sunken: c.sunken, hover: c.hover, selected: c.primarySoft };
    for (const role of ["ink", "ink2", "muted"] as const)
      for (const [name, background] of Object.entries(backgrounds)) check(`${role} on ${name}`, c[role], background, BODY_TEXT);
    check("placeholder on surface", c.placeholder, c.surface, BODY_TEXT);
    check("placeholder on raised", c.placeholder, c.raised, BODY_TEXT);
    for (const state of ["primary", "primaryHover", "primaryPress"] as const)
      check(`onPrimary on ${state}`, c.onPrimary, c[state], BODY_TEXT);
    for (const name of ["canvas", "surface", "raised"] as const) check(`link on ${name}`, c.link ?? c.primary, c[name], BODY_TEXT);
    check("link on primary tint", c.link ?? c.primary, primaryTint(c), BODY_TEXT);
    for (const status of ["success", "warning", "danger", "info"] as const) {
      check(`${status} on surface`, c[status], c.surface, BODY_TEXT);
      check(`${status} on its soft fill`, c[status], mix(c[status], c.surface, 0.9), BODY_TEXT);
    }
    check("accentInk on surface", c.accentInk, c.surface, BODY_TEXT);
    check("accentInk on accentSoft", c.accentInk, c.accentSoft, BODY_TEXT);
    brand.dataviz[mode].forEach((color, index) => check(`chart ${index + 1} on surface`, color, c.surface, GRAPHIC));
  }
  return failures;
}

/**
 * Guard for "one brand source per edition": lists every declaration of a generated brand variable in the given source
 * files (`path → text`), as `path: --name`. CSS and Vue declarations (`--name:`) and TypeScript property keys
 * (`"--name":`) count; reading a variable with var() does not.
 */
export function findBrandDeclarations(files: Readonly<Record<string, string>>): string[] {
  const names = new Set([...Object.keys(brandProperties(guardBrand, "light")), "--brand-mark"]);
  const found: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const pattern = path.endsWith(".ts") ? /["'](--[a-z0-9-]+)["']\s*:/g : /(?:^|[\s;{])(--[a-z0-9-]+)\s*:/g;
    for (const match of text.matchAll(pattern)) if (names.has(match[1])) found.push(`${path}: ${match[1]}`);
  }
  return found;
}

// Any complete brand gives the full set of generated names; the values do not matter.
const guardColors: BrandColors = {
  canvas: "#000000", surface: "#000000", raised: "#000000", sunken: "#000000", hover: "#000000", line: "#000000",
  lineStrong: "#000000", ink: "#000000", ink2: "#000000", muted: "#000000", placeholder: "#000000", faint: "#000000",
  primary: "#000000", primaryHover: "#000000", primaryPress: "#000000", onPrimary: "#000000", primarySoft: "#000000",
  accent: "#000000", accentInk: "#000000", accentSoft: "#000000", success: "#000000", warning: "#000000",
  danger: "#000000", info: "#000000",
};
const guardBrand: BrandSource = {
  light: guardColors,
  dark: guardColors,
  dataviz: { light: Array(8).fill("#000000"), dark: Array(8).fill("#000000") },
};
