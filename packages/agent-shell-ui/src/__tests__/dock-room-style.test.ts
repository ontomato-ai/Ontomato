// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/*
 * The room the composer covers at the foot of a full page (packages/contracts/agent-shell.md "Declarations"), in the
 * stylesheet: a page that scrolls itself marks the vertical scroll area as the end of its content, and the room there is
 * the shell's one measured value. The class is what the page code and an app inside a frame both write, so the rule is
 * checked where it is written, not through a computed style.
 */
const css = readFileSync("src/style.css", "utf8");
const declarations = (selector: string) =>
  new RegExp(`${selector.replace(/[.:]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

it("the class adds the measured room as a block after the content", () => {
  const after = /\.shell-dock-room::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  // Its own block after the last row: it follows the content, never shrinks, and collapses to nothing at 0.
  expect(after).toMatch(/display:\s*block/);
  expect(after).toMatch(/flex:\s*none/);
  expect(after).toMatch(/height:\s*var\(--pane-dock-space,\s*0px\)/);
});

it("the component's element keeps the same room", () => {
  expect(declarations(".shell-dock-room-end")).toMatch(/height:\s*var\(--pane-dock-space,\s*0px\)/);
});
