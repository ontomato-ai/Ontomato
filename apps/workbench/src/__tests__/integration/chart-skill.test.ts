import { describe, expect, it } from "vitest";

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// The generated chart skill ships with the shared service package's skills/ resources, outside the package export surface; located from the package root and loaded directly.
const serverRoot = dirname(dirname(createRequire(import.meta.url).resolve("@ontomato/workbench-server")));
const { chartFile } = await import(
  pathToFileURL(join(serverRoot, "skills/executable/visualization/echarts/scripts/index.mjs")).href
);

const rows = [
  { equipment_type: "A", temperature: 30 },
  { equipment_type: "B", temperature: 35 },
];

describe("echarts chart file skill", () => {
  it("writes a chart file from metric rows with the columns it uses", () => {
    const file = chartFile({
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

  it("rejects a role whose column is absent from the rows", () => {
    expect(() => chartFile({
      chartType: "bar",
      name: "broken",
      data: [{ equipment_type: "A" }],
      fields: { xAxis: "equipment_type", yAxis: "temperature" },
    })).toThrow(/temperature/);
  });
});
