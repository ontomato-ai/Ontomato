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
  // Folded, its round button keeps the same room under it.
  const unfold = [...style("../components/ShellComposer.vue").matchAll(/\n\.composer-unfold \{([^}]*)\}/g)].map((rule) => rule[1]).join("");
  expect(unfold).toMatch(/bottom: var\(--shell-composer-foot\);/);
});
