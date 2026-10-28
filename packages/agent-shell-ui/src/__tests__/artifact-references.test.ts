import { describe, expect, it } from "vitest";
import { getMarkdown, parseMarkdownToStructure } from "markstream-vue";
import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";
import { rendererFor } from "../artifacts";
import { shellParseOptions } from "../markdown";

/** The artifact Markdown contract: which destinations are files, and which renderer gets them. */
describe("artifact references", () => {
  it("accepts only workspace outputs paths", () => {
    expect(artifactPath("outputs/sales.chart.json")).toBe("outputs/sales.chart.json");
    expect(artifactPath("./outputs/a%20b.csv")).toBe("outputs/a b.csv");
    expect(artifactPath("outputs/../secret")).toBeNull();
    expect(artifactPath("/outputs/x.png")).toBeNull();
    expect(artifactPath("https://example.com/outputs/x.png")).toBeNull();
    expect(artifactPath("outputs/")).toBeNull();
  });

  it("dispatches by the longest registered extension", () => {
    const chart = { extensions: [".chart.json"], component: {} };
    const table = { extensions: [".csv", ".json"], component: {} };
    const renderers = [table, chart];
    expect(rendererFor("outputs/q.chart.json", renderers)).toBe(chart);
    expect(rendererFor("outputs/q.JSON", renderers)).toBe(table);
    expect(rendererFor("outputs/q.pdf", renderers)).toBeNull();
  });

  it("keeps unclosed references pending while streaming and line breaks as breaks", () => {
    const parse = (source: string, final: boolean) =>
      parseMarkdownToStructure(source, getMarkdown(), { ...shellParseOptions, final });
    const [streaming] = parse("![Sales](outputs/sal", false) as { children: { type: string; loading?: boolean }[] }[];
    expect(streaming!.children.at(-1)).toMatchObject({ type: "image", loading: true });
    const [settled] = parse("a\nb [Report](outputs/r.md)", true) as {
      children: { type: string; href?: string; loading?: boolean }[];
    }[];
    expect(settled!.children.map((node) => node.type)).toEqual(["text", "hardbreak", "text", "link"]);
    expect(settled!.children.at(-1)).toMatchObject({ href: "outputs/r.md", loading: false });
  });
});
