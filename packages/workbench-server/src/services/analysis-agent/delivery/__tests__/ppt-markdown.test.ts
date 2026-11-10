import { describe, expect, it } from "vitest";
import { parseProductMarkdown } from "@ontomato/markdown";
import { captionRuns, firstHeading, htmlBlocks, pptTables, runsText } from "../ppt-markdown";

// A slide reads an answer as the product Markdown (@ontomato/markdown), so it shows what the answer's page shows.
describe("slides from an answer's Markdown", () => {
  it("keep the formatting of a table cell and the alignment of its column", () => {
    const [table] = pptTables(
      parseProductMarkdown("| 指标 | 状态 |\n|:--|--:|\n| **“销售额”** | ~~停用~~ |\n| 1~2 | <br> |"),
    );

    expect(table!.columns.map((cell) => [runsText(cell.runs), cell.align])).toEqual([
      ["指标", "left"],
      ["状态", "right"],
    ]);
    expect(table!.rows).toEqual([
      [
        { runs: [{ text: "“销售额”", options: { bold: true } }], align: "left" },
        { runs: [{ text: "停用", options: { strike: "sngStrike" } }], align: "right" },
      ],
      [
        { runs: [{ text: "1~2", options: {} }], align: "left" },
        { runs: [{ text: "<br>", options: {} }], align: "right" },
      ],
    ]);
  });

  it("caption a section with its prose, without its title, tables or code", () => {
    const nodes = parseProductMarkdown(
      "## 销售概况\n\n本月**销售额**增长\n第二行\n\n- 华东 ~~旧口径~~\n\n| 区域 |\n|---|\n| 华东 |\n\n```html\n<div id=\"chart\"></div>\n```",
    );

    expect(firstHeading(nodes)).toBe("销售概况");
    expect(runsText(captionRuns(nodes, ["销售概况"]))).toBe("本月销售额增长；第二行；华东 旧口径");
    expect(htmlBlocks(nodes)).toEqual(['<div id="chart"></div>']);
  });
});
