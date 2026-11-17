import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema, type RuntimeJsonValue } from "../agent-runtime-values";
import type { ChartDisplay } from "./display";
import {
  chartExecutionIssues, chartMetricColumnSchema, validateChartFile, zodIssues,
  type ChartBinding, type ChartFailure, type ChartFile, type ChartIssue, type ChartMetricColumn, type ChartOption, type ChartRow,
} from "./schema";

const metricRowsSchema = z.object({ columns: z.array(chartMetricColumnSchema), rows: z.array(runtimeJsonObjectSchema) });
const identitySchema = z.union([z.string().min(1), z.number().finite()]);
const numericSchema = z.union([z.number().finite(), z.string().min(1).refine(value => value.trim() !== "" && Number.isFinite(Number(value)))]);
const nodeSchema = z.object({
  id: identitySchema, name: z.string().optional(), category: z.union([z.string(), z.number()]).optional(),
  label: z.union([z.string(), runtimeJsonObjectSchema]).optional(), group: z.union([z.string(), z.number()]).optional(),
  value: runtimeJsonValueSchema.optional(), symbolSize: z.number().finite().positive().optional(),
  x: z.number().finite().optional(), y: z.number().finite().optional(),
}).catchall(runtimeJsonValueSchema);
const linkSchema = z.object({
  source: identitySchema, target: identitySchema, value: numericSchema.nullable().optional(), relation: z.string().optional(),
  label: z.union([z.string(), runtimeJsonObjectSchema]).optional(), weight: numericSchema.nullable().optional(),
}).catchall(runtimeJsonValueSchema);
type GraphNode = z.infer<typeof nodeSchema>;
type GraphLink = z.infer<typeof linkSchema>;

function shapeIssues(binding: ChartBinding, rows: ChartRow[], file: ChartFile): ChartIssue[] {
  const issues: ChartIssue[] = [];
  const add = (index: number, field: string, reason: string, message: string) => issues.push({ path: ["rows", index, field], reason, message });
  const test = (index: number, field: string, schema: z.ZodTypeAny) => {
    if (!schema.safeParse(rows[index][field]).success) add(index, field, "INVALID_FIELD_VALUE", `Invalid ${binding.shape} field: ${field}`);
  };
  const numeric = (fields: string[]) => rows.forEach((_, index) => fields.forEach(field => test(index, field, numericSchema.nullable())));
  switch (binding.shape) {
    case "items": numeric([binding.fields.value]); break;
    case "links": {
      const f = binding.fields;
      numeric([f.value]);
      rows.forEach((_, index) => { test(index, f.source, identitySchema); test(index, f.target, identitySchema); });
      break;
    }
    case "tree": {
      const f = binding.fields;
      numeric([f.value]);
      rows.forEach((_, index) => { test(index, f.id, identitySchema); test(index, f.parent, identitySchema.nullable()); });
      const parents = new Map<string, string | null>();
      rows.forEach((row, index) => {
        const id = String(row[f.id]);
        if (parents.has(id)) add(index, f.id, "DUPLICATE_TREE_ID", `Duplicate tree ID: ${id}`);
        parents.set(id, row[f.parent] === null ? null : String(row[f.parent]));
      });
      const complete = new Set<string>();
      rows.forEach((row, index) => {
        let id: string | null = String(row[f.id]);
        const visiting = new Set<string>();
        while (id !== null && !complete.has(id)) {
          if (visiting.has(id)) { add(index, f.parent, "TREE_CYCLE", `Tree cycle at: ${id}`); break; }
          if (!parents.has(id)) { add(index, f.parent, "MISSING_TREE_PARENT", `Missing tree parent: ${id}`); break; }
          visiting.add(id);
          id = parents.get(id)!;
        }
        for (const visited of visiting) complete.add(visited);
      });
      break;
    }
    case "radar": {
      const f = binding.fields;
      rows.forEach((row, index) => {
        test(index, f.name, z.string().min(1));
        test(index, f.value, numericSchema);
        if (Number(row[f.value]) < 0) add(index, f.value, "INVALID_RADAR_AXIS", "Radar axes cannot have negative values");
      });
      if (rows.length && !rows.some(row => Number(row[f.value]) > 0)) add(0, f.value, "INVALID_RADAR_AXIS", "Radar needs a positive axis maximum");
      break;
    }
    case "boxplot": {
      const f = binding.fields;
      numeric([f.min, f.q1, f.median, f.q3, f.max]);
      break;
    }
    case "single": {
      const f = binding.fields;
      if (rows.length > 1) add(1, f.value, "SINGLE_ROW_REQUIRED", "Single requires zero or one row");
      if (file.ontomato.display?.formats?.[f.value]?.kind === "percent") numeric([f.value]);
      break;
    }
    case "timeline": break;
    case "graph": {
      if (binding.input === "edges") {
        const f = binding.fields;
        rows.forEach((_, index) => {
          test(index, f.source, identitySchema); test(index, f.target, identitySchema);
          for (const field of [f.sourceName, f.targetName, f.relation, f.sourceCategory, f.targetCategory]) if (field) test(index, field, z.string().nullable());
        });
        if (f.value) numeric([f.value]);
      } else {
        const f = binding.fields;
        if (rows.length > 1) add(1, f.nodes, "GRAPH_OBJECT_ROW_REQUIRED", "Graph object input requires zero or one row");
        rows.forEach((row, index) => {
          const nodes = z.array(nodeSchema).safeParse(row[f.nodes]);
          const links = z.array(linkSchema).safeParse(row[f.links]);
          for (const [field, parsed] of [[f.nodes, nodes], [f.links, links]] as const) {
            if (!parsed.success) issues.push(...zodIssues(parsed.error).map(issue => ({ ...issue, path: ["rows", index, field, ...issue.path] })));
            issues.push(...chartExecutionIssues(row[field], ["rows", index, field]));
          }
          if (nodes.success && links.success) {
            const ids = new Set<string>();
            for (const node of nodes.data) {
              if (ids.has(String(node.id))) add(index, f.nodes, "DUPLICATE_GRAPH_ID", `Duplicate graph node: ${node.id}`);
              ids.add(String(node.id));
              if (node.name !== undefined && typeof node.label === "string" && node.name !== node.label) add(index, f.nodes, "CONFLICTING_GRAPH_NAME", "Graph name and label disagree");
              if (node.category !== undefined && node.group !== undefined && String(node.category) !== String(node.group)) add(index, f.nodes, "CONFLICTING_GRAPH_CATEGORY", "Graph category and group disagree");
            }
            for (const link of links.data) {
              for (const id of [link.source, link.target]) if (!ids.has(String(id))) add(index, f.links, "MISSING_GRAPH_NODE", `Missing graph node: ${id}`);
              if (link.relation !== undefined && typeof link.label === "string" && link.relation !== link.label) add(index, f.links, "CONFLICTING_GRAPH_RELATION", "Graph relation and label disagree");
              if (link.value !== undefined && link.weight !== undefined && link.value !== link.weight) add(index, f.links, "CONFLICTING_GRAPH_WEIGHT", "Graph value and weight disagree");
            }
          }
        });
      }
      break;
    }
  }
  return issues;
}

