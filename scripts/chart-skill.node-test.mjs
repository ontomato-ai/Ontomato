import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = path.join(root, "packages/workbench-server");
const visualization = path.join(server, "skills/executable/visualization");
const run = promisify(execFile);

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chart-skill-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function cli(directory, skill, input) {
  await writeFile(path.join(directory, "input.json"), JSON.stringify(input));
  return run(process.execPath, [path.join(visualization, skill, "scripts/index.mjs"), "input.json"], { cwd: directory });
}

async function chart(directory, name) {
  return JSON.parse(await readFile(path.join(directory, "outputs", `${name}.chart.json`), "utf8"));
}

test("committed chart skill packages match the shared source", async (t) => {
  const output = await workspace(t);
  await run(process.execPath, [path.join(server, "chart-skill/build.mjs"), output], { cwd: root });
  for (const skill of ["echarts", "leaflet", "admin-choropleth-map"]) {
    const files = ["scripts/index.mjs", "licenses/zod-LICENSE.txt"];
    if (skill === "admin-choropleth-map") files.push("licenses/china-provinces-README.md");
    for (const file of files) {
      const generated = await readFile(path.join(output, skill, file));
      const committed = await readFile(path.join(visualization, skill, file));
      assert.equal(Buffer.compare(generated, committed), 0,
        `${skill}/${file} is stale: run pnpm --filter @ontomato/workbench-server build:chart-skill`);
    }
  }
});

test("echarts writes a chart file with the used columns and a MetricView reference", async (t) => {
  const directory = await workspace(t);
  await writeFile(path.join(directory, "staff.dataset.json"), JSON.stringify({
    columns: [{ key: "department" }, { key: "headcount" }, { key: "note" }],
    rows: [{ department: "Computing", headcount: 50, note: "detail" }, { department: "Languages", headcount: 32, note: "detail" }],
  }));
  const result = await cli(directory, "echarts", {
    chartType: "bar", name: "staff", dataset: "staff.dataset.json",
    fields: { xAxis: "department", yAxis: "headcount" },
    display: { sort: [{ field: "headcount", order: "desc" }] },
    source: { metric: { metricId: "metric-1", parameters: { year: 2025 } } },
  });
  assert.equal(result.stdout.trim(), path.join("outputs", "staff.chart.json"));
  const file = await chart(directory, "staff");
  assert.deepEqual(file.dataset[0].dimensions, ["department", "headcount"]);
  assert.deepEqual(file.dataset[0].source, [{ department: "Computing", headcount: 50 }, { department: "Languages", headcount: 32 }]);
  assert.equal(file.series[0].type, "bar");
  assert.deepEqual(file.series[0].encode, { x: "department", y: "headcount" });
  assert.deepEqual(file.ontomato.metric, { metricId: "metric-1", parameters: { year: 2025 } });
});

test("a chart may reference the accepted dataset it read instead of a MetricView", async (t) => {
  const directory = await workspace(t);
  const file = await cli(directory, "echarts", {
    chartType: "line", name: "trend", data: [{ month: "2025-01", amount: 1 }],
    fields: { xAxis: "month", yAxis: "amount" },
    source: { dataset: { path: "outputs/trend.dataset.json" } },
  }).then(() => chart(directory, "trend"));
  assert.deepEqual(file.ontomato.dataset, { path: "outputs/trend.dataset.json" });
  assert.equal(file.ontomato.metric, undefined);
});

test("a titled ranked preview puts its title in the ECharts option", async (t) => {
  const directory = await workspace(t);
  const title = "Staff by department";
  await cli(directory, "echarts", {
    chartType: "bar", name: "staff-preview", title,
    data: [{ department: "Computing", headcount: 50 }, { department: "Languages", headcount: 32 }],
    fields: { xAxis: "department", yAxis: "headcount" },
    display: { sort: [{ field: "headcount", order: "desc" }], displayLimit: 1 },
  });
  const file = await chart(directory, "staff-preview");
  assert.equal(file.title?.text, title);
  assert.equal(Object.hasOwn(file.ontomato, "metadata"), false);
  assert.equal(file.ontomato.display.displayLimit, 1);
  assert.equal(file.dataset[0].source.length, 2);
});

test("a read dataset is recorded as the source when no source is given", async (t) => {
  const directory = await workspace(t);
  await writeFile(path.join(directory, "staff.dataset.json"), JSON.stringify({
    rows: [{ department: "Computing", headcount: 50 }],
  }));
  await cli(directory, "echarts", {
    chartType: "bar", name: "from-file", dataset: "staff.dataset.json",
    fields: { xAxis: "department", yAxis: "headcount" },
  });
  const file = await chart(directory, "from-file");
  assert.deepEqual(file.ontomato.dataset, { path: "staff.dataset.json" });
  assert.equal(file.ontomato.metric, undefined);
});

