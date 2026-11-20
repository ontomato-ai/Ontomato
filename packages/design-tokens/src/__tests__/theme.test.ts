import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyTheme,
  brandProperties,
  mergeTheme,
  platformTokens,
  SHADOW_LEVELS,
  ThemeError,
  themeProperties,
  tokensManifest,
  validateTheme,
  validateTokenDeclaration,
  type TokenDeclaration,
} from "..";
import { ossBrand } from "../oss";

/** The official components' first variables (design "组件自己的变量"), as their package declares them. */
const official = {
  tokens: [
    { name: "--sdk-object-list-row-height", type: "length", components: ["ObjectList"], default: "--control-height" },
    { name: "--sdk-operation-button-bg", type: "color", components: ["OperationButton"], default: "--el-color-primary" },
  ],
};
const officialTokens = validateTokenDeclaration(official, "sdk");

function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ThemeError);
    return (error as ThemeError).path;
  }
  throw new Error("accepted");
}

describe("theme overrides at the boundary", () => {
  it("accepts colour, length and shadow literals of declared variables in either mode", () => {
    const theme = {
      light: {
        "--el-color-primary": "#3a6",
        "--el-bg-color": "#ffffffcc",
        "--el-text-color-primary": "rgb(10, 20, 30)",
        "--el-text-color-regular": "rgba(10 20 30 / 0.5)",
        "--el-border-color": "hsl(120deg, 40%, 50%)",
        "--el-color-info": "hsla(120 40% 50% / 50%)",
        "--el-bg-color-overlay": "transparent",
        "--radius-md": "0",
        "--spacing-lg": "1.5rem",
        "--control-height": "40px",
        "--text-sm": "90%",
        "--shadow-panel": "overlay",
      },
      dark: { "--el-color-primary": "#AABBCC", "--sdk-object-list-row-height": "36px" },
    };
    expect(validateTheme(theme, officialTokens)).toBe(theme);
  });

  it.each([
    ["url()", "--el-color-primary", "url(https://x/y.png)"],
    ["var()", "--el-color-primary", "var(--el-color-danger)"],
    ["calc()", "--spacing-lg", "calc(1px + 2px)"],
    ["expression()", "--el-color-primary", "expression(alert(1))"],
    ["a second declaration", "--el-color-primary", "#fff; background: red"],
    ["a block", "--spacing-lg", "1px} body {color: red"],
    ["a named colour", "--el-color-primary", "red"],
    ["a negative length", "--spacing-lg", "-4px"],
    ["a unitless length", "--spacing-lg", "4"],
    ["a length for a colour", "--el-color-primary", "4px"],
    ["a colour for a length", "--control-height", "#fff"],
    ["a CSS shadow instead of a level", "--shadow-panel", "0 1px 2px #000"],
  ])("rejects %s and names the variable", (_, name, value) => {
    expect(rejection(() => validateTheme({ dark: { [name]: value } }))).toBe(`dark.${name}`);
  });

  it("rejects names nobody declares, including a package variable whose package is not given", () => {
    expect(rejection(() => validateTheme({ light: { "--el-color-primary-light-3": "#fff" } }))).toBe("light.--el-color-primary-light-3");
    expect(rejection(() => validateTheme({ light: { "--sdk-object-list-row-height": "36px" } }))).toBe("light.--sdk-object-list-row-height");
  });

  it("rejects anything but the two modes of string values", () => {
    expect(rejection(() => validateTheme({ light: {}, contrast: {} }))).toBe("contrast");
    expect(rejection(() => validateTheme({ light: [] }))).toBe("light");
    expect(rejection(() => validateTheme({ light: { "--spacing-lg": 4 } }))).toBe("light.--spacing-lg");
    expect(rejection(() => validateTheme("light"))).toBe("theme");
  });
});