/** Only ordering and display selection change; no business values are calculated. */
function displayRows(rows: ChartRow[], display: ChartDisplay): ChartRow[] {
  const sorted = rows.slice();
  if (display.sort?.length) sorted.sort((a, b) => {
    for (const { field, order } of display.sort!) {
      const x = a[field], y = b[field];
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const delta = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      if (delta) return order === "asc" ? delta : -delta;
    }
    return 0;
  });
  return display.displayLimit === undefined ? sorted : sorted.slice(0, display.displayLimit);
}

function graphData(binding: Extract<ChartBinding, { shape: "graph" }>, rows: ChartRow[]) {
  let nodes: GraphNode[], links: GraphLink[];
  if (binding.input === "object") {
    const rawNodes = rows.length ? rows[0][binding.fields.nodes] as GraphNode[] : [];
    const rawLinks = rows.length ? rows[0][binding.fields.links] as GraphLink[] : [];
    nodes = rawNodes.map(raw => {
      const { label, ...node } = raw;
      const category = node.category ?? node.group;
      return { ...node, ...(typeof label === "object" ? { label } : {}), name: node.name ?? (typeof label === "string" ? label : String(node.id)), ...(category === undefined ? {} : { category }) };
    });
    links = rawLinks.map(raw => {
      const { label, ...link } = raw;
      const relation = link.relation ?? (typeof label === "string" ? label : undefined);
      const value = link.value === undefined ? link.weight : link.value;
      return { ...link, ...(typeof label === "object" ? { label } : {}), ...(relation === undefined ? {} : { relation }), ...(value === undefined ? {} : { value }) };
    });
  } else {
    const f = binding.fields;
    const nodeMap = new Map<string, GraphNode>();
    const node = (id: RuntimeJsonValue, name?: RuntimeJsonValue, category?: RuntimeJsonValue) => {
      const key = String(id);
      if (!nodeMap.has(key)) nodeMap.set(key, { id: key, name: name == null ? key : String(name), ...(category == null ? {} : { category: String(category) }) });
    };
    links = rows.map(row => {
      node(row[f.source], f.sourceName ? row[f.sourceName] : undefined, f.sourceCategory ? row[f.sourceCategory] : undefined);
      node(row[f.target], f.targetName ? row[f.targetName] : undefined, f.targetCategory ? row[f.targetCategory] : undefined);
      return { source: String(row[f.source]), target: String(row[f.target]), ...(f.value ? { value: row[f.value] as number | string | null } : {}), ...(f.relation ? { relation: row[f.relation] as string } : {}) };
    });
    nodes = [...nodeMap.values()];
  }
  const categories = [...new Set(nodes.filter(node => node.category !== undefined).map(node => String(node.category)))];
  const degree = new Map(nodes.map(node => [String(node.id), 0]));
  for (const link of links) for (const id of [link.source, link.target]) degree.set(String(id), degree.get(String(id))! + 1);
  return {
    data: nodes.map(node => ({ ...node, id: String(node.id), ...(node.category === undefined ? {} : { category: categories.indexOf(String(node.category)) }), symbolSize: node.symbolSize ?? Math.min(34, Math.max(13, 10 + Math.sqrt(degree.get(String(node.id))!) * 4)) })),
    links: links.map(link => ({ ...link, source: String(link.source), target: String(link.target) })),
    categories: categories.map(name => ({ name })),
  };
}

