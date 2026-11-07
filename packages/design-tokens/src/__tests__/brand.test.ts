import { describe, expect, it } from "vitest";
import {
  brandContrastFailures,
  brandProperties,
  brandStylesheet,
  findBrandDeclarations,
  installBrandTheme,
  type BrandSource,
} from "..";
import { contrastRatio, mix } from "../color";
import { ossBrand } from "../oss";

function block(css: string, selector: string) {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    body
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()])
  );
}

describe("brand generation", () => {
  it("the open-source brand meets every contrast pair DESIGN.md requires, in light and dark", () => {
    expect(brandContrastFailures(ossBrand)).toEqual([]);
  });

  it("the audit reports a failing pair with its mode", () => {
    const weak: BrandSource = { ...ossBrand, dark: { ...ossBrand.dark, placeholder: ossBrand.dark.surface } };
    expect(brandContrastFailures(weak)).toEqual([
      "dark placeholder on surface: 1.00 < 4.5",
      expect.stringMatching(/^dark placeholder on raised: /),
    ]);
  });

  it("maps the colour roles onto Element Plus the way DESIGN.md lists them", () => {
    for (const mode of ["light", "dark"] as const) {
      const c = ossBrand[mode];
      const p = brandProperties(ossBrand, mode);
      expect(p).toMatchObject({
        // The page background is the workspace band; the rail and panel of the platform shell use their own roles.
        "--el-bg-color-page": c.workspace,
        "--shell-rail-bg": c.rail,
        "--shell-panel-bg": c.panel,
        "--shell-workspace-bg": c.workspace,
        "--shell-rail-selected": c.railSelected,
        "--shell-panel-selected": c.panelSelected,
        "--shell-app-edge": c.edge,
        "--el-bg-color": c.surface,
        "--el-bg-color-overlay": c.raised,
        "--el-fill-color": c.sunken,
        "--el-fill-color-light": c.hover,
        "--el-color-primary-light-9": c.primarySoft,
        "--el-border-color": c.line,
        "--el-border-color-dark": c.lineStrong,
        "--el-text-color-primary": c.ink,
        "--el-text-color-regular": c.ink2,
        "--el-text-color-secondary": c.muted,
        "--el-text-color-placeholder": c.placeholder,
        "--el-disabled-text-color": c.faint,
        "--el-color-primary": c.primary,
        "--el-color-primary-dark-2": c.primaryPress,
        "--brand-primary-hover": c.primaryHover,
        "--on-primary": c.onPrimary,
        "--el-color-success": c.success,
        "--el-color-warning": c.warning,
        "--el-color-danger": c.danger,
        "--el-color-error": c.danger,
        "--el-color-info": c.info,
        "--brand-accent": c.accent,
        "--brand-accent-ink": c.accentInk,
        "--brand-accent-soft": c.accentSoft,
      });
      // The primary ladder is primary mixed with surface at 30/50/70/80%; status soft fills are 10% status over surface.
      for (const step of [3, 5, 7, 8]) expect(p[`--el-color-primary-light-${step}`]).toBe(mix(c.primary, c.surface, step / 10));
      expect(p["--el-color-danger-light-9"]).toBe(mix(c.danger, c.surface, 0.9));
      // Tags and plain buttons use their own tint; the selected background stays primary-soft.
      expect(p["--brand-primary-tint"]).toBe(mix(c.primary, c.surface, 0.9));
      ossBrand.dataviz[mode].forEach((color, index) => expect(p[`--chart-${index + 1}`]).toBe(color));
    }
  });

  it("the audit checks primary-coloured text and ink on the selected background", () => {
    // A dark primary that only works as a fill (white text on it) fails as text unless a link colour is given.
    const fillOnly: BrandSource = {
      ...ossBrand,
      dark: { ...ossBrand.dark, primary: "#3f43c4", primaryHover: "#373ab0", primaryPress: "#30339c", onPrimary: "#ffffff" },
    };
    expect(brandContrastFailures(fillOnly)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^dark link on surface: /)])
    );
    expect(brandContrastFailures({ ...fillOnly, dark: { ...fillOnly.dark, link: "#8f92ff" } })).toEqual([]);
    // Link text must also hold on the primary tint of tags and plain buttons.
    const faintLink: BrandSource = { ...ossBrand, light: { ...ossBrand.light, link: "#9aa69a" } };
    expect(brandContrastFailures(faintLink)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^light link on primary tint: /)])
    );
    const pale: BrandSource = { ...ossBrand, light: { ...ossBrand.light, primarySoft: "#62665c" } };
    expect(brandContrastFailures(pale)).toEqual(expect.arrayContaining([expect.stringMatching(/^light ink on selected: /)]));
  });

  it("links use primary unless the edition defines a link colour", () => {
    expect(brandProperties(ossBrand, "light")["--brand-link"]).toBe(ossBrand.light.primary);
    const linked: BrandSource = { ...ossBrand, light: { ...ossBrand.light, link: "#123456" } };
    expect(brandProperties(linked, "light")["--brand-link"]).toBe("#123456");
  });

  it("the workbench stylesheet carries exactly the generated properties: light on :root, dark on html.dark", () => {
    const css = brandStylesheet(ossBrand);
    expect(block(css, ":root")).toEqual(brandProperties(ossBrand, "light"));
    expect(block(css, "html.dark")).toEqual(brandProperties(ossBrand, "dark"));
  });

  it("installs the stylesheet once and replaces it on a second call", () => {
    installBrandTheme(ossBrand);
    installBrandTheme(ossBrand);
    const styles = document.head.querySelectorAll("style#ontomato-brand");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toBe(brandStylesheet(ossBrand));
  });

  it("the chart palette has the eight categorical colours of each mode", () => {
    expect(ossBrand.dataviz.light).toHaveLength(8);
    expect(ossBrand.dataviz.dark).toHaveLength(8);
  });

  it("uses brighter chart marks in dark mode instead of dimming the light palette", () => {
    ossBrand.dataviz.dark.forEach((color, index) => {
      expect(contrastRatio(color, "#000000")).toBeGreaterThan(contrastRatio(ossBrand.dataviz.light[index], "#000000"));
    });
  });

  /**
   * Three bands with no divider: light mode goes rail darkest, panel, workspace whitest; dark mode reverses it. The
   * order is judged from the colours themselves, so a future palette is only kept if it still reads as three bands.
   */
  it("orders the three shell bands: rail darkest in light mode, lightest in dark mode", () => {
    const light = ossBrand.light;
    const dark = ossBrand.dark;
    const lighter = (a: string, b: string) => contrastRatio(a, "#000000") > contrastRatio(b, "#000000");
    expect(lighter(light.panel, light.rail)).toBe(true);
    expect(lighter(light.workspace, light.panel)).toBe(true);
    expect(lighter(dark.rail, dark.panel)).toBe(true);
    expect(lighter(dark.panel, dark.workspace)).toBe(true);
    // Selected rows stay visible on their own band.
    for (const mode of ["light", "dark"] as const) {
      const c = ossBrand[mode];
      expect(contrastRatio(c.railSelected, c.rail)).toBeGreaterThan(1.04);
      expect(contrastRatio(c.panelSelected, c.panel)).toBeGreaterThan(1.04);
    }
  });

  it("borrows the open-source bands from existing steps, adding no colour", () => {
    const steps = (mode: "light" | "dark") => {
      const c = ossBrand[mode];
      return [c.canvas, c.surface, c.raised, c.sunken, c.primarySoft];
    };
    for (const mode of ["light", "dark"] as const) {
      const c = ossBrand[mode];
      for (const role of [c.rail, c.panel, c.workspace, c.railSelected, c.panelSelected])
        expect(steps(mode)).toContain(role);
    }
  });

  it("the single-source guard finds declarations in stylesheets, components and TypeScript, not reads", () => {
    expect(
      findBrandDeclarations({
        "a.css": ":root {\n  --el-color-primary: #000;\n  --spacing-sm: 8px;\n}",
        "b.vue": "<style>.x{--chart-3:red;color:var(--el-bg-color)}</style>",
        "c.ts": 'const p = { "--el-bg-color": "#fff", "--manager-x": "var(--el-color-primary)" };',
      })
    ).toEqual(["a.css: --el-color-primary", "b.vue: --chart-3", "c.ts: --el-bg-color"]);
  });

  it("contrast ratios match the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#42613f", "#ffffff")).toBeCloseTo(7.0, 1);
  });
});
