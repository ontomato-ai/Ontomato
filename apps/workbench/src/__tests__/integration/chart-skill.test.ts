import { describe, expect, it } from "vitest";

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// The generated chart skill ships with the shared service package's skills/ resources, outside the package export surface; located from the package root and loaded directly.
const serverRoot = dirname(dirname(createRequire(import.meta.url).resolve("@ontomato/workbench-server")));
const chartSkillEntry = join(serverRoot, "skills/executable/visualization/echarts/scripts/index.mjs");
if (!existsSync(chartSkillEntry)) {
  execFileSync(process.execPath, [join(serverRoot, "chart-skill/build.mjs")], { stdio: "inherit" });
}
const { chartFile } = await import(pathToFileURL(chartSkillEntry).href);

const rows = [
  { equipment_type: "A", temperature: 30 },
  { equipment_type: "B", temperature: 35 },
];

describe("echarts chart file skill", () => {
  it("writes a chart file from rows with the columns it uses", async () => {
    const file = await chartFile({
      chartType: "bar",
      name: "equipment-temperature",
      data: rows,
      fields: { xAxis: "equipment_type", yAxis: "temperature" },
      source: { metric: { metricId: "equipment-health", parameters: { line: "A" } } },
    });
    expect(file.dataset[0].source).toEqual(rows);
    expect(file.series[0]).toMatchObject({
      type: "bar",
      datasetId: "metric",
      encode: { x: "equipment_type", y: "temperature" },
    });
    expect(file.ontomato.metric).toEqual({ metricId: "equipment-health", parameters: { line: "A" } });
  });

  it("rejects a role whose column is absent from the rows", async () => {
    await expect(chartFile({
      chartType: "bar",
      name: "broken",
      data: [{ equipment_type: "A" }],
      fields: { xAxis: "equipment_type", yAxis: "temperature" },
    })).rejects.toThrow(/temperature/);
  });
});
