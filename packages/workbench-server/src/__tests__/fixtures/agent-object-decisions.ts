import type { ObjectDecisionRequest } from "../../services/product-governance/authorization";

export function objectDecisions(
  { requests }: { requests: ObjectDecisionRequest[] },
  allowed: (request: ObjectDecisionRequest) => boolean,
  reason = "Object access denied",
  code = "OBJECT_FORBIDDEN",
) {
  return { decisions: requests.map(request => allowed(request)
    ? { allowed: true }
    : { allowed: false, code, reason }) };
}

export function agentObjectDecisions(body: Parameters<typeof objectDecisions>[0], allowed: Parameters<typeof objectDecisions>[1]) {
  return objectDecisions(body, allowed, "Agent access denied", "FORBIDDEN");
}
