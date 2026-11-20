import { describe, expect, it } from "vitest";
import { citedDatasetPaths } from "../cited-datasets";

describe("citedDatasetPaths", () => {
  it("finds datasets cited in paragraphs, list items, table cells and quotes", () => {
    const answer = [
      "Conclusion ![Total](outputs/agents/t/total.dataset.json).",
      "",
      "- **Name**: Wu — [Names](outputs/agents/t/names.dataset.json)",
      "  - nested [Titles](outputs/agents/t/titles.dataset.json)",
      "",
      "| Field | Source |",
      "| --- | --- |",
      "| Grade | [Grades](outputs/metrics/grades.dataset.json) |",
      "",
      "> see [Works](outputs/agents/t/works.dataset.json)",
    ].join("\n");
    expect(citedDatasetPaths(answer).sort()).toEqual([
      "outputs/agents/t/names.dataset.json",
      "outputs/agents/t/titles.dataset.json",
      "outputs/agents/t/total.dataset.json",
      "outputs/agents/t/works.dataset.json",
      "outputs/metrics/grades.dataset.json",
    ]);
  });

  it("ignores code, other files and repeated citations", () => {
    const answer = [
      "[Chart](outputs/chart.chart.json) and [Names](outputs/a/names.dataset.json) again [Names](outputs/a/names.dataset.json)",
      "",
      "```",
      "[Hidden](outputs/a/hidden.dataset.json)",
      "```",
      "`outputs/a/inline.dataset.json`",
    ].join("\n");
    expect(citedDatasetPaths(answer)).toEqual(["outputs/a/names.dataset.json"]);
  });
});
