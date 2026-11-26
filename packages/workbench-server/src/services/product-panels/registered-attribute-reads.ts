import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { ATTRIBUTE, DELETE_ATTRIBUTE } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { z } from "zod";
import { attributeOperationRefusal, attributeReferenceRefusal, attributeRelationshipUses } from "../ontology-model/model-operations";
import { attributeViewSchema, relationshipViewSchema } from "../ontology-model/model-views";
import { presentRowOperationsForRows } from "./direct-operations";
import type { JavaPanelReadResult } from "./java-panel-reads";

export const attributeListPayloadSchema = z.object({ views: z.array(attributeViewSchema) });
const relationshipListPayloadSchema = z.object({ views: z.array(relationshipViewSchema) });
const attributeDeletePayloadSchema = attributeListPayloadSchema.extend({
  relationshipFacts: z.union([relationshipListPayloadSchema, z.object({ error: z.string() })]),
});

export function readAttributeRelationshipUses(result: JavaPanelReadResult) {
  if (result.status === "forbidden") return { ok: false as const, response: { status: "forbidden" as const, reason: result.error } };
  if (result.status === "error") return { ok: false as const, response: {
    status: "error" as const, message: result.error, ...(result.code && { code: result.code }),
  } };
  const parsed = relationshipListPayloadSchema.safeParse(result.status === "ready" ? result.payload : undefined);
  if (!parsed.success) return { ok: false as const, response: {
    status: "error" as const, code: "PANEL_READ_OWNER_RESPONSE_INVALID", message: parsed.error.message,
  } };
  return { ok: true as const, uses: attributeRelationshipUses(parsed.data.views) };
}

export function attributeDeleteRowBindings(projection: ProductProjection) {
  return Object.fromEntries(Object.entries(projection.operations ?? {}).filter(([, { operation, target }]) =>
    operation.kind === "PlatformOperation" && operation.id === DELETE_ATTRIBUTE && target && "row" in target));
}

export function presentAttributeDeleteRows(
  projection: ProductProjection, attributePayload: unknown, rows: PanelRecord[], locale?: string,
) {
  const { views, relationshipFacts } = attributeDeletePayloadSchema.parse(attributePayload);
  const attributes = new Map(views.map(view => [JSON.stringify([view.className, view.name]), view]));
  const uses = "views" in relationshipFacts ? attributeRelationshipUses(relationshipFacts.views) : undefined;
  return presentRowOperationsForRows(projection, {}, rows, ATTRIBUTE, (_handler, _binding, targets) => {
    const reasons = new Map<string, { reason: string }>();
    for (const { rowKey, target } of targets) {
      const refusal = attributeOperationRefusal(DELETE_ATTRIBUTE, attributes.get(target.primaryKey), locale)
        ?? ("error" in relationshipFacts ? { reason: relationshipFacts.error }
          : attributeReferenceRefusal(uses?.get(target.primaryKey), locale));
      if (refusal) reasons.set(rowKey, refusal);
    }
    return reasons;
  });
}
