import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { renderModelRead, withModelingPath } from "../ontology-model/model-reads";
import { formParams, type PanelReadSelection } from "./panel-owner-reads";
import { attributeDeleteRowBindings, presentAttributeDeleteRows } from "./registered-attribute-reads";
import { withReadDirective } from "./read-directive";

const scopedReads: Readonly<Record<string, readonly string[]>> = {
  [OBJECT_TYPE]: ["list", "record", "options", "resolve", "form", "createForm", "inlineForm"],
  [ATTRIBUTE]: ["list", "form", "createForm", "inlineForm"],
  [RELATIONSHIP]: ["list", "record", "form", "createForm"],
};

export function prepareScopedModelRead(
  { kind, typeId, method, primaryKey }: PanelReadSelection, params: Record<string, unknown>, projection: ProductProjection, locale?: string,
) {
  if (kind !== "platform" || !scopedReads[typeId]?.includes(method)) return;
  const bindings = typeId === ATTRIBUTE && method === "list" ? attributeDeleteRowBindings(projection) : {};
  const includeDeleteFacts = Object.keys(bindings).length > 0;
  const form = method === "form" || method === "createForm" || method === "inlineForm" ? formParams(params) : undefined;
  const parameters = form ? {
    changedField: form.changedField, ...(form.values !== undefined && { values: form.values }),
  } : params;
  return {
    call: { type: typeId, name: method, parameters: runtimeJsonObjectSchema.parse({
      ...parameters, ...(primaryKey !== undefined && { primaryKey }), ...(includeDeleteFacts && { includeDeleteFacts }),
    }) },
    async present(payload: unknown) {
      const value = renderModelRead(typeId, method, payload, params, locale);
      if (includeDeleteFacts) {
        const rowOperations = await presentAttributeDeleteRows({ ...projection, operations: bindings }, payload, value as PanelRecord[], locale);
        return withReadDirective(value, { rowOperations });
      }
      return method === "record"
        ? withModelingPath(value as PanelRecord, typeId === OBJECT_TYPE ? "object" : "relation", primaryKey!)
        : value;
    },
  };
}
