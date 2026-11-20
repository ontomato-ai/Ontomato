import { panelObjectRefSchema, type PanelPlacement } from "@ontomato/contracts/panel-manifest";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableResponseSchema } from "@ontomato/contracts/platform-type-table";
import type { ProductProjectionInput } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { createActionReadAdapter } from "../action/panel-reads";
import type { ProductOwner } from "../product-governance/grants";
import { panelOperationTargetPort, registeredPanelOperation } from "./server-operations";

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
  for (const { className, declaration } of await createActionReadAdapter(owner, viewer).objectActions()) {
    const entry = objectTypes.get(className);
    if (entry) (entry.operations ??= []).push(declaration);
    else objectTypes.set(className, { operations: [declaration] });
  }
  return platformTypeTableResponseSchema.parse({ objectTypes: Object.fromEntries(objectTypes) });
}

export function panelOperationTargetCheck(owner: ProductOwner, viewer: AssistantCredentials) {
  let objectActions: ReturnType<ReturnType<typeof createActionReadAdapter>["objectActions"]> | undefined;
  return async (projection: ProductProjectionInput, wiring: Pick<PanelPlacement, "inputs">) => {
    for (const [name, datum] of Object.entries(projection.data)) {
      if (!("operation" in datum.source)) continue;
      const source = datum.source.operation;
      const operation = source.kind === "Action"
        ? (await (objectActions ??= createActionReadAdapter(owner, viewer).objectActions()))
          .find(action => action.declaration.id === source.id)
        : registeredPanelOperation(source.id);
      if (!operation) return `data '${name}' names unavailable operation '${source.id}'`;

      const { declaration } = operation;
      if (declaration.target.source !== "input") continue;
      const { input } = declaration.target;
      const targetType = "className" in operation ? operation.className : operation.targetType!;
      const binding = datum.params[input];
      if (binding && "literal" in binding) {
        const literal = panelObjectRefSchema.safeParse(binding.literal);
        if (literal.success && literal.data.className === targetType) continue;
      } else {
        const port = binding?.input ?? input;
        if (!wiring.inputs || !Object.hasOwn(wiring.inputs, port))
          return `operation '${source.id}' expects target input '${port}', but it is not connected`;
        if (panelOperationTargetPort(projection.inputs[port], targetType, declaration.batch)) continue;
      }
      return `operation '${source.id}' expects target input '${input}' of type '${targetType}'`;
    }
  };
}
