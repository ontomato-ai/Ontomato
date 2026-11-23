/*
 * How an area takes a theme (product-layer standard, the theme layers): it declares the values the theme assigns, the
 * shades worked out from a colour it recolours (`themeDerivedProperties`), and again every custom property the page's
 * stylesheets compose on the root from any of those (`rootComposites`) — a value composed on the root is worked out
 * there once and inherited as it came out, so without that the area would keep the platform's colour in it.
 *
 * The rule for anyone writing a stylesheet: compose a value from the brand's colours as a custom property on the root
 * that reads them with `var()` (`--control-focus-ring: 0 0 0 2px var(--brand-primary-tint)`), and read that property
 * where it is used. Such a rule is found and declared again in every themed area without being listed anywhere. A colour
 * worked out by hand from the brand's — a literal, or one composed outside a custom property — stays the platform's in
 * every application.
 */

/** The public variables an application, panel or placement may override. Defaults stay with the foundation and brand. */
export const themeOverrideTokens = {
  "--sdk-color-primary": "color",
  "--on-primary": "color",
  "--brand-link": "color",
  "--sdk-text-color-primary": "color",
  "--sdk-text-color-regular": "color",
  "--sdk-text-color-secondary": "color",
  "--sdk-bg-color": "color",
  "--sdk-bg-color-page": "color",
  "--sdk-bg-color-overlay": "color",
  "--sdk-border-color": "color",
  "--sdk-color-success": "color",
  "--sdk-color-warning": "color",
  "--sdk-color-danger": "color",
  "--sdk-color-info": "color",
  "--text-xs": "length",
  "--text-sm": "length",
  "--text-base": "length",
  "--text-lg": "length",
  "--text-xl": "length",
  "--leading-xs": "length",
  "--leading-sm": "length",
  "--leading-base": "length",
  "--leading-lg": "length",
  "--leading-xl": "length",
  "--radius-xs": "length",
  "--radius-sm": "length",
  "--radius-md": "length",
  "--radius-lg": "length",
  "--radius-full": "length",
  "--spacing-sm": "length",
  "--spacing-md": "length",
  "--spacing-lg": "length",
  "--control-height-sm": "length",
  "--control-height": "length",
  "--control-height-lg": "length",
  "--pane-narrow-breakpoint": "length",
  "--workbench-narrow-breakpoint": "length",
  "--elevation-flat": "elevation",
  "--elevation-panel": "elevation",
  "--elevation-overlay": "elevation",
  "--elevation-modal": "elevation",
} as const;

export const themeElevationTokens = {
  flat: "--elevation-flat",
  panel: "--elevation-panel",
  overlay: "--elevation-overlay",
  modal: "--elevation-modal",
} as const;

const cssCustomPropertyName = /^--[A-Za-z0-9_-]+$/u;
const unsafeCssValue = /[;{}]|<\/style/iu;

export function isThemeOverrideToken(name: string): name is keyof typeof themeOverrideTokens {
  return Object.hasOwn(themeOverrideTokens, name);
}

/**
 * An explanation for a rejected theme override: accepts any public CSS custom property (except third-party `--el-*`
 * variables) and any valid CSS value expression (including `hsl()`, `oklch()`, `color-mix()`, `var()`, `calc()`).
 */
export function themeOverrideProblem(name: string, value: string): string | undefined {
  if (!cssCustomPropertyName.test(name)) return `Invalid theme variable name '${name}'; expected a CSS custom property starting with '--'`;
  if (name.startsWith("--el-")) return `Third-party variable '${name}' is not allowed; use a '--sdk-*' or custom token instead`;
  const trimmed = value.trim();
  if (!trimmed) return "Expected a non-empty CSS value";
  if (unsafeCssValue.test(trimmed)) return "CSS value cannot contain ';', '{', '}', or '</style'";
  return undefined;
}

/** Validate both modes against the current design-token catalogue. */
export function themeOverrideProblems(theme: {
  readonly light?: Readonly<Record<string, string>>;
  readonly dark?: Readonly<Record<string, string>>;
}) {
  return (["light", "dark"] as const).flatMap(mode =>
    Object.entries(theme[mode] ?? {}).flatMap(([name, value]) => {
      const message = themeOverrideProblem(name, value);
      return message === undefined ? [] : [{ mode, name, message }];
    }),
  );
}
