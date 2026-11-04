// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The text-colour rules of the Element Plus mapping: primary-coloured text (active tab, active menu item, selected
 * option, text and link buttons, links) uses the link role, and rows on the selected background use ink.
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
