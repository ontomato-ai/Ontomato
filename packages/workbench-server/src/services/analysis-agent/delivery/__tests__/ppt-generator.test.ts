import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { configureI18n } from "../../../../i18n";
import { appTextEn } from "../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../i18n/locales/en";
import type { PptSourceSection } from "@ontomato/contracts/ppt";
import { buildPptDeck } from "../ppt-generator";

configureI18n({ defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en", packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } } });

// A table from an answer reads on its slide as on its page, the alignment of its columns included.
describe("a PPT table slide", () => {
  it("aligns each column as the answer's table does", async () => {
    const { buffer } = await buildPptDeck(
      "报告",
      [{ id: "answer", heading: "问题", content: "| 左 | 中 | 右 |\n|:--|:-:|--:|\n| 1 | 2 | 3 |" }],
      { title: "报告", subtitle: "", slides: [] },
      {},
      undefined,
      async () => "",
    );
    const slide = new AdmZip(buffer)
      .getEntries()
      .map((entry) => entry.getData().toString("utf8"))
      .find((xml) => xml.includes("<a:tbl>"))!;

    const cells = [...slide.matchAll(/<a:tc[ >][\s\S]*?<\/a:tc>/g)].map(([cell]) => [
      cell.match(/<a:t>([^<]*)<\/a:t>/)![1],
      cell.match(/algn="(\w+)"/)![1],
    ]);
    expect(cells).toEqual([
      ["左", "l"],
      ["中", "ctr"],
      ["右", "r"],
      ["1", "l"],
      ["2", "ctr"],
      ["3", "r"],
    ]);
  });
});

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** The slides after the cover of a deck without summary slides: what each shows in its 24pt title and 8pt footer. */
async function appendix(sections: PptSourceSection[]) {
  const { buffer } = await buildPptDeck("会话", sections, { title: "报告摘要", subtitle: "", slides: [] }, {}, undefined, async () => PIXEL);
  return new AdmZip(buffer)
    .getEntries()
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.entryName))
    .sort((a, b) => Number(a.entryName.match(/\d+/)![0]) - Number(b.entryName.match(/\d+/)![0]))
    .slice(1)
    .map((entry) => {
      const xml = entry.getData().toString("utf8");
      const texts = (points: number) =>
        [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)]
          .filter(([shape]) => shape.includes(`sz="${points * 100}"`))
          .map(([shape]) => [...shape.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join(""));
      return { kind: xml.includes("<a:tbl>") ? "table" : "chart", title: texts(24)[0], footer: texts(8)[0] };
    });
}

// An answer's chart or table is named by the heading above it, else by its question's first line, and every footer
// carries the deck's title.
describe("the titles of PPT appendix slides", () => {
  const question = "请把下面这段 **Markdown** 原样输出成表格，并且标出每个区域本季度的销售额和环比变化情况，最后用一句话总结";

  it("name an answer's chart and tables by the heading above each", async () => {
    const slides = await appendix([
      {
        id: "answer",
        heading: question,
        content:
          "## 各区域销售额\n\n```html\n<div id=\"chart\"></div>\n```\n\n| 区域 |\n|---|\n| 华东 |\n\n### 环比变化\n\n| 区域 | 环比 |\n|---|--:|\n| 华东 | 3% |",
      },
    ]);

    expect(slides).toEqual([
      { kind: "chart", title: "各区域销售额", footer: "报告摘要" },
      { kind: "table", title: "各区域销售额", footer: "报告摘要" },
      { kind: "table", title: "环比变化", footer: "报告摘要" },
    ]);
  });

  it("name them by the question's first line, cut to one line, where no heading is above", async () => {
    const slides = await appendix([
      { id: "long", heading: `${question}\n第二行补充`, content: "| 区域 |\n|---|\n| 华东 |" },
      { id: "short", heading: "按区域看销售额\n再看环比", content: "| 区域 |\n|---|\n| 华南 |" },
      { id: "dataset", heading: "华东销售明细", content: "", tables: [{ columns: ["区域"], rows: [["华东"]] }] },
    ]);

    expect(slides).toEqual([
      { kind: "table", title: "请把下面这段 **Markdown** 原样输出成表格，并且标出每个区域…", footer: "报告摘要" },
      { kind: "table", title: "按区域看销售额", footer: "报告摘要" },
      { kind: "table", title: "华东销售明细", footer: "报告摘要" },
    ]);
  });
});
