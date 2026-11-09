import { describe, expect, it } from "vitest";
import { createApp, h, nextTick } from "vue";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { marked } from "@ontomato/workbench-server/services/analysis-agent/delivery/marked";

// The content rendering spec: a text means the same in every page and in the server's PDF and PPT exports.
const entries = [
  {
    name: "pages (MarkdownView)",
    render: async (source: string) => {
      const element = document.createElement("div");
      createApp(() => h(MarkdownView, { content: source })).mount(element);
      await nextTick();
      return element;
    },
  },
  {
    name: "server exports (marked)",
    render: async (source: string) => {
      const element = document.createElement("div");
      element.innerHTML = marked.parse(source) as string;
      return element;
    },
  },
];

describe.each(entries)("$name read the product Markdown dialect", ({ render }) => {
  it("keeps repeated single-tilde numeric ranges literal", async () => {
    const element = await render("53,630.26~60,326.74，日占比在3.08%~3.47%之间，销售量介于50,883.02~67,397.23");

    expect(element.querySelector("del, s, sub")).toBeNull();
    expect(element.textContent).toContain("53,630.26~60,326.74，日占比在3.08%~3.47%之间，销售量介于50,883.02~67,397.23");
  });

  it("treats only double tildes as strikethrough", async () => {
    const single = await render("保留 ~普通文本~");
    expect(single.querySelector("del, s, sub")).toBeNull();
    expect(single.textContent).toContain("保留 ~普通文本~");

    const double = await render("保留 ~~删除的问题~~");
    expect(double.querySelector("del, s")?.textContent).toBe("删除的问题");
  });

  it("breaks the line at a single newline", async () => {
    const element = await render("first\nsecond");

    expect(element.querySelectorAll("p")).toHaveLength(1);
    expect(element.querySelectorAll("p br")).toHaveLength(1);
    expect(element.textContent?.trim()).toBe("firstsecond");
  });

  it("keeps table cells and code as written", async () => {
    const element = await render("| 区间 | 状态 |\n|---|---|\n| 1~2 | ~~停用~~ |\n\n```js\nconst range = \"1~2\"; // ~~kept~~\n```");

    expect([...element.querySelectorAll("th")].map((cell) => cell.textContent?.trim())).toEqual(["区间", "状态"]);
    const cells = element.querySelectorAll("td");
    expect(cells[0]?.textContent?.trim()).toBe("1~2");
    expect(cells[1]?.querySelector("del, s")?.textContent).toBe("停用");
    expect(element.querySelector("pre")?.textContent).toContain('const range = "1~2"; // ~~kept~~');
    expect(element.querySelector("pre del, pre s")).toBeNull();
  });
});
