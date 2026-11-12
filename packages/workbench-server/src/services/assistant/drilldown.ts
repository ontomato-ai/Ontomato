import type { DatasetPayload } from "@ontomato/contracts/data-retrieval";
import { drilldownPreviewSchema } from "@ontomato/contracts/assistant-drilldown";
import { HttpError } from "../../utils/errors";
import { assistantService } from "./service";
import type { AssistantOwner } from "./store";

/** Only a single-query aggregate with directly projected group fields has an unambiguous initial drilldown. */
export function drilldownGroups(payload: DatasetPayload) {
  const graph = payload.sourceAnalysis;
  const unavailable = () => { throw new HttpError(422, "This result has no supported detail mapping", "DRILLDOWN_UNAVAILABLE"); };
  if (!graph || graph.queries.length !== 1) return unavailable();
  if (graph.nodes.some((node) => node.kind === "operation" && ["unknown", "calculate", "join"].includes(node.operation))) return unavailable();
  const aggregates = graph.nodes.filter((node) => node.kind === "operation" && node.operation === "aggregate");
  if (aggregates.length !== 1) return unavailable();
  const dependencies = graph.edges.filter((edge) => edge.kind === "dependency");
  const groupIds = new Set(dependencies.filter((edge) => edge.role === "group").map((edge) => edge.source));
  for (const node of graph.nodes) {
    if (node.kind === "operation" && node.operation === "group") {
      for (const edge of dependencies.filter((edge) => edge.target === node.id)) groupIds.add(edge.source);
    }
  }
  const groups = [...groupIds].map((id) => {
    const field = graph.nodes.find((node) => node.id === id);
    const ownerEdge = graph.edges.find((edge) => edge.kind === "contains" && edge.target === id);
    const owner = graph.nodes.find((node) => node.id === ownerEdge?.source);
    if (field?.kind !== "field" || owner?.kind !== "class") return unavailable();
    const output = graph.nodes.find((node) => node.kind === "output" && dependencies.some((edge) => {
      if (edge.target !== node.id || edge.role !== "value") return false;
      if (edge.source === id) return true;
      const group = graph.nodes.find((item) => item.id === edge.source);
      const inputs = dependencies.filter((item) => item.target === group?.id);
      return group?.kind === "operation" && group.operation === "group" && inputs.length === 1 && inputs[0]!.source === id;
    }));
    if (output?.kind !== "output") return unavailable();
    return { key: output.key, label: output.label, className: owner.className, attrName: field.attrName };
  });
  if (!groups.length && payload.rows.length !== 1) return unavailable();
  // Every visible output must be either a mapped group or a direct aggregate.
  for (const output of graph.nodes.filter((node) => node.kind === "output")) {
    if (groups.some((group) => group.key === output.key)) continue;
    if (!dependencies.some((edge) => edge.target === output.id && aggregates.some((node) => node.id === edge.source))) return unavailable();
  }
  return groups;
}

export async function readDrilldown(session: string, artifactId: string, owner: AssistantOwner, rowIndex: number) {
  const { payload } = await assistantService.dataset(session, artifactId, owner);
  const mappings = drilldownGroups(payload);
  const row = payload.rows[rowIndex];
  if (!row) throw new HttpError(400, "Source row is unavailable", "INVALID_DRILLDOWN_ROW");
  const groups = mappings.map((mapping) => {
    const value = row[mapping.key];
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new HttpError(422, "Group value is unsupported", "DRILLDOWN_UNAVAILABLE");
    return { label: mapping.label, value: value as string | number | boolean | null };
  });
  return drilldownPreviewSchema.parse({ question: payload.question, groups,
    filters: payload.sourceAnalysis!.filters.map((filter) => filter.label), assumptions: payload.assumptions,
    truncated: payload.truncation?.truncated === true });
}
