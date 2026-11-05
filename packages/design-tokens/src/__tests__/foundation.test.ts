// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The text-colour rules of the Element Plus mapping: primary-coloured text (active tab, active menu item, selected
 * option, text and link buttons, links) uses the link role, rows on the selected background use ink, and disabled
 * primary buttons use the disabled roles.
 */
const css = readFileSync(new URL("../foundation.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** A selector list split at top-level commas (not the ones inside `:is(...)`). */
function selectorList(selectors: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of selectors) {
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += character;
  }
  return [...parts, current].map((part) => part.trim().replace(/\s+/g, " "));
}

/** Declarations of every rule whose selector list contains `selector`, merged in source order. */
function declarationsFor(selector: string) {
  const declarations: Record<string, string> = {};
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList(selectors).includes(selector)) continue;
    for (const line of body.split(";")) {
      const index = line.indexOf(":");
      if (index > 0) declarations[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
  }
  return declarations;
}

describe("foundation text colours", () => {
  it("active tab, active menu item and selected option use the link role", () => {
    expect(declarationsFor(".el-tabs__item.is-active")).toMatchObject({ color: "var(--brand-link)" });
    expect(
      declarationsFor(".el-tabs--border-card > .el-tabs__header .el-tabs__item.is-active")
    ).toMatchObject({ color: "var(--brand-link)" });
    expect(declarationsFor(".el-select-dropdown__item.is-selected")).toMatchObject({ color: "var(--brand-link)" });
    expect(declarationsFor(".el-menu")).toMatchObject({
      "--el-menu-active-color": "var(--brand-link)",
      "--el-menu-hover-text-color": "var(--el-menu-text-color)",
    });
  });

  it("plain primary buttons and primary tags show link text on the primary tint, not on the selected background", () => {
    expect(declarationsFor(".el-button.el-button--primary.is-plain")).toMatchObject({
      "--el-button-text-color": "var(--brand-link)",
      "--el-button-bg-color": "var(--brand-primary-tint)",
    });
    expect(declarationsFor(".el-tag.el-tag--primary:not(.el-tag--dark)")).toMatchObject({
      "--el-tag-text-color": "var(--brand-link)",
    });
    expect(declarationsFor(".el-tag.el-tag--primary:not(.el-tag--dark):not(.el-tag--plain)")).toMatchObject({
      "--el-tag-bg-color": "var(--brand-primary-tint)",
    });
  });

  it("disabled primary buttons use the disabled roles, not a paler primary that looks enabled in dark mode", () => {
    expect(declarationsFor(".el-button.el-button--primary:not(.is-dashed)")).toMatchObject({
      "--el-button-disabled-bg-color": "var(--el-fill-color-light)",
      "--el-button-disabled-border-color": "var(--el-border-color-light)",
      "--el-button-disabled-text-color": "var(--el-disabled-text-color)",
    });
  });

  it("text and link primary buttons and primary links use the link role", () => {
    expect(declarationsFor(".el-button.el-button--primary:is(.is-text, .is-link)")).toMatchObject({
      "--el-button-text-color": "var(--brand-link)",
    });
    expect(declarationsFor(".el-link.el-link--primary")).toMatchObject({ "--el-link-text-color": "var(--brand-link)" });
  });

  it("rows on the selected background keep ink text", () => {
    for (const selector of [
      ".el-table__body tr.current-row > td.el-table__cell",
      ".el-tree--highlight-current .el-tree-node.is-current > .el-tree-node__content",
      ".el-table-filter__list-item:hover",
    ])
      expect(declarationsFor(selector), selector).toMatchObject({ color: "var(--el-text-color-primary)" });
    expect(declarationsFor(".el-dropdown__popper")).toMatchObject({
      "--el-dropdown-menuItem-hover-color": "var(--el-text-color-primary)",
    });
  });
});

describe("foundation shell sizes", () => {
  /*
   * The platform rail holds applications only, so it is narrower than the old agent rail, and it uses its own
   * variables rather than borrowing that rail's meaning.
   */
  it("declares the platform rail's own widths and its 36px toggle", () => {
    expect(declarationsFor(":root")).toMatchObject({
      "--shell-platform-rail": "188px",
      "--shell-platform-rail-collapsed": "56px",
      "--shell-rail-button": "36px",
    });
    expect(declarationsFor(":root")["--shell-platform-rail"]).not.toBe(declarationsFor(":root")["--shell-agent-rail"]);
  });
});
