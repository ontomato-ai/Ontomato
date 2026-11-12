import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileStyle, parse } from "vue/compiler-sfc";
import { expect, it } from "vitest";

/*
 * The avatar takes its swatch's dark value on the dark theme, from its scoped stylesheet. Written as
 * `:global(html.dark) .x`, Vue compiles the rule to a bare `html.dark` (painting the page, not the avatar); the compiled
 * rule must scope the avatar and leave the document alone.
 */
it("paints the dark swatch on the avatar, not on the document", () => {
  // Tests run from the package root (and under happy-dom, whose module URLs are not files).
  const file = resolve(process.cwd(), "src/components/AgentAvatar.vue");
  const { descriptor } = parse(readFileSync(file, "utf8"), { filename: file });
  const css = descriptor.styles
    .map((style) => compileStyle({ source: style.content, filename: file, id: "data-v-avatar", scoped: style.scoped }).code)
    .join("\n");
  expect(css).toMatch(/html\.dark \.agent-avatar\[data-v-avatar\] \{\s*background: var\(--avatar-dark\);/);
  expect(css).not.toMatch(/(^|[},]\s*)html\.dark\s*[{,]/m);
});
