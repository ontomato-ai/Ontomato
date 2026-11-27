import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { renderModelRead, withModelingPath } from "../ontology-model/model-reads";
import { formParams, type PanelReadSelection } from "./panel-owner-reads";

const scopedReads: Readonly<Record<string, readonly string[]>> = {
  [OBJECT_TYPE]: ["list", "record", "options", "resolve", "form", "createForm", "inlineForm"],
  [ATTRIBUTE]: ["list", "form", "createForm", "inlineForm"],
  [RELATIONSHIP]: ["list", "record", "form", "createForm"],
};

export function prepareScopedModelRead(
  { kind, typeId, method, primaryKey }: PanelReadSelection, params: Record<string, unknown>, locale?: string,
) {
  if (kind !== "platform" || !scopedReads[typeId]?.includes(method)) return;
  const form = method === "form" || method === "createForm" || method === "inlineForm" ? formParams(params) : undefined;
  const parameters = form ? {
    changedField: form.changedField, ...(form.values !== undefined && { values: form.values }),
  } : params;
  return {
    call: { type: typeId, name: method, parameters: runtimeJsonObjectSchema.parse({
      ...parameters, ...(primaryKey !== undefined && { primaryKey }),
    }) },
    present(payload: unknown) {
      const value = renderModelRead(typeId, method, payload, params, locale);
      return method === "record"
        ? withModelingPath(value as PanelRecord, typeId === OBJECT_TYPE ? "object" : "relation", primaryKey!)
        : value;
    },
  };
}
