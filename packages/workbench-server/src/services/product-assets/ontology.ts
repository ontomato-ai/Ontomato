import {productGraphSchema} from '@ontomato/contracts/product-graph';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {readProductGrantRecords} from '../product-governance/grants';
import type {readProductAssetGraph} from '../product-panels/asset-graph-read';

// Authorization edges are owned by the interface-interception pack (permission module batch facts, readAuthorizationGraphFacts); replace this body wholesale.
export async function addAuthorizationEdges(
  { graph, grantableApplicationIds }: Awaited<ReturnType<typeof readProductAssetGraph>>,
  _owner: ProductOwner,
  viewer: AssistantCredentials,
) {
  for (const node of graph.nodes) {
    if (node.kind !== "application" || !grantableApplicationIds.has(node.assetId!)) continue;
    const { grants } = await readProductGrantRecords(node.assetId!, viewer).catch(() => ({ grants: [] }));
    for (const grant of grants) {
      if (grant.verb === "view") continue;
      const id = `grant:${grant.principalKind}:${grant.principalId}`;
      if (!graph.nodes.some(node => node.id === id)) {
        graph.nodes.push({ id, name: grant.principalName ?? grant.principalId, kind: grant.principalKind, category: "principal" });
      }
      if (!graph.edges.some(edge => edge.source === id && edge.target === node.id && edge.relation === grant.verb)) {
        graph.edges.push({ source: id, target: node.id, relation: grant.verb, storage: "governance" });
      }
    }
  }
  return productGraphSchema.parse(graph);
}
