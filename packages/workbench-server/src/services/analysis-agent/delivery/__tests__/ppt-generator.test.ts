import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { configureI18n } from "../../../../i18n";
import { appTextEn } from "../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../i18n/locales/en";
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
