import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/*
 * The room under the composer is one value: the conversation's composer and a page's own stand as far above the bottom
 * edge as each other. It is defined once, as a token, and both read it — neither writes a distance of its own. The
 * rendered distance itself is the browser's to lay out and is checked on the deployed page.
 */
const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const style = (relative: string) => source(relative).split("<style")[1]!;

it("defines the room under the composer once, and both composers read it", () => {
  const tokens = source("../../../design-tokens/src/foundation.css");
  expect(tokens.match(/--shell-composer-foot:/g)).toHaveLength(1);

  // Under the conversation, at a page's own foot, and floating over a page open beside the conversation.
  const conversation = style("../components/ShellConversation.vue").split(".dock {")[1]!.split("}")[0]!;
  const page = style("../components/PageComposer.vue").split(".page-ask {")[1]!.split("}")[0]!;
  const beside = style("../components/ShellPagePane.vue").split(".pane-dock {")[1]!.split("}")[0]!;
  for (const rules of [conversation, page, beside]) expect(rules).toMatch(/padding:[^;]*var\(--shell-composer-foot\);/);
  // The page's composer stands in the flex column under the content box rather than floating sticky over it.
  expect(page).toMatch(/flex-shrink:\s*0;/);
  expect(page).not.toMatch(/position:\s*sticky;/);
  // Folded, its round button stays in flow under the content box (never fixed over it) and keeps the same room under it.
  const unfold = [...style("../components/ShellComposer.vue").matchAll(/\n\.composer-unfold \{([^}]*)\}/g)].map((rule) => rule[1]).join("");
  expect(unfold).not.toMatch(/position:\s*fixed;/);
  const pageFolded = style("../components/PageComposer.vue").split(".page-ask:has(.composer-unfold) {")[1]!.split("}")[0]!;
  expect(pageFolded).toMatch(/padding:[^;]*var\(--shell-composer-foot\);/);
  expect(style("../components/ShellPagePane.vue")).not.toContain(".pane-dock:has(> .composer-unfold:only-child)");
});

/*
 * Under a conversation the input stands in a column: a flexible basis there would override the height its lines set, and
 * the box would stay one line however much is written. It does not flex in that column; floating, it shares a line with
 * send and takes what that line leaves. (The test page has no layout, so this reads the stylesheet; the rendered height
 * is checked on the deployed page.)
 */
it("lets the conversation's input keep the height its lines set", () => {
  const rules = style("../components/ShellComposer.vue");
  const input = [...rules.matchAll(/\ntextarea \{([^}]*)\}/g)].map((rule) => rule[1]).join("");
  expect(input).toMatch(/flex: none;/);
  expect(input).not.toMatch(/flex: 1;/);
  const floating = [...rules.matchAll(/\n\.composer\.floating textarea \{([^}]*)\}/g)].map((rule) => rule[1]).join("");
  expect(floating).toMatch(/flex: 1 1 auto;/);
});

it("keeps the default send icon as the shared platform action", () => {
  const composer = source("../components/ShellComposer.vue");
  expect(composer).toContain('<ArrowUp v-else :size="16" aria-hidden="true" />');
  expect(composer).toContain('<Send v-if="sendIcon === \'plane\'" :size="13" aria-hidden="true" />');
});