function timelineRows(rows: ChartRow[], field: string): ChartRow[] {
  const timestamp = (row: ChartRow) => {
    const raw = row[field];
    const time = raw === null || raw === "" ? NaN : Date.parse(String(raw));
    return Number.isFinite(time) ? time : -Infinity;
  };
  return rows.map((row, index) => ({ row, index, time: timestamp(row) }))
    .sort((a, b) => b.time - a.time || a.index - b.index).map(item => item.row);
}

function materialize(option: ChartOption, bindings: ChartBinding[], rows: ChartRow[], display: ChartDisplay) {
  for (const binding of bindings) {
    const series = option.series.find((series: ChartOption) => series.id === binding.seriesId);
    switch (binding.shape) {
      case "items": {
        const f = binding.fields;
        series.data = rows.map(row => ({ name: row[f.name], value: row[f.value], ...(f.share ? { share: row[f.share] } : {}) }));
        break;
      }
      case "tree": {
        const f = binding.fields;
        const nodes = new Map(rows.map(row => [String(row[f.id]), { id: String(row[f.id]), name: row[f.name], value: row[f.value], ...(f.share ? { share: row[f.share] } : {}), children: [] as ChartOption[] }]));
        const roots: ChartOption[] = [];
        for (const row of rows) {
          const node = nodes.get(String(row[f.id]))!;
          if (row[f.parent] === null) roots.push(node);
          else nodes.get(String(row[f.parent]))!.children.push(node);
        }
        series.data = roots;
        break;
      }
      case "links": {
        const f = binding.fields;
        series.data = [...new Set(rows.flatMap(row => [String(row[f.source]), String(row[f.target])]))].map(name => ({ name }));
        series.links = rows.map(row => ({ source: String(row[f.source]), target: String(row[f.target]), value: row[f.value] }));
        break;
      }
      case "radar": {
        const f = binding.fields;
        const max = Math.max(...rows.map(row => Number(row[f.value]))) * 1.15;
        const radarIndex = series.radarIndex ?? 0;
        const radar = Array.isArray(option.radar) ? option.radar[radarIndex] : option.radar ?? {};
        radar.indicator = rows.map(row => ({ name: row[f.name], max }));
        if (!Array.isArray(option.radar)) option.radar = radar;
        series.data = rows.length ? [{ name: series.name ?? f.value, value: rows.map(row => row[f.value]) }] : [];
        break;
      }
      case "boxplot": {
        const f = binding.fields;
        const axes = Array.isArray(option.xAxis) ? option.xAxis : [option.xAxis ?? {}];
        axes[series.xAxisIndex ?? 0].data = rows.map(row => row[f.category]);
        option.xAxis = Array.isArray(option.xAxis) ? axes : axes[0];
        series.data = rows.map(row => [f.min, f.q1, f.median, f.q3, f.max].map(field => row[field]));
        break;
      }
      case "single": {
        const f = binding.fields, format = display.formats![f.value];
        const raw = rows.length ? rows[0][f.value] : null;
        const percent = format.kind === "percent" && raw !== null;
        series.progress = { ...series.progress, show: percent };
        series.data = rows.length ? [{ value: percent ? Number(raw) / (format.scale === 100 ? 1 : 100) : 0, rawValue: raw, name: series.name ?? f.value }] : [];
        break;
      }
      case "timeline": {
        const f = binding.fields;
        const events = timelineRows(rows, f.date);
        const axes = Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis ?? {}];
        axes[series.yAxisIndex ?? 0].data = events.map((_, index) => index);
        option.yAxis = Array.isArray(option.yAxis) ? axes : axes[0];
        series.data = events.map((row, index) => ({ value: [0, index], date: row[f.date], name: row[f.name], description: row[f.description] }));
        break;
      }
      case "graph": Object.assign(series, graphData(binding, rows)); break;
    }
  }
}

