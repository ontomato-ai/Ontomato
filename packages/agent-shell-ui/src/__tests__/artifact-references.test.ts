import { describe, expect, it } from "vitest";
import { getMarkdown, parseMarkdownToStructure } from "markstream-vue";
import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";
import { resolveArtifactRenderer } from "../artifacts";
import { runsAnalystAsk, skillOfCommand, stepActivity } from "../tools";
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

  it("looks up host override, then shell default by longest extension, then nothing", () => {
    const chart = { extensions: [".chart.json"], component: { name: "chart" } };
    const table = { extensions: [".csv", ".json"], component: { name: "table" } };
    const defaults = [table, chart];
    expect(resolveArtifactRenderer("outputs/q.chart.json", [], defaults)).toEqual({ component: chart.component, fallback: null });
    expect(resolveArtifactRenderer("outputs/q.JSON", [], defaults).component).toBe(table.component);
    expect(resolveArtifactRenderer("outputs/q.pdf", [], defaults).component).toBeNull();
    const report = { path: /^outputs\/report/, component: { name: "report" } };
    const csv = { extensions: [".csv"], component: { name: "csv" } };
    expect(resolveArtifactRenderer("outputs/report.csv", [csv, report], defaults)).toEqual({
      component: report.component,
      fallback: table.component,
    });
    expect(resolveArtifactRenderer("outputs/a.csv", [csv, report], defaults).component).toBe(csv.component);
  });

  it("names the skill whose script a bash command runs", () => {
    expect(skillOfCommand("python skills/ontomato-analyst/scripts/query.py --q x")).toBe("ontomato-analyst");
    expect(skillOfCommand("cd /w && node ./skills/report-writer/run.mjs")).toBe("report-writer");
    expect(skillOfCommand("python outputs/skills.py")).toBeNull();
  });

  it("reads a retrieval and its ask command from the same script", () => {
    const step = (command: string) => ({ toolName: "bash", skill: "ontomato-analyst", args: { command } });
    const retrieve = "cd skills/ontomato-analyst && node ontomato.mjs ask --question q";
    expect(stepActivity(step(retrieve))).toBe("retrieve");
    expect(runsAnalystAsk(retrieve)).toBe(true);
    // Reading the script is neither a retrieval nor a run of it.
    const reading = "cat skills/ontomato-analyst/ontomato.mjs";
    expect(stepActivity(step(reading))).toBe("run");
    expect(runsAnalystAsk(reading)).toBe(false);
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
