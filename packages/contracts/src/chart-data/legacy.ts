import { z } from "zod";
import { chartInputs } from "./inputs";
import { chartMapResources } from "./maps";
import { chartDisplaySchema, type ChartDisplay } from "./display";
import { chartFileSchema, type ChartBinding, type ChartFile, type ChartOption } from "./schema";

export type ChartConversionCode =
  | "UNSUPPORTED_CHART_TYPE" | "MISSING_FIELDS" | "INVALID_FIELD_MAPPING" | "MISSING_QUARTILE_COLUMNS" | "PERCENT_SCALE_REQUIRED"
  | "CUSTOM_SKILL" | "CUSTOM_SCRIPT" | "HTML_ONLY" | "CUSTOM_GRAPH_CALLBACK" | "MULTIPLE_DATA_SOURCES" | "BUSINESS_AGGREGATION_REQUIRED"
  | "GRAPH_INPUT_REQUIRED" | "MAP_RESOURCE_MISSING" | "MAP_COORDINATE_MISMATCH" | "MAP_REGION_MISMATCH";
export type ChartConversionFailure = { ok: false; code: ChartConversionCode; fields?: string[]; details?: string[] };
export type LegacyChartSpec = {
  type: string;
  fields: Record<string, string | string[]>;
  display?: ChartDisplay;
  seriesNames?: Record<string, string>;
  axisNames?: { x?: string; y?: string; y2?: string };
  graphInput?: "object" | "edges";
  graph?: { layout?: "force" | "circular" | "none"; directed?: boolean; showRelationLabels?: boolean };
  map?: { resource: string; coordinateSystem: string; regionsMatched: boolean; featureNameProperty?: string };
  provenance?: {
    kind?: "standard" | "custom-skill" | "custom-script" | "html";
    multipleDataSources?: boolean; businessAggregation?: boolean; graphCallbacks?: string[];
  };
};
const fieldMapSchema = z.record(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]));
/** Conversion consumes drawing roles, never a dashboard, object view or product storage record. */
export function legacyChartToFile(input: LegacyChartSpec): { ok: true; file: ChartFile } | ChartConversionFailure {
  const fail = (code: ChartConversionCode, fields?: string[], details?: string[]): ChartConversionFailure => ({ ok: false, code, ...(fields ? { fields } : {}), ...(details ? { details } : {}) });
  const origin = input.provenance;
  if (origin?.kind === "custom-skill") return fail("CUSTOM_SKILL");
  if (origin?.kind === "custom-script") return fail("CUSTOM_SCRIPT");
  if (origin?.kind === "html") return fail("HTML_ONLY");
  if (origin?.multipleDataSources) return fail("MULTIPLE_DATA_SOURCES");
  if (origin?.businessAggregation) return fail("BUSINESS_AGGREGATION_REQUIRED");
  if (origin?.graphCallbacks?.length) return fail("CUSTOM_GRAPH_CALLBACK", undefined, origin.graphCallbacks);
  const type = input.type;
  const inputs = chartInputs[type];
  if (!inputs) return fail("UNSUPPORTED_CHART_TYPE", undefined, [type]);
  if (inputs.inputs && !input.graphInput) return fail("GRAPH_INPUT_REQUIRED");
  const spec = inputs.inputs ? inputs.inputs[input.graphInput!] : inputs;
  const mapped = fieldMapSchema.safeParse(input.fields);
  if (!mapped.success) return fail("INVALID_FIELD_MAPPING", undefined, mapped.error.issues.map(issue => issue.path.join(".")));
  const missing = spec.required.filter(role => input.fields[role] === undefined);
  if (missing.length) return fail(type === "boxplot" ? "MISSING_QUARTILE_COLUMNS" : "MISSING_FIELDS", missing);
  const selectedRoles = [...spec.required, ...(spec.optional ?? []).filter(role => input.fields[role] !== undefined)];
  const invalid = selectedRoles.filter(role => Array.isArray(input.fields[role]) && !(spec.arrays?.includes(role) || spec.optionalArrays?.includes(role)));
  if (invalid.length) return fail("INVALID_FIELD_MAPPING", invalid);
  const display = chartDisplaySchema.safeParse(input.display ?? {});
  if (!display.success) {
    const percentFields = Object.entries(input.display?.formats ?? {}).filter(([, format]) => format.kind === "percent" && format.scale === undefined).map(([field]) => field);
    return percentFields.length ? fail("PERCENT_SCALE_REQUIRED", percentFields) : fail("INVALID_FIELD_MAPPING", undefined, display.error.issues.map(issue => issue.path.join(".")));
  }
  const f = input.fields as Record<string, string>;
  if ((type === "gauge" || type === "liquid-fill") && !display.data.formats?.[f.value]) return fail("PERCENT_SCALE_REQUIRED", [f.value]);
  if (["leaflet-map", "map", "admin-choropleth-map"].includes(type)) {
    const map = input.map;
    if (!map || !Object.hasOwn(chartMapResources, map.resource)) return fail("MAP_RESOURCE_MISSING");
    if (map.coordinateSystem !== chartMapResources[map.resource]) return fail("MAP_COORDINATE_MISMATCH");
    if (!map.regionsMatched) return fail("MAP_REGION_MISMATCH");
  }
  const dimensions = [...new Set([
    ...selectedRoles.flatMap(role => [input.fields[role]].flat()),
    ...(display.data.sort ?? []).map(sort => sort.field), ...Object.keys(display.data.formats ?? {}),
  ])];
  const option: ChartOption = {
    dataset: [{ id: "metric", dimensions, source: [] }], series: [],
    ontomato: { display: display.data }, tooltip: { trigger: "item" },
  };
  const seriesName = (field: string) => input.seriesNames?.[field] ?? field;
  const nativeSeries = (id: string, kind: string, encode: Record<string, string | string[]>, settings: ChartOption = {}) => {
    option.series.push({ id, type: kind, datasetId: "metric", encode, ...settings });
  };
  const bind = (kind: string, shape: ChartBinding["shape"], fields: Record<string, string>, settings: ChartOption = {}, id = "main") => {
    option.series.push({ id, type: kind, ...settings });
    option.ontomato.bindings = [...(option.ontomato.bindings ?? []), { seriesId: id, shape, fields }];
  };
  const selectedFields = Object.fromEntries(selectedRoles.map(role => [role, f[role]]));
  const axes = () => {
    option.xAxis = { type: "category", ...(input.axisNames?.x ? { name: input.axisNames.x } : {}) };
    option.yAxis = { type: "value", ...(input.axisNames?.y ? { name: input.axisNames.y } : {}) };
    option.tooltip = { trigger: "axis" };
  };
  switch (type) {
    case "bar": case "line": case "area-line": case "pictorial-bar": {
      axes();
      const kind = type === "bar" || type === "pictorial-bar" ? "bar" : "line";
      const values = [input.fields.yAxis].flat();
      for (const [index, field] of values.entries()) nativeSeries(`series-${index}`, kind, { x: f.xAxis, y: field }, {
        name: seriesName(field), ...(type === "area-line" ? { areaStyle: {} } : {}),
        ...(kind === "line" ? { smooth: true } : { barMaxWidth: 48 }),
      });
      option.legend = { show: values.length > 1 };
      break;
    }
    case "bar-line": {
      axes();
      option.yAxis = [option.yAxis, { type: "value", ...(input.axisNames?.y2 ? { name: input.axisNames.y2 } : {}) }];
      for (const [index, field] of [input.fields.barSeries].flat().entries()) nativeSeries(`bar-${index}`, "bar", { x: f.xAxis, y: field }, { name: seriesName(field), yAxisIndex: 0, barMaxWidth: 32 });
      nativeSeries("line", "line", { x: f.xAxis, y: f.lineSeries }, { name: seriesName(f.lineSeries), yAxisIndex: 1, smooth: true });
      option.legend = { show: true };
      break;
    }
    case "pie": case "donut": case "nightingale-rose": case "funnel": {
      nativeSeries("main", type === "funnel" ? "funnel" : "pie", { itemName: f.name, value: f.value, tooltip: [f.value, ...(f.share ? [f.share] : [])] },
        type === "funnel" ? { sort: "none" } : {
          radius: type === "donut" ? ["42%", "76%"] : type === "nightingale-rose" ? ["35%", "60%"] : "60%",
          ...(type === "nightingale-rose" ? { roseType: "radius" } : {}),
        });
      break;
    }
    case "treemap": bind("treemap", "items", selectedFields, { breadcrumb: { show: false }, roam: false, nodeClick: false }); break;
    case "sunburst": bind("sunburst", "tree", selectedFields, { sort: null, radius: ["10%", "88%"], nodeClick: false }); break;
    case "sankey": bind("sankey", "links", selectedFields, { nodeAlign: "justify", emphasis: { focus: "adjacency" } }); break;
    case "scatter": {
      axes(); option.xAxis.type = "value";
      nativeSeries("main", "scatter", { x: f.xAxis, y: f.yAxis, ...(f.name ? { itemName: f.name } : {}), tooltip: [f.xAxis, f.yAxis, ...(f.size ? [f.size] : [])] }, { symbolSize: 10 });
      if (f.size) option.visualMap = { type: "continuous", dimension: f.size, seriesIndex: 0, show: false, inRange: { symbolSize: [6, 40] } };
      break;
    }
    case "radar": option.radar = { radius: "68%" }; bind("radar", "radar", selectedFields, { name: seriesName(f.value) }); break;
    case "boxplot": axes(); bind("boxplot", "boxplot", selectedFields); break;
    case "gauge": case "liquid-fill":
      option.tooltip = { show: false };
      bind("gauge", "single", selectedFields, {
        name: seriesName(f.value), startAngle: 90, endAngle: -270, radius: "75%", min: 0, max: 1,
        progress: { show: display.data.formats![f.value].kind === "percent", roundCap: true, width: 18 }, axisLine: { roundCap: true, lineStyle: { width: 18 } },
        axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
        detail: { show: true, fontSize: 34, fontWeight: 700, offsetCenter: [0, 0] },
      });
      break;
    case "timeline":
      option.xAxis = { type: "value", show: false, min: 0, max: 1 };
      option.yAxis = { type: "category", show: false, inverse: true, boundaryGap: true };
      bind("line", "timeline", selectedFields, { symbol: "none", silent: true }, "timeline-line");
      bind("scatter", "timeline", selectedFields, { symbolSize: 10, label: { show: true, position: "right", distance: 16, lineHeight: 19 } }, "timeline-events");
      break;
    case "graph": case "network-graph": {
      bind("graph", "graph", selectedFields, {
        layout: input.graph?.layout ?? "force", roam: true, draggable: true, selectedMode: "single", emphasis: { focus: "adjacency" },
        edgeSymbol: input.graph?.directed === false ? ["none", "none"] : ["none", "arrow"], edgeSymbolSize: 8,
        edgeLabel: { show: input.graph?.showRelationLabels ?? false }, label: { show: true, position: "right" },
        ...(input.graph?.layout === "circular" || input.graph?.layout === "none" ? {} : { force: { repulsion: 120, edgeLength: [55, 150], gravity: 0.08, friction: 0.6 } }),
      });
      option.ontomato.bindings[0].input = input.graphInput;
      break;
    }
    case "leaflet-map": case "map":
      option.geo = { map: input.map!.resource, roam: true };
      nativeSeries("main", "scatter", { lng: f.lng, lat: f.lat, itemName: f.name, ...(f.value ? { value: f.value, tooltip: [f.name, f.value] } : {}) }, { coordinateSystem: "geo", symbolSize: 10 });
      break;
    case "admin-choropleth-map":
      nativeSeries("main", "map", { itemName: f.name, value: f.value }, { map: input.map!.resource, roam: true, ...(input.map!.featureNameProperty ? { nameProperty: input.map!.featureNameProperty } : {}) });
      option.visualMap = { type: "continuous", dimension: f.value, seriesIndex: 0 };
      break;
  }
  return { ok: true, file: chartFileSchema.parse(option) };
}
