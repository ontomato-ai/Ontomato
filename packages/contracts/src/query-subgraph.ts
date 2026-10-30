import { z } from "zod";

const text = z.string().min(1);
const nodeBase = { id: text, label: text };
const edgeBase = { id: text, source: text, target: text };

/** Execution-owned facts for both field authorization and direct graph rendering. */
export const querySubgraphShapeSchema = z.object({
  schema: z.literal("ontomato.query-subgraph.v1"),
  queries: z.array(z.object({ id: text, label: text }).strict()),
  nodes: z.array(z.discriminatedUnion("kind", [
    z.object({ ...nodeBase, kind: z.literal("class"), queryId: text, className: text, variable: text }).strict(),
    z.object({ ...nodeBase, kind: z.literal("field"), attrName: text }).strict(),
    z.object({ ...nodeBase, kind: z.literal("operation"), queryId: text.nullable(),
      operation: z.enum(["project", "filter", "group", "aggregate", "join", "calculate", "constant", "unknown"]),
      expression: text }).strict(),
    z.object({ ...nodeBase, kind: z.literal("output"), key: text }).strict(),
  ])),
  edges: z.array(z.discriminatedUnion("kind", [
    z.object({ ...edgeBase, kind: z.literal("contains") }).strict(),
    z.object({ ...edgeBase, kind: z.literal("relation"), label: text, name: text, relationType: text,
      direction: z.enum(["forward", "reverse", "both"]),
      hops: z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative().nullable() }).strict(),
    }).strict(),
    z.object({ ...edgeBase, kind: z.literal("dependency"), role: z.enum(["value", "group", "filter", "join"]), label: z.string() }).strict(),
  ])),
  filters: z.array(z.object({ id: text, queryId: text, targetIds: z.array(text).min(1),
    label: text, expression: text }).strict()),
}).strict();

export type QuerySubgraph = z.infer<typeof querySubgraphShapeSchema>;

/** Mirrored by QuerySubgraphContract after validation against the generated JSON Schema. */
export function querySubgraphIssues(graph: QuerySubgraph): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const add = (id: string) => { if (ids.has(id)) issues.push(`Duplicate graph id: ${id}`); ids.add(id); };
  const queries = new Set(graph.queries.map((q) => q.id));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, typeof graph.edges>();
  const keys = new Set<string>();
  for (const q of graph.queries) add(q.id);
  for (const node of graph.nodes) {
    add(node.id);
    if ((node.kind === "class" || node.kind === "operation") && node.queryId !== null && !queries.has(node.queryId))
      issues.push(`Unknown query: ${node.queryId}`);
    if (node.kind === "output") {
      if (keys.has(node.key)) issues.push(`Duplicate output key: ${node.key}`);
      keys.add(node.key);
    }
  }
  for (const edge of graph.edges) {
    add(edge.id);
    const from = nodes.get(edge.source), to = nodes.get(edge.target);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    if (!from || !to) { issues.push(`Unknown edge endpoint: ${edge.id}`); continue; }
    if (edge.kind === "contains" && !(from.kind === "class" && to.kind === "field"))
      issues.push(`Invalid field ownership: ${edge.id}`);
    if (edge.kind === "relation") {
      if (!(from.kind === "class" && to.kind === "class" && from.queryId === to.queryId))
        issues.push(`Invalid ontology relation: ${edge.id}`);
      if (edge.hops.max !== null && edge.hops.max < edge.hops.min) issues.push(`Invalid hop range: ${edge.id}`);
    }
    if (edge.kind === "dependency" &&
      (!(from.kind === "field" || from.kind === "operation") || !(to.kind === "operation" || to.kind === "output") ||
        (to.kind === "output" && edge.role !== "value"))) issues.push(`Invalid dependency: ${edge.id}`);
  }
  for (const node of graph.nodes) {
    const edges = incoming.get(node.id) ?? [];
    if (node.kind === "field" && edges.filter((e) => e.kind === "contains").length !== 1)
      issues.push(`Field requires one owner: ${node.id}`);
    if (node.kind === "output" && edges.filter((e) => e.kind === "dependency").length !== 1)
      issues.push(`Output requires one value: ${node.id}`);
    if (node.kind === "operation") {
      const count = edges.filter((e) => e.kind === "dependency").length;
      if ((node.operation === "constant" && count !== 0) ||
        (node.operation !== "constant" && node.operation !== "unknown" && count === 0))
        issues.push(`Invalid operation inputs: ${node.id}`);
    }
  }
  for (const filter of graph.filters) {
    add(filter.id);
    if (!queries.has(filter.queryId) || filter.targetIds.some((id) => !nodes.has(id)))
      issues.push(`Invalid filter targets: ${filter.id}`);
  }
  const done = new Set<string>(), active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) { issues.push(`Dependency cycle: ${id}`); return; }
    if (done.has(id)) return;
    active.add(id);
    for (const edge of incoming.get(id) ?? []) if (edge.kind === "dependency") visit(edge.source);
    active.delete(id); done.add(id);
  };
  for (const node of graph.nodes) visit(node.id);
  return issues;
}

export const querySubgraphSchema = querySubgraphShapeSchema.superRefine((graph, context) => {
  for (const message of querySubgraphIssues(graph)) context.addIssue({ code: z.ZodIssueCode.custom, message });
});
