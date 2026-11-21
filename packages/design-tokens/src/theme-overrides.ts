/** The public variables an application, panel or placement may override. Defaults stay with the foundation and brand. */
export const themeOverrideTokens = {
  "--el-color-primary": "color",
  "--on-primary": "color",
  "--brand-link": "color",
  "--el-text-color-primary": "color",
  "--el-text-color-regular": "color",
  "--el-text-color-secondary": "color",
  "--el-bg-color": "color",
  "--el-bg-color-page": "color",
  "--el-bg-color-overlay": "color",
  "--el-border-color": "color",
  "--el-color-success": "color",
  "--el-color-warning": "color",
  "--el-color-danger": "color",
  "--el-color-info": "color",
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

const hex = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/iu;
const rgba = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d+(?:\.\d+)?|\.\d+)\s*\)$/iu;
const length = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ch|ex|lh|rlh|vw|vh|vi|vb|vmin|vmax|cm|mm|in|pt|pc|q|%))$/iu;

function literalColor(value: string): boolean {
  if (hex.test(value) || value.toLowerCase() === "transparent") return true;
  const components = rgb.exec(value) ?? rgba.exec(value);
  return components !== null && components.slice(1, 4).every(channel => Number(channel) <= 255)
    && (components[4] === undefined || Number(components[4]) <= 1);
}

export function isThemeOverrideToken(name: string): name is keyof typeof themeOverrideTokens {
  return Object.hasOwn(themeOverrideTokens, name);
}

/** An explanation for a rejected override. Only literal values cross the declaration boundary. */
export function themeOverrideProblem(name: string, value: string): string | undefined {
  if (!isThemeOverrideToken(name)) return `Unknown theme variable '${name}'`;
  const kind = themeOverrideTokens[name];
  const literal = value.trim();
  switch (kind) {
    case "color": return literalColor(literal) ? undefined : "Expected a literal hex or RGB color";
    case "length": return length.test(literal) ? undefined : "Expected a nonnegative literal length";
    case "elevation": return Object.hasOwn(themeElevationTokens, literal) ? undefined : "Expected an elevation of flat, panel, overlay or modal";
  }
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
