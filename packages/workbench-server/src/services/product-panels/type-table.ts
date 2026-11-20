import { zodToJsonSchema } from "zod-to-json-schema";
import type { PanelPlacement } from "@ontomato/contracts/panel-manifest";
import { projectionOperationTargetMatches } from "@ontomato/contracts/panel-projection";
import { customerOntologyReads, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { platformTypeTableResponseSchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjectionInput } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { createActionReadAdapter } from "../action/panel-reads";
import { createOntologyModelReadAdapter } from "../ontology-model/model-reads";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { registeredPanelOperation } from "./server-operations";
import { allowsOperationDraft, boundProjectionOperations } from "./operation-bindings";

async function customerTypeCatalogue(owner: ProductOwner, viewer: AssistantCredentials) {
  try {
    return await createOntologyModelReadAdapter(owner, viewer).objectTypeOptions();
  } catch (error) {
    if (!(error instanceof HttpError && (error.status === 401 || error.status === 403))) throw error;
    return { unavailable: { reason: error.message || `The customer type catalogue returned HTTP ${error.status}` } };
  }
}

export async function readPanelTypeTable(owner: ProductOwner, viewer: AssistantCredentials) {
  const objectTypes = new Map(Object.entries(platformObjectTypes).map(([id, { operations, ...entry }]) => [
    id, {
      ...entry,
      operations: operations?.flatMap(operationId => {
        const operation = registeredPanelOperation(operationId);
        return operation ? [operation.declaration] : [];
      }),
    },
  ]));
  const [catalogue, { actions, unavailableActions }] = await Promise.all([
    customerTypeCatalogue(owner, viewer),
    createActionReadAdapter(owner, viewer).objectActions(),
  ]);
  if ("options" in catalogue) {
    for (const { primaryKey } of catalogue.options) {
      if (!objectTypes.has(primaryKey)) objectTypes.set(primaryKey, { reads: customerOntologyReads, operations: undefined });
    }
  }
  for (const { className, declaration } of actions) {
    const entry = objectTypes.get(className);
    if (entry) (entry.operations ??= []).push(declaration);
    else objectTypes.set(className, { operations: [declaration] });
  }
  const resultIds = new Set([...objectTypes.values()].flatMap(entry => Object.values(entry.reads ?? {}).map(read => read.result)));
  const resultSchemas = Object.fromEntries([...resultIds].map(id => [id, zodToJsonSchema(panelReadResultSchemas[id])]));
  return platformTypeTableResponseSchema.parse({
    objectTypes: Object.fromEntries(objectTypes), resultSchemas,
    ...(unavailableActions.length > 0 && { unavailableActions }),
    ...("unavailable" in catalogue && { customerTypesUnavailable: catalogue.unavailable }),
  });
}

export function panelOperationTargetCheck(owner: ProductOwner, viewer: AssistantCredentials) {
  let objectActions: ReturnType<ReturnType<typeof createActionReadAdapter>["objectActions"]> | undefined;
  return async (projection: ProductProjectionInput, wiring?: Pick<PanelPlacement, "inputs">) => {
    for (const { name, binding, owner: platform } of boundProjectionOperations(projection)) {
      const ref = binding.operation;
      const catalog = ref.kind === "Action"
        ? await (objectActions ??= createActionReadAdapter(owner, viewer).objectActions()) : undefined;
      const operation = catalog ? catalog.actions.find(action => action.declaration.id === ref.id) : platform;
      if (!operation) {
        const unavailable = catalog?.unavailableActions.find(action => action.id === ref.id);
        return `operation '${name}' refers to unavailable owner operation '${ref.id}'${unavailable ? `: ${unavailable.reason}` : ""}`;
      }
      const type = "className" in operation ? operation.className : operation.targetType;
      const { target } = binding;
      if (!projectionOperationTargetMatches(projection, binding, operation.declaration, type))
        return `operation '${name}' takes a target of type '${type}'`;
      if (!target && platform?.handler.kind === "form.save" && !allowsOperationDraft(projection, platform.handler))
        return `operation '${name}' needs an edit target or the owner's create form`;
      if (wiring && target && "input" in target && !Object.hasOwn(wiring.inputs ?? {}, target.input))
        return `operation '${name}' expects input '${target.input}', but it is not connected`;
    }
  };
}
