import { describe, expect, it } from "vitest";
import { createApp, h, nextTick } from "vue";
import { parseProductMarkdown } from "@ontomato/markdown";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { reportHtml } from "@ontomato/workbench-server/services/analysis-agent/delivery/report-html";

// Pages and exports draw the one product Markdown (@ontomato/markdown), whose own test says how it reads a text. Here
// each drawing of the same text must show the same thing.
const drawings = [
  {
    name: "a page (MarkdownView)",
    draw: async (source: string) => {
      const element = document.createElement("div");
      createApp(() => h(MarkdownView, { content: source })).mount(element);
      await nextTick();
      return element;
    },
  },
  {
    name: "a PDF export (reportHtml)",
    draw: async (source: string) => {
      const element = document.createElement("div");
      element.innerHTML = reportHtml(parseProductMarkdown(source), new Map());
      return element;
    },
  },
];

describe.each(drawings)("$name draws the product Markdown", ({ draw }) => {
  it("breaks the line at a single newline and strikes through only between double tildes", async () => {
    const element = await draw("第一行\n第二行\n\n区间 1~2、3.08%~3.47%，~普通文本~，~~旧口径~~");

    expect(element.querySelectorAll("p")).toHaveLength(2);
    expect(element.querySelectorAll("p br")).toHaveLength(1);
    expect([...element.querySelectorAll("del, s")].map((node) => node.textContent)).toEqual(["旧口径"]);
    expect(element.textContent).toContain("区间 1~2、3.08%~3.47%，~普通文本~，");
  });

  it("shows syntax beyond GFM and raw HTML as written", async () => {
    const source = "2^10^ ==重点== ++新增++ $100 到 $200 见文献[1] \"引号\" -- <b>raw</b>";
    const element = await draw(source);

    expect(element.textContent?.trim()).toBe(source);
    expect(element.querySelector("sup, sub, mark, ins, b, .katex")).toBeNull();
  });

  it("makes bold text next to Chinese punctuation bold", async () => {
    const element = await draw("**“销售额”**增长");

    expect(element.querySelector("strong")?.textContent).toBe("“销售额”");
  });

  it("links what GFM links and leaves the rest as text", async () => {
    const element = await draw(
      "example.com main.py www.x.com https://example.com/a foo@bar.com\n访问www.example.com 查看\n联系foo@bar.com即可 ftp://files.example.com",
    );

    expect([...element.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "http://www.x.com",
      "https://example.com/a",
      "mailto:foo@bar.com",
      "http://www.example.com",
    ]);
  });

  it("keeps table cells and code as written", async () => {
    const element = await draw("| 区间 | 状态 |\n|---|---|\n| 1~2 | ~~停用~~ |\n\n```js\nconst range = \"1~2\"; // ~~kept~~\n```");

    expect([...element.querySelectorAll("th")].map((cell) => cell.textContent?.trim())).toEqual(["区间", "状态"]);
    const cells = element.querySelectorAll("td");
    expect(cells[0]?.textContent?.trim()).toBe("1~2");
    expect(cells[1]?.querySelector("del, s")?.textContent).toBe("停用");
    expect(element.querySelector("pre")?.textContent).toContain('const range = "1~2"; // ~~kept~~');
    expect(element.querySelector("pre del, pre s")).toBeNull();
  });
});
