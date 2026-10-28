import path from "node:path";
import { workbenchServerResourceRoot } from "../../content/resources";
import { publishSkill } from "../agent-runtime/skills";
export const retrievalSkill = {
  namespace: { kind: "provider" as const, provider: "workbench" },
  name: "data-retrieval",
};
export const ontologySkill = {
  namespace: { kind: "provider" as const, provider: "ontology" },
  name: "ontomato-analyst",
};
export function registerRetrievalSkill() {
  return publishSkill(
    path.join(
      workbenchServerResourceRoot,
      "resources/runtime-skills/data-retrieval",
    ),
    retrievalSkill,
  );
}
