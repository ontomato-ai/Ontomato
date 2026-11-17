import { isAppBuilderKind } from "../app-builder/definition";
import { GOVERNANCE_KIND } from "./governance-definition";

/** These kinds organize work without an ontology question-answering scope. */
export function hasRetrievalScope(kind: string) {
  return !isAppBuilderKind(kind) && kind !== GOVERNANCE_KIND;
}