function visualGeometry(option: ChartOption, rows: ChartRow[], dimensions: string[]) {
  for (const visual of [option.visualMap ?? []].flat()) {
    const field = typeof visual.dimension === "number" ? dimensions[visual.dimension] : visual.dimension;
    const values = rows.map(row => row[field]).filter(value => value !== null).map(Number).filter(Number.isFinite);
    if (!values.length) continue;
    const lo = Math.min(...values), hi = Math.max(...values);
    if (visual.inRange?.symbolSize) {
      visual.min = lo; visual.max = hi;
      visual.inRange.symbolSize = lo === hi ? [14, 14] : [6, 40];
    } else {
      if (visual.min === undefined) visual.min = lo;
      if (visual.max === undefined) visual.max = hi;
    }
  }
}

export type FilledChart<T = unknown> = {
  ok: true; option: ChartOption; presentation: { bindings: ChartBinding[]; display: ChartDisplay };
  truncation: T | undefined; rowCount: number; displayedRowCount: number;
};
/** The only external inputs are a chart document and one MetricView's output. */
export function fillChartFile<T = unknown>(input: unknown, metric: { columns: readonly ChartMetricColumn[]; rows: unknown; truncation?: T }): FilledChart<T> | ChartFailure {
  const parsed = metricRowsSchema.safeParse(metric);
  if (!parsed.success) return { ok: false, code: "INVALID_METRIC_OUTPUT", issues: zodIssues(parsed.error), missingColumns: [] };
  const checked = validateChartFile(input, parsed.data.columns);
  if (!checked.ok) return checked;
  const file = checked.file, rows = parsed.data.rows;
  const keys = parsed.data.columns.map(column => column.key);
  const rowIssues: ChartIssue[] = [];
  if (new Set(keys).size !== keys.length) rowIssues.push({ path: ["columns"], reason: "DUPLICATE_COLUMN", message: "Metric columns must be unique" });
  rows.forEach((row, index) => {
    for (const key of keys) if (!Object.hasOwn(row, key)) rowIssues.push({ path: ["rows", index, key], reason: "MISSING_ROW_FIELD", message: `Row is missing declared column: ${key}` });
    for (const key of Object.keys(row)) if (!keys.includes(key)) rowIssues.push({ path: ["rows", index, key], reason: "UNDECLARED_ROW_FIELD", message: `Row contains undeclared column: ${key}` });
  });
  if (rowIssues.length) return { ok: false, code: "INVALID_METRIC_OUTPUT", issues: rowIssues, missingColumns: [] };
  const { ontomato, ...option } = file;
  const bindings = ontomato.bindings ?? [], display = ontomato.display ?? {};
  const issues = bindings.flatMap(binding => shapeIssues(binding, rows, file));
  if (issues.length) return { ok: false, code: "INVALID_SHAPE_DATA", issues, missingColumns: [] };
  option.dataset[0].dimensions = keys;
  option.dataset[0].source = rows;
  materialize(option, bindings, rows, display);
  const presented = displayRows(rows, display);
  // A timeline's intrinsic order is date descending, including before a display limit is applied.
  const timeline = bindings.find(binding => binding.shape === "timeline");
  const selected = timeline?.shape === "timeline" ? displayRows(timelineRows(rows, timeline.fields.date), display) : presented;
  if (display.sort?.length || display.displayLimit !== undefined) {
    const selectionIssues = bindings.flatMap(binding => shapeIssues(binding, selected, file));
    if (selectionIssues.length) return { ok: false, code: "INVALID_SHAPE_DATA", issues: selectionIssues, missingColumns: [] };
    materialize(option, bindings, selected, display);
  }
  option.dataset[0].source = selected;
  visualGeometry(option, selected, keys);
  return { ok: true, option, presentation: { bindings, display }, truncation: metric.truncation, rowCount: rows.length, displayedRowCount: selected.length };
}
