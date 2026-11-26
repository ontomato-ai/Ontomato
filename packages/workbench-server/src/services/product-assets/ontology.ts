import { productGraphSchema, type ProductGraph } from "@ontomato/contracts/product-graph";
import type { AuthorizationGraphFacts } from "../governance/policy-access";
import { appendProductGraphAuthorization, type EditableGraphTarget } from "./authorization-edges";

type AssetGraph = { graph: ProductGraph; maintainableApplicationIds: ReadonlySet<string> };

function editableApplications({ graph, maintainableApplicationIds }: AssetGraph) {
  return graph.nodes.flatMap<EditableGraphTarget>(node =>
    node.kind === "application" && node.assetId && maintainableApplicationIds.has(node.assetId)
      ? [{ kind: "APPLICATION", key: node.assetId, nodeId: node.id }]
      : [],
  );
}

export function presentAuthorizationEdges(
  assetGraph: AssetGraph, facts: Pick<AuthorizationGraphFacts, "entries" | "policyGrants" | "rolePolicies"> | undefined,
  locale?: string,
) {
  if (facts) appendProductGraphAuthorization(assetGraph.graph, editableApplications(assetGraph), facts, locale);
  return productGraphSchema.parse(assetGraph.graph);
}
