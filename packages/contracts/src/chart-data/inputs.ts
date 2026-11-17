export type ChartInputRoles = {
  required: string[];
  numeric: string[];
  arrays?: string[];
  // Native chart conversion also accepts these scalar roles as multiple series.
  optionalArrays?: string[];
  optional?: string[];
  singleRow?: boolean;
};
type ChartInputs = ChartInputRoles & { inputs?: Record<"object" | "edges", ChartInputRoles> };
const graphInputs: ChartInputs = {
  required: [], numeric: [],
  inputs: {
    object: { required: ["nodes", "links"], numeric: [], singleRow: true },
    edges: {
      required: ["source", "target"], numeric: ["value"],
      optional: ["value", "relation", "sourceName", "targetName", "sourceCategory", "targetCategory"],
    },
  },
};

/** Roles name final MetricView columns; numeric roles never request a calculation. */
export const chartInputs: Record<string, ChartInputs> = {
  bar: { required: ["xAxis", "yAxis"], numeric: ["yAxis"], optionalArrays: ["yAxis"] },
  line: { required: ["xAxis", "yAxis"], numeric: ["yAxis"], optionalArrays: ["yAxis"] },
  "area-line": { required: ["xAxis", "yAxis"], numeric: ["yAxis"], optionalArrays: ["yAxis"] },
  "pictorial-bar": { required: ["xAxis", "yAxis"], numeric: ["yAxis"], optionalArrays: ["yAxis"] },
  "bar-line": { required: ["xAxis", "barSeries", "lineSeries"], numeric: ["barSeries", "lineSeries"], arrays: ["barSeries"] },
  pie: { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  donut: { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  "nightingale-rose": { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  treemap: { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  funnel: { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  sankey: { required: ["source", "target", "value"], numeric: ["value"] },
  scatter: { required: ["xAxis", "yAxis"], numeric: ["xAxis", "yAxis", "size"], optional: ["name", "size"] },
  radar: { required: ["name", "value"], numeric: ["value"] },
  sunburst: { required: ["id", "parent", "name", "value"], numeric: ["value", "share"], optional: ["share"] },
  boxplot: { required: ["category", "min", "q1", "median", "q3", "max"], numeric: ["min", "q1", "median", "q3", "max"] },
  gauge: { required: ["value"], numeric: ["value"], singleRow: true },
  "liquid-fill": { required: ["value"], numeric: ["value"], singleRow: true },
  timeline: { required: ["date", "name", "description"], numeric: [] },
  graph: graphInputs,
  "network-graph": graphInputs,
  "leaflet-map": { required: ["lng", "lat", "name"], numeric: ["lng", "lat", "value"], optional: ["value"] },
  map: { required: ["lng", "lat", "name"], numeric: ["lng", "lat", "value"], optional: ["value"] },
  "admin-choropleth-map": { required: ["name", "value"], numeric: ["value"] },
};
