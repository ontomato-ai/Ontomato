import type { ObjectDecisionRequest } from "../../services/product-governance/authorization";

export function agentObjectDecisions(
  { requests }: { requests: ObjectDecisionRequest[] },
  allowed: (request: ObjectDecisionRequest) => boolean,
) {
  return { decisions: requests.map(request => allowed(request)
    ? { allowed: true }
    : { allowed: false, code: "FORBIDDEN", reason: "Agent access denied" }) };
}
