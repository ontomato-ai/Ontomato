// One source for the three chart skills: draw a chart file from one chart type, field roles and display settings.
import fs from "node:fs";
import path from "node:path";
import { chartMapResources, fillChartFile, legacyChartToFile, validateChartFile } from "@ontomato/contracts/chart-data";

const MAP_RESOURCE = "china-provinces";
const MAP_TYPES = ["leaflet-map", "map", "admin-choropleth-map"];
const GRAPH_INPUTS = ["object", "edges"];

function chartName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name))
    throw new Error("name must be a file name without directory separators");
  return name;
}

/** Model-provided rows: inline objects or one data file of the conversation workspace. */
function readRows(input) {
  if ((input.data === undefined) === (input.dataset === undefined))
    throw new Error("Provide either data rows or a dataset file");
  let rows = input.data;
  if (input.dataset !== undefined) {
    if (typeof input.dataset !== "string" || !input.dataset.trim())
      throw new Error("dataset must be a data file path");
    const file = JSON.parse(fs.readFileSync(input.dataset, "utf8"));
    rows = Array.isArray(file) ? file : file?.rows;
    if (!Array.isArray(rows))
      throw new Error("dataset file must be an array of rows or an object with a rows array");
  }
  if (!Array.isArray(rows) || !rows.length) throw new Error("Data has no rows");
  if (rows.some((row) => !row || typeof row !== "object" || Array.isArray(row)))
    throw new Error("Every data row must be an object");
  return rows;
}

function describeConversion(failure) {
  const details = failure.fields?.length ? `: ${failure.fields.join(", ")}` : "";
  return `Chart conversion failed (${failure.code})${details}`;
}

function describeValidation(failure) {
  return `Chart file is invalid: ${failure.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`;
}

function describeRows(failure) {
  return `Chart rows cannot be drawn (${failure.code}): ${failure.issues.map((issue) => `${issue.path.join(".")} ${issue.reason}: ${issue.message}`).join("; ")}`;
}

/**
 * The chart file for one skill. Rows stay exactly as read, projected to the columns the chart uses, so the
 * conversation preview and a later MetricView re-run draw the same rows.
 */
export function chartFile(input, skill = "echarts") {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Input must be an object");
  if (typeof input.chartType !== "string" || !input.chartType.trim()) throw new Error("chartType is required");
  const chartType = input.chartType.trim();
  if (skill === "leaflet" && chartType !== "leaflet-map")
    throw new Error("leaflet creates chartType leaflet-map only");
  if (skill === "admin-choropleth-map" && chartType !== "admin-choropleth-map")
    throw new Error("admin-choropleth-map creates chartType admin-choropleth-map only");
  if (skill === "echarts" && MAP_TYPES.includes(chartType))
    throw new Error("Use the leaflet or admin-choropleth-map skill for map charts");
  if (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields))
    throw new Error("fields must map chart roles to column names");
  if (input.graphInput !== undefined && !GRAPH_INPUTS.includes(input.graphInput))
    throw new Error('graphInput must be "object" or "edges"');
  if (input.source !== undefined && (!input.source || typeof input.source !== "object" || Array.isArray(input.source)))
    throw new Error("source must be an object");

  const rows = readRows(input);
  const map = skill === "echarts" ? undefined : {
    resource: MAP_RESOURCE, coordinateSystem: chartMapResources[MAP_RESOURCE], regionsMatched: true,
    ...(chartType === "admin-choropleth-map" && input.featureNameProperty !== undefined
      ? { featureNameProperty: input.featureNameProperty } : {}),
  };
  const converted = legacyChartToFile({
    type: chartType, fields: input.fields, display: input.display,
    seriesNames: input.seriesNames, axisNames: input.axisNames, graphInput: input.graphInput,
    ...(map ? { map } : {}),
  });
  if (!converted.ok) throw new Error(describeConversion(converted));

  const file = converted.file;
  const dimensions = file.dataset[0].dimensions;
  file.dataset[0].source = rows.map((row) => Object.fromEntries(dimensions.map((column) => [column, row[column]])));
  // The model names the source; a file without one is a conversation view and cannot join a dashboard.
  if (input.source !== undefined) file.ontomato = { ...file.ontomato, ...input.source };
  const valid = validateChartFile(file);
  if (!valid.ok) throw new Error(describeValidation(valid));
  // Filling is the platform's row and shape check; a file whose snapshot cannot be drawn is not written.
  const drawable = fillChartFile(structuredClone(valid.file), {
    columns: dimensions.map((key) => ({ key })), rows: valid.file.dataset[0].source,
  });
  if (!drawable.ok) throw new Error(describeRows(drawable));
  return valid.file;
}

/** Read one input file, write outputs/<name>.chart.json and print its path. */
export async function main(skill = "echarts") {
  try {
    const source = process.argv[2]?.replace(/^@/, "");
    if (!source) throw new Error("Usage: node scripts/index.mjs <input.json>");
    const input = JSON.parse(fs.readFileSync(source, "utf8"));
    const file = chartFile(input, skill);
    const root = process.env.ONTOMATO_OUTPUT_DIR || "outputs";
    fs.mkdirSync(root, { recursive: true });
    const output = path.join(root, `${chartName(input.name)}.chart.json`);
    fs.writeFileSync(output, `${JSON.stringify(file, null, 2)}\n`);
    console.log(path.relative(process.cwd(), path.resolve(output)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