describe("package variable declarations", () => {
  it("accepts literal defaults, per-mode colours and references to a platform variable of the same type", () => {
    const declaration = {
      tokens: [
        { name: "--acme-chart-gap", type: "length", components: ["AcmeChart"], default: "12px" },
        { name: "--acme-chart-fill", type: "color", components: ["AcmeChart", "AcmeLegend"], default: { light: "#fff", dark: "--el-bg-color" } },
        { name: "--acme-chart-shadow", type: "shadow", components: ["AcmeChart"], default: "panel" },
      ],
    };
    expect(validateTokenDeclaration(declaration, "acme")).toEqual(declaration.tokens);
  });

  it.each([
    ["a name outside the prefix", { name: "--other-gap", type: "length", components: ["A"], default: "1px" }, "tokens[0].name"],
    ["a platform name", { name: "--spacing-lg", type: "length", components: ["A"], default: "1px" }, "tokens[0].name"],
    ["an unknown type", { name: "--acme-x", type: "font", components: ["A"], default: "1px" }, "tokens[0].type"],
    ["no components", { name: "--acme-x", type: "length", components: [], default: "1px" }, "tokens[0].components"],
    ["a url default", { name: "--acme-x", type: "color", components: ["A"], default: "url(x.png)" }, "tokens[0].default"],
    ["a reference of another type", { name: "--acme-x", type: "length", components: ["A"], default: "--el-bg-color" }, "tokens[0].default"],
    ["a reference to an undeclared name", { name: "--acme-x", type: "length", components: ["A"], default: "--acme-y" }, "tokens[0].default"],
    ["a bad dark default", { name: "--acme-x", type: "color", components: ["A"], default: { light: "#fff", dark: "var(--x)" } }, "tokens[0].default.dark"],
    ["an extra field", { name: "--acme-x", type: "length", components: ["A"], default: "1px", css: "x" }, "tokens[0].css"],
  ])("rejects %s", (_, token, path) => {
    expect(rejection(() => validateTokenDeclaration({ tokens: [token] }, "acme"))).toBe(path);
  });

  it("rejects a name declared twice", () => {
    const token = { name: "--acme-x", type: "length", components: ["A"], default: "1px" };
    expect(rejection(() => validateTokenDeclaration({ tokens: [token, token] }, "acme"))).toBe("tokens[1].name");
  });
});

describe("layers", () => {
  it("merges light and dark separately, the later layer winning per name and unset names staying absent", () => {
    const app = { light: { "--el-color-primary": "#111111", "--spacing-lg": "20px" }, dark: { "--el-color-primary": "#222222" } };
    const panel = { light: { "--el-color-primary": "#333333" } };
    const member = { dark: { "--spacing-lg": "8px" } };
    expect(mergeTheme(app, panel, member)).toEqual({
      light: { "--el-color-primary": "#333333", "--spacing-lg": "20px" },
      dark: { "--el-color-primary": "#222222", "--spacing-lg": "8px" },
    });
    expect(mergeTheme()).toEqual({ light: {}, dark: {} });
  });

  it("turns shadow levels into the elevation and leaves lengths as they are", () => {
    expect(themeProperties({ "--shadow-panel": "modal", "--spacing-lg": "20px" })).toEqual({
      "--shadow-panel": "var(--elevation-modal)",
      "--spacing-lg": "20px",
    });
  });

  it("a colour set in a scope brings the brand's derived properties along as references to it", () => {
    const properties = themeProperties({ "--el-color-primary": "#ff0000" });
    expect(properties["--el-color-primary"]).toBe("#ff0000");
    expect(properties["--el-color-primary-light-3"]).toBe("color-mix(in srgb, var(--el-color-primary) 70%, var(--el-bg-color))");
    expect(properties["--brand-primary-hover"]).toBe("color-mix(in srgb, var(--el-color-primary) 90%, var(--el-text-color-primary))");
    expect(properties["--brand-primary-tint"]).toBeDefined();
    expect(properties).not.toHaveProperty("--el-color-danger-light-3");
    // A new surface moves every ladder mixed with it.
    const surface = themeProperties({ "--el-bg-color": "#000000" });
    expect(surface).toHaveProperty("--el-color-danger-light-9");
    expect(surface).toHaveProperty("--el-border-color-lighter");
    expect(surface["--el-fill-color-blank"]).toBe("var(--el-bg-color)");
  });

  it("derives only names the brand itself generates, with the same ladder steps", () => {
    const brandNames = Object.keys(brandProperties(ossBrand, "light"));
    const derived = Object.keys(themeProperties({ "--el-bg-color": "#000", "--el-text-color-primary": "#fff", "--el-color-primary": "#fff" }));
    expect(derived.filter((name) => !brandNames.includes(name))).toEqual([]);
  });

  it("writes a scope's mode onto its element and replaces what it wrote before when the mode or theme changes", () => {
    const element = document.createElement("div");
    element.style.setProperty("color", "red");
    const theme = { light: { "--spacing-lg": "20px", "--el-color-primary": "#ff0000" }, dark: { "--shadow-panel": "flat" } };
    applyTheme(element, theme, "light");
    expect(element.style.getPropertyValue("--spacing-lg")).toBe("20px");
    expect(element.style.getPropertyValue("--el-color-primary-light-5")).toContain("var(--el-color-primary)");
    applyTheme(element, theme, "dark");
    expect(element.style.getPropertyValue("--shadow-panel")).toBe("var(--elevation-flat)");
    expect(element.style.getPropertyValue("--spacing-lg")).toBe("");
    expect(element.style.getPropertyValue("--el-color-primary-light-5")).toBe("");
    applyTheme(element, {}, "dark");
    expect(element.style.getPropertyValue("--shadow-panel")).toBe("");
    expect(element.style.getPropertyValue("color")).toBe("red");
  });
});

