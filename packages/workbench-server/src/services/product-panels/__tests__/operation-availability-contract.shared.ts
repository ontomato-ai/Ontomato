import type { PanelMember } from "@ontomato/contracts/panel-manifest";
import type { DirectProjectionPorts } from "@ontomato/contracts/panel-projection";
import type { BuiltinProductPanelInput, BuiltinProductProjectionInput } from "@ontomato/contracts/product-panels";

export type BuiltinProducts = {
  panels: ReadonlyMap<string, BuiltinProductPanelInput>;
  projections: ReadonlyMap<string, BuiltinProductProjectionInput>;
};

export type AvailabilityContractCase = {
  panelId: string;
  memberName: string;
  operationName: string;
  operationId: string;
  placement: {
    panel: Pick<BuiltinProductPanelInput, "manifest"> & { id: string };
    projection: BuiltinProductProjectionInput & { id: string };
    member: PanelMember;
    slot: string;
  };
  inputs: Record<string, unknown>;
};

function rowDependent(binding: NonNullable<BuiltinProductProjectionInput["operations"]>[string]) {
  const target = binding.target;
  return (target && ("row" in target || "rowField" in target))
    || Object.values(binding.params ?? {}).some(param => "row" in param || "rowField" in param);
}

function sampleObject(objectType: string) {
  const className = objectType === "@any" ? "platform:ObjectType" : objectType;
  const primaryKey = className === "platform:AutotestCaseArtifact" ? "contract-run::contract-case"
    : className === "platform:TurnEvidence" ? "turn.contract-thread.1"
    : className === "platform:Attribute" || className === "platform:Relationship" ? "ContractType.contractField"
    : "contract-target";
  return { className, primaryKey };
}

function sampleValue(type: DirectProjectionPorts["inputs"][string]): unknown {
  switch (type.kind) {
    case "object": return sampleObject(type.objectType);
    case "object-union": return sampleObject("objectTypes" in type ? type.objectTypes[0] : "@any");
    case "child-object": return sampleObject(type.parentType);
    case "list": {
      const item = type.items.kind === "object" || type.items.kind === "object-union" || type.items.kind === "scalar"
        ? sampleValue(type.items)
        : null;
      return [item, item];
    }
    case "scalar":
      if (type.type === "number") return 1;
      if (type.type === "boolean") return true;
      return "contract-value";
    case "json":
    case "placement":
    case "grid-layout":
      return null;
  }
}

export function contractInputs(projection: BuiltinProductProjectionInput) {
  return Object.fromEntries(Object.entries(projection.inputs).map(([name, type]) => [name, sampleValue(type)]));
}

export function fixedAvailabilityCases(
  { panels, projections }: BuiltinProducts,
  requiresPlannedFacts: (operationId: string) => boolean,
) {
  const cases: AvailabilityContractCase[] = [];
  for (const [panelId, panel] of panels) {
    for (const [memberName, member] of Object.entries(panel.manifest.members)) {
      if (!("target" in member) || !("projectionId" in member.target)) continue;
      const projectionId = member.target.projectionId;
      const definition = projections.get(projectionId);
      if (!definition?.operations) continue;
      const projection = { ...definition, id: projectionId };
      const inputs = contractInputs(projection);
      for (const [operationName, binding] of Object.entries(projection.operations ?? {})) {
        if (binding.operation.kind !== "PlatformOperation" || rowDependent(binding) || !requiresPlannedFacts(binding.operation.id)) continue;
        cases.push({
          panelId,
          memberName,
          operationName,
          operationId: binding.operation.id,
          placement: {
            panel: { ...panel, id: panelId },
            projection,
            member,
            slot: memberName,
          },
          inputs,
        });
      }
    }
  }
  return cases;
}
