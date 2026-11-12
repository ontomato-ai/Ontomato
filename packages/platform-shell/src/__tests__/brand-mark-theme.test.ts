import { readFileSync } from "node:fs";
import { compileStyle, parse } from "vue/compiler-sfc";
import { expect, it } from "vitest";

/*
 * The brand mark picks its logo by the document's theme in its scoped stylesheet. Written as `:global(html.dark) .x`,
 * Vue compiles the rule to a bare `html.dark` (styling the page, not the logo), so the dark logo never showed; the
 * compiled rules must scope the logo and leave the document alone.
 */
function compiledCss(path: string) {
  const file = new URL(path, import.meta.url);
  const { descriptor } = parse(readFileSync(file, "utf8"), { filename: file.pathname });
  return descriptor.styles
    .map((style) => compileStyle({ source: style.content, filename: file.pathname, id: "data-v-mark", scoped: style.scoped }).code)
    .join("\n");
}

it("shows the dark logo on the dark theme and the light one otherwise, styling only the logos", () => {
  const css = compiledCss("../PlatformBrandMark.vue");
  expect(css).toMatch(/\.brand-logo-dark\[data-v-mark\],\s*html\.dark \.brand-logo-light\[data-v-mark\] \{\s*display: none;/);
  expect(css).toMatch(/html\.dark \.brand-logo-dark\[data-v-mark\] \{\s*display: block;/);
  expect(css).not.toMatch(/(^|[},]\s*)html\.dark\s*[{,]/m);
});
