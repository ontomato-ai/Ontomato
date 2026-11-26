import { expect, it } from "vitest";
import { presentAuthorizationEdges } from "../ontology";

it("keeps policy edges within the caller's application maintenance scope", async () => {
  const nodes = ["managed", "visible"].map(assetId => ({
    id: `asset:${assetId}`, assetId, name: assetId, kind: "application", category: "bundle" as const,
  }));
  const facts = {
    rolePolicies: [
      { roleId: "reader", policyId: "selected", kind: "OBJECT" as const },
      { roleId: "outsider", policyId: "outside", kind: "OBJECT" as const },
    ],
    entries: [
      { id: "managed/main", applicationId: "managed", names: { en: "Main" }, pageKey: "main" },
      { id: "visible/main", applicationId: "visible", names: { en: "Outside" }, pageKey: "main" },
    ],
    policyGrants: [
      { policyId: "selected", targetKind: "APPLICATION", targetKey: "managed", verb: "EDIT" },
      { policyId: "selected", targetKind: "ENTRY", targetKey: "managed/main", verb: "ENTER" },
      { policyId: "outside", targetKind: "ENTRY", targetKey: "visible/main", verb: "ENTER" },
      { policyId: "outside", targetKind: "PANEL", targetKey: "managed", verb: "USE" },
      { policyId: "outside", targetKind: "APPLICATION", targetKey: "managed", verb: "USE" },
    ],
  };
  const graph = presentAuthorizationEdges(
    { graph: { nodes, edges: [] }, maintainableApplicationIds: new Set(["managed"]) }, facts,
  );
  expect(graph.edges.filter(edge => edge.storage === "governance")).toEqual([
    { source: "policy:selected", target: "asset:managed", relation: "edit", storage: "governance" },
    { source: "policy:selected", target: "entry:managed/main", relation: "enter", storage: "governance" },
    { source: "grant:role:reader", target: "policy:selected", relation: "uses-policy", storage: "governance" },
  ]);
  expect(graph.nodes).toContainEqual({ id: "entry:managed/main", kind: "entry", category: "ontology", name: "Main" });
});
