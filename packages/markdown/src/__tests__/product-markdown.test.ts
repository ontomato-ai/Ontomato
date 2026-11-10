import { describe, expect, it } from "vitest";
import { parseProductMarkdown, type LinkNode, type ParsedNode, type TextNode } from "../index";

// The content rendering spec, as the one definition pages and exports read a text with.

function all(nodes: readonly ParsedNode[]): ParsedNode[] {
  return nodes.flatMap((node) => {
    const record = node as unknown as Record<string, unknown>;
    const nested = ["children", "items", "rows", "cells"].flatMap((key) =>
      Array.isArray(record[key]) ? (record[key] as ParsedNode[]) : [],
    );
    if (node.type === "table") nested.unshift(record.header as ParsedNode);
    return [node, ...all(nested)];
  });
}

const types = (source: string) => new Set(all(parseProductMarkdown(source)).map((node) => node.type));
/** The text as read: its characters, with a line break where the text breaks the line. */
const text = (source: string) =>
  all(parseProductMarkdown(source))
    .map((node) => (node.type === "text" ? (node as TextNode).content : node.type === "hardbreak" ? "\n" : ""))
    .join("");
const links = (source: string) =>
  all(parseProductMarkdown(source))
    .filter((node) => node.type === "link")
    .map((node) => (node as LinkNode).href);

describe("the product Markdown", () => {
  it("breaks the line at a single newline", () => {
    expect(text("first\nsecond")).toBe("first\nsecond");
    expect(types("first\nsecond").has("hardbreak")).toBe(true);
  });

  it("strikes through only between double tildes", () => {
    const ranges = "53,630.26~60,326.74，日占比在3.08%~3.47%之间，保留 ~普通文本~";
    expect(text(ranges)).toBe(ranges);
    expect(types(ranges).has("strikethrough")).toBe(false);
    expect(types(ranges).has("subscript")).toBe(false);

    expect(text("保留 ~~删除的问题~~")).toBe("保留 删除的问题");
    expect(types("保留 ~~删除的问题~~").has("strikethrough")).toBe(true);
  });

  it.each([
    ["superscript", "2^10^", "2^10^"],
    ["highlight", "==重点==", "==重点=="],
    ["insertion", "++新增++", "++新增++"],
    ["inline math and amounts", "质能 $E=mc^2$，预算 $100 到 $200", "质能 $E=mc^2$，预算 $100 到 $200"],
    ["a math block", "$$\nE=mc^2\n$$", "$$\nE=mc^2\n$$"],
    ["a bracketed math block", "\\[\nx^2\n\\]", "[\nx^2\n]"],
    ["an inline footnote", "正文^[内联脚注]", "正文^[内联脚注]"],
    ["a ::: container", "::: tip\n提示内容\n:::", "::: tip\n提示内容\n:::"],
    ["a citation", "见文献[1]和[2]", "见文献[1]和[2]"],
    ["typographic replacements", "\"引号\" -- (c) ... +- 'single'", "\"引号\" -- (c) ... +- 'single'"],
    ["raw HTML", "<b>raw</b> 和 <br>\n\n<div>block</div>", "<b>raw</b> 和 <br><div>block</div>"],
  ])("shows %s as written", (_syntax, source, written) => {
    expect(text(source)).toBe(written);
  });

  it("reads a footnote definition as the link definition GFM has", () => {
    expect(text("正文[^1]\n\n[^1]: 脚注内容")).toBe("正文^1");
    expect(text("见[文档][1]\n\n[1]: https://example.com/doc")).toBe("见文档");
    expect(links("见[文档][1]\n\n[1]: https://example.com/doc")).toEqual(["https://example.com/doc"]);
  });

  it("links a bare address only with a scheme, after www. or as an email address", () => {
    expect(
      links("README.md main.py deploy.sh example.com\nwww.x.com https://example.com/a foo@bar.com\n访问www.example.com 查看"),
    ).toEqual(["http://www.x.com", "https://example.com/a", "mailto:foo@bar.com", "http://www.example.com"]);
  });

  it("leaves as text an email touching Chinese, an ftp:// address and www. after Chinese within a line", () => {
    expect(links("联系foo@bar.com即可")).toEqual([]);
    expect(links("ftp://files.example.com")).toEqual([]);
    expect(links("foo@bar.com 访问www.example.com")).toEqual(["mailto:foo@bar.com"]);
  });

  it("makes bold text next to Chinese punctuation bold", () => {
    expect(types("**“销售额”**增长").has("strong")).toBe(true);
    expect(text("**“销售额”**增长")).toBe("“销售额”增长");
  });
});
