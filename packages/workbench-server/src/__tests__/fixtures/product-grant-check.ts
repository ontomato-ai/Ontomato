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
