import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import type { ProductGraph } from "@ontomato/contracts/product-graph";
import type { AuthorizationGraphFacts } from "../governance/policy-access";

export interface EditableGraphTarget {
  kind: string;
  key: string;
  nodeId: string;
}

const targetKey = (kind: string, key: string) => JSON.stringify([kind, key]);
const verbs: ReadonlyMap<string, ProductGraph["edges"][number]["relation"]> = new Map([["ENTER", "enter"], ["USE", "use"], ["VIEW", "view"], ["EDIT", "edit"]] as const);

export function appendProductGraphAuthorization(
  graph: ProductGraph,
  editableTargets: readonly EditableGraphTarget[],
  facts: Pick<AuthorizationGraphFacts, "entries" | "policyGrants" | "rolePolicies">,
  locale?: string,
) {
  if (!editableTargets.length) return;
  const targets = new Map(editableTargets.map(target => [targetKey(target.kind, target.key), target]));
  const entries = new Map(facts.entries.map(entry => [entry.id, entry]));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const edges = new Map(graph.edges.map(edge => [JSON.stringify([edge.source, edge.target, edge.relation]), edge]));
  const policies = new Set<string>();

  function addEdge(source: string, target: string, relation: ProductGraph["edges"][number]["relation"], storage: ProductGraph["edges"][number]["storage"]) {
    edges.set(JSON.stringify([source, target, relation]), { source, target, relation, storage });
  }
  function addNode(node: ProductGraph["nodes"][number]) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  for (const grant of facts.policyGrants) {
    const relation = verbs.get(grant.verb);
    if (!relation || (grant.targetKind === "APPLICATION" && grant.verb !== "EDIT")) continue;
    let target = targets.get(targetKey(grant.targetKind, grant.targetKey))?.nodeId;
    if (!target && grant.targetKind === "ENTRY") {
      const entry = entries.get(grant.targetKey);
      const application = entry && targets.get(targetKey("APPLICATION", entry.applicationId));
      if (!entry || !application || !nodes.has(application.nodeId)) continue;
      target = `entry:${entry.id}`;
      addNode({
        id: target, kind: "entry", category: "ontology",
        name: localizedApplicationText(entry.names, locale ?? "en") || entry.pageKey,
      });
      addEdge(application.nodeId, target, "contains", "product-index");
    }
    if (!target || !nodes.has(target)) continue;
    const policy = `policy:${grant.policyId}`;
    addNode({ id: policy, name: grant.policyId, kind: "policy", category: "principal" });
    addEdge(policy, target, relation, "governance");
    policies.add(grant.policyId);
  }
  for (const { roleId, policyId, kind } of facts.rolePolicies) {
    if (kind !== "OBJECT" || !policies.has(policyId)) continue;
    const role = `grant:role:${roleId}`;
    addNode({ id: role, name: roleId, kind: "role", category: "principal" });
    addEdge(role, `policy:${policyId}`, "uses-policy", "governance");
  }
  graph.nodes = [...nodes.values()];
  graph.edges = [...edges.values()];
}