describe("the released declaration", () => {
  const manifest = tokensManifest(ossBrand, official);

  it("lists the platform variables with the edition's brand colours, then the official components' variables", () => {
    const byName = new Map(manifest.tokens.map((token) => [token.name, token]));
    expect(byName.get("--el-color-primary")?.default).toEqual({ light: ossBrand.light.primary, dark: ossBrand.dark.primary });
    expect(byName.get("--el-bg-color-page")?.default).toEqual({
      light: brandProperties(ossBrand, "light")["--el-bg-color-page"],
      dark: brandProperties(ossBrand, "dark")["--el-bg-color-page"],
    });
    expect(byName.get("--shadow-overlay")).toEqual({ name: "--shadow-overlay", type: "shadow", default: "overlay" });
    expect(byName.get("--sdk-object-list-row-height")?.components).toEqual(["ObjectList"]);
    expect(manifest.shadows).toEqual(["flat", "panel", "overlay", "modal"]);
  });

  it("is plain JSON, and a theme checked against it read back from JSON passes the same check", () => {
    const read = JSON.parse(JSON.stringify(manifest)) as { tokens: TokenDeclaration[] };
    expect(read).toEqual(manifest);
    const packageTokens = read.tokens.filter((token) => token.components);
    expect(validateTheme({ light: { "--sdk-operation-button-bg": "#123456" } }, packageTokens)).toBeTruthy();
  });

  it("refuses to release an official variable that breaks the declaration rules", () => {
    expect(rejection(() => tokensManifest(ossBrand, { tokens: [{ ...official.tokens[0], name: "--object-list-row-height" }] }))).toBe(
      "tokens[0].name"
    );
  });
});

/*
 * foundation.css writes the platform's lengths and shadow levels; the declaration promises the same defaults to
 * authors. One of them changing alone would make the published defaults lie.
 */
describe("the declaration matches foundation.css", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../foundation.css"), "utf8");
  const declared = (name: string) => new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m").exec(css)?.[1];

  it("declares the same length defaults", () => {
    const lengths = platformTokens(ossBrand).filter((token) => token.type === "length");
    expect(lengths.length).toBe(21);
    for (const token of lengths) expect([token.name, declared(token.name)]).toEqual([token.name, token.default]);
  });

  it("maps every public shadow variable to its level's elevation", () => {
    for (const level of SHADOW_LEVELS) expect(declared(`--shadow-${level}`)).toBe(`var(--elevation-${level})`);
  });
});
