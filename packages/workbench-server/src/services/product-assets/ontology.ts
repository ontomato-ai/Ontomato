import { productGraphSchema } from "@ontomato/contracts/product-graph";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { readProductAssetGraph } from "../product-panels/asset-graph-read";
import { addProductGraphAuthorization, type EditableGraphTarget } from "./authorization-edges";

export async function addAuthorizationEdges(
  { graph, maintainableApplicationIds }: Awaited<ReturnType<typeof readProductAssetGraph>>,
  _owner: ProductOwner,
  viewer: AssistantCredentials,
) {
  const editableTargets = graph.nodes.flatMap<EditableGraphTarget>(node =>
    node.kind === "application" && node.assetId && maintainableApplicationIds.has(node.assetId)
      ? [{ kind: "APPLICATION", key: node.assetId, nodeId: node.id }]
      : [],
  );
  await addProductGraphAuthorization(graph, editableTargets, viewer);
  return productGraphSchema.parse(graph);
}
