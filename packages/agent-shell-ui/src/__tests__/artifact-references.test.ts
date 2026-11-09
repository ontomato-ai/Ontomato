import { describe, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, type PropType } from "vue";
import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { resolveArtifactRenderer } from "../artifacts";
import { runsAnalystAsk, skillOfCommand, stepActivity } from "../tools";

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

  it("keeps unclosed references pending while streaming", async () => {
    // Stand-ins for the shell's artifact nodes: they show what MarkdownView hands them.
    const reference = defineComponent({
      props: { node: { type: Object as PropType<{ href?: string; src?: string; loading?: boolean }>, required: true } },
      setup: (props) => () =>
        h("span", { class: "reference", "data-loading": String(Boolean(props.node.loading)) }, props.node.href ?? props.node.src),
    });
    const nodes = { link: reference, image: reference };
    const draw = async (content: string, final: boolean) => {
      const element = document.createElement("div");
      createApp(() => h(MarkdownView, { content, final, nodes })).mount(element);
      await nextTick();
      return element.querySelector(".reference")!;
    };
    expect((await draw("![Sales](outputs/sal", false)).getAttribute("data-loading")).toBe("true");
    const settled = await draw("a [Report](outputs/r.md)", true);
    expect(settled.getAttribute("data-loading")).toBe("false");
    expect(settled.textContent).toBe("outputs/r.md");
  });
});