test("heatmap keeps two category axes and a value scale", async (t) => {
  const directory = await workspace(t);
  await cli(directory, "echarts", {
    chartType: "heatmap", name: "heat",
    data: [{ day: "Mon", hour: "09", amount: 3 }, { day: "Mon", hour: "10", amount: 7 }],
    fields: { xAxis: "hour", yAxis: "day", value: "amount" },
  });
  const file = await chart(directory, "heat");
  assert.equal(file.xAxis.type, "category");
  assert.equal(file.yAxis.type, "category");
  assert.equal(file.series[0].type, "heatmap");
  assert.deepEqual(file.series[0].encode, { x: "hour", y: "day", value: "amount" });
  assert.deepEqual(file.visualMap, { type: "continuous", dimension: "amount", seriesIndex: 0 });
});

test("leaflet writes a WGS-84 point map on the bundled province resource", async (t) => {
  const directory = await workspace(t);
  await cli(directory, "leaflet", {
    chartType: "leaflet-map", name: "stores",
    data: [{ lng: 121.436, lat: 31.188, store: "Xuhui", sales: 128000 }],
    fields: { lng: "lng", lat: "lat", name: "store", value: "sales" },
  });
  const file = await chart(directory, "stores");
  assert.deepEqual(file.geo, { map: "china-provinces", roam: true });
  assert.equal(file.series[0].coordinateSystem, "geo");
  assert.deepEqual(file.series[0].encode, { lng: "lng", lat: "lat", itemName: "store", value: "sales", tooltip: ["store", "sales"] });
  assert.deepEqual(file.visualMap, { type: "continuous", dimension: "sales", seriesIndex: 0, show: false, inRange: { symbolSize: [6, 40] } });
});

test("admin-choropleth-map matches a chosen boundary property", async (t) => {
  const directory = await workspace(t);
  await cli(directory, "admin-choropleth-map", {
    chartType: "admin-choropleth-map", name: "province-sales", featureNameProperty: "fullname",
    data: [{ province: "北京市", sales: 120 }, { province: "广东省", sales: 260 }],
    fields: { name: "province", value: "sales" },
  });
  const file = await chart(directory, "province-sales");
  assert.equal(file.series[0].type, "map");
  assert.equal(file.series[0].nameProperty, "fullname");
  assert.deepEqual(file.visualMap, { type: "continuous", dimension: "sales", seriesIndex: 0 });
});

test("admin-choropleth-map reports every region absent from the bundled boundaries", async (t) => {
  const directory = await workspace(t);
  await assert.rejects(cli(directory, "admin-choropleth-map", {
    chartType: "admin-choropleth-map", name: "unknown-regions",
    data: [{ province: "北京", sales: 1 }, { province: "不存在省", sales: 2 }],
    fields: { name: "province", value: "sales" },
  }), (error) => {
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /china-provinces/);
    assert.match(error.stderr, /不存在省/);
    return true;
  });
  await assert.rejects(readFile(path.join(directory, "outputs", "unknown-regions.chart.json")));
});

test("a missing role fails with the conversion code and the role name", async (t) => {
  const directory = await workspace(t);
  await assert.rejects(cli(directory, "echarts", {
    chartType: "bar", name: "broken", data: [{ department: "Computing" }], fields: { xAxis: "department" },
  }), (error) => {
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /MISSING_FIELDS/);
    assert.match(error.stderr, /yAxis/);
    return true;
  });
});

test("rows that cannot be drawn are rejected before a file is written", async (t) => {
  const directory = await workspace(t);
  await assert.rejects(cli(directory, "echarts", {
    chartType: "sunburst", name: "broken-tree",
    data: [{ id: "a", parent: null, name: "A", value: 1 }, { id: "a", parent: null, name: "B", value: 2 }],
    fields: { id: "id", parent: "parent", name: "name", value: "value" },
  }), (error) => {
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /INVALID_SHAPE_DATA/);
    assert.match(error.stderr, /DUPLICATE_TREE_ID/);
    return true;
  });
  await assert.rejects(readFile(path.join(directory, "outputs", "broken-tree.chart.json")));
});

test("a chart file accepts one source reference, not two", async (t) => {
  const directory = await workspace(t);
  await assert.rejects(cli(directory, "echarts", {
    chartType: "bar", name: "two-sources", data: [{ department: "A", headcount: 1 }],
    fields: { xAxis: "department", yAxis: "headcount" },
    source: { metric: { metricId: "metric-1", parameters: {} }, dataset: { path: "outputs/a.dataset.json" } },
  }), (error) => {
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /exactly one/);
    return true;
  });
});

test("source cannot carry drawing metadata", async (t) => {
  const directory = await workspace(t);
  await assert.rejects(cli(directory, "echarts", {
    chartType: "bar", name: "bad-source", data: [{ department: "A", headcount: 1 }],
    fields: { xAxis: "department", yAxis: "headcount" },
    source: { metric: { metricId: "metric-1", parameters: {} }, display: {} },
  }), (error) => {
    assert.notEqual(error.code, 0);
    assert.match(error.stderr, /exactly one/);
    return true;
  });
});
