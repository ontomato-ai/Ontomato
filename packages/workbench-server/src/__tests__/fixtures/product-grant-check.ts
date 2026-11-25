import type { Express } from "express";
import type { ObjectDecisionRequest } from "../../services/product-governance/authorization";
import { objectDecisions } from "./agent-object-decisions";

type ProductVerb = "use" | "edit";

type CheckBody =
  | { id: string; verb: ProductVerb }
  | { target: { id: string; kind: string }; ownerFacts: { ownerId: string | null } };

export function productGrantCheck(
  body: CheckBody, userId: string | undefined, allowed: (id: string, verb: ProductVerb) => boolean,
) {
  if ("id" in body) return { allowed: allowed(body.id, body.verb) };
  const { id, kind } = body.target;
  const authored = body.ownerFacts.ownerId === userId;
  const editable = allowed(id, "edit");
  return { allowed: authored || editable || (kind === "panel" && allowed(id, "use")), authored, editable };
}

type CurrentRequest = Extract<ObjectDecisionRequest, { target: unknown }>;
type CurrentKind = "PANEL" | "PROJECTION" | "COMPONENT" | "SKILL";

/** Stub the policy owner after Workbench has loaded the definition from its own fixture store. */
export function mountCurrentProductDecisions(app: Express, {
  prefix = "", token, kinds = ["PANEL", "PROJECTION"], domain, allow,
}: {
  prefix?: string;
  token: string;
  kinds?: CurrentKind[];
  domain: string | ((token: string | undefined) => string | undefined);
  allow: (request: CurrentRequest, token: string | undefined) => boolean;
}) {
  const handles = (kind: string) => kinds.some(item => item === kind);
  app.post(prefix + "/authorization/objects/decide-batch", (req, res, next) => {
    const { requests } = req.body as { requests: ObjectDecisionRequest[] };
    if (requests.every(request => !handles("create" in request ? request.create : request.target.kind))) {
      next();
      return;
    }
    if (req.get("X-Ontomato-Query-Service-Token") !== token) {
      res.sendStatus(401);
      return;
    }
    const caller = req.get("tk");
    const domainId = typeof domain === "function" ? domain(caller) : domain;
    res.json(objectDecisions({ requests }, request => "create" in request
      ? Boolean(caller && domainId && handles(request.create))
      : handles(request.target.kind) && request.target.domainId === domainId &&
        request.ownerFacts.state === "PUBLISHED" && allow(request, caller)));
  });
}
