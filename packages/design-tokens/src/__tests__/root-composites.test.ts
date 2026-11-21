import { afterEach, expect, it } from "vitest";
import { rootComposites } from "../root-composites";

/*
 * The root rules a themed area declares again are read from the deployment's own stylesheets, whatever selectors they
 * hold (2026-11-22 on 128: Element Plus's colour picker writes `:not(:-webkit-any(.is-disabled, .is-focused))`). A list
 * is cut at its own commas only — never inside `:is()`, `:where()`, `:has()`, `:not()`, an `:-webkit-any()` or
 * `:-moz-any()`, or an attribute selector — so every part is a selector the browser parsed.
 */

afterEach(() => {
  document.head.querySelectorAll("style").forEach((style) => style.remove());
});

it("cuts a selector list at its own commas only, whatever functions its selectors hold", () => {
  const style = document.createElement("style");
  style.textContent = [
    ":root, .a:is(.b, .c), .d:where(.e, .f), .g:has(.h, .i), .j:not(.k, .l), [data-x=\"1,2\"] { --ring: 0 0 0 2px var(--brand-primary-tint); }",
    ".m:-webkit-any(.n, .o) { color: red; }",
    ".p:-moz-any(.q, .r) { color: red; }",
  ].join("\n");
  document.head.append(style);
  expect(rootComposites(["--brand-primary-tint"])).toEqual({ "--ring": "0 0 0 2px var(--brand-primary-tint)" });
});
