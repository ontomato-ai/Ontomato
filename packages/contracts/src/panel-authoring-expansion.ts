import { appsSdkComponentDatum, type AppsSdkComponentCatalogEntry } from "./apps-sdk";
import type { PanelAuthoringMember } from "./panel-authoring";
import { panelPortAccepts, type DirectPanelPortType, type PanelManifest, type PanelMember, type PanelStateRef } from "./panel-manifest";
import {
  missingRequiredReadParameters, panelLocalOperationNameSchema, panelReadInputMatches, panelReadParameterId, panelReadParameterSchemas,
  projectionOperationTargetMatches, type DirectProjectionData, type DirectProjectionPorts, type ProjectionOperationBinding,
} from "./panel-projection";
import type { PlatformTypeTableResponse } from "./platform-type-table";

type ShortMember = Extract<PanelAuthoringMember, { component: string }>;

function qualifiedId(component: AppsSdkComponentCatalogEntry): string {
  const packageName = component.module.split("/", component.module.startsWith("@") ? 2 : 1).join("/");
  return `${packageName}:${component.componentId}`;
}

function objectTypeOf(port: DirectPanelPortType): string | undefined {
  if (port.kind === "object") return port.objectType;
  if (port.kind === "list" && port.items.kind === "object") return port.items.objectType;
}

export function expandPanelAuthoringMember(
  key: string,
  member: ShortMember,
  { state, components, typeTable }: {
    state: PanelManifest["state"];
    components: readonly AppsSdkComponentCatalogEntry[];
    typeTable: Pick<PlatformTypeTableResponse, "objectTypes" | "unavailableActions">;
  },
): { projection: DirectProjectionPorts; placement: Pick<PanelMember, "inputs" | "outputs"> } {
  const fail = (field: string, message: string): never => {
    throw new Error(`Member '${key}', field '${field}': ${message}`);
  };
  const matching = components.filter(component =>
    qualifiedId(component) === member.component || component.componentId === member.component);
  if (!matching.length) return fail("component", `SDK component '${member.component}' does not exist`);
  if (matching.length !== 1) return fail("component", `'${member.component}' is ambiguous. Use the full component ID`);
  const component = matching[0];
  if (component.data === undefined) return fail("component", "This component does not declare projection data");

  const stateType = (name: string, field: string): DirectPanelPortType =>
    Object.hasOwn(state, name) ? state[name].type : fail(field, `State '${name}' is not declared`);
  const targetType = member.target === undefined ? undefined
    : objectTypeOf(stateType(member.target, "target")) ?? fail("target", "Expected object state of one type or a list of that type");
  if (targetType !== undefined && member.type !== undefined && targetType !== member.type)
    return fail("type", `'${member.type}' does not match target state type '${targetType}'`);

  const { objectTypes, unavailableActions } = typeTable;
  let typeId = member.type ?? targetType;
  if (typeId !== undefined && !Object.hasOwn(objectTypes, typeId))
    return fail("type", `Type '${typeId}' is absent from the author type table`);
  const ownerOperation = (() => {
    if (member.operation === undefined) return undefined;
    const candidates = typeId === undefined ? Object.entries(objectTypes) : [[typeId, objectTypes[typeId]]] as const;
    const matches = candidates.flatMap(([type, entry]) =>
      (entry.operations ?? []).filter(operation => operation.id === member.operation).map(operation => ({ type, operation })));
    if (matches.length > 1) return fail("operation", `'${member.operation}' is ambiguous. Declare its owner type`);
    if (!matches.length) {
      const unavailable = unavailableActions?.find(action => action.id === member.operation &&
        (typeId === undefined || action.objectType === undefined || action.objectType === typeId));
      return fail("operation", `'${member.operation}' is unavailable${unavailable ? `: ${unavailable.reason}` :
        typeId === undefined ? "" : ` on type '${typeId}'`}`);
    }
    return matches[0];
  })();
  typeId ??= ownerOperation?.type;
  const type = typeId === undefined ? undefined : objectTypes[typeId];
  const targetPort = ownerOperation?.operation.target.source === "input" ? ownerOperation.operation.target.input : "target";
  const inputTypes = new Map<string, DirectProjectionPorts["inputs"][string]>();
  const inputBindings = new Map<string, PanelStateRef>();
  const outputTypes = new Map<string, DirectPanelPortType>();
  const outputBindings = new Map<string, PanelStateRef>();
  const consumedState = new Set<string>();

  function bindInput(name: string, fieldName: string, path: string) {
    const port = stateType(fieldName, path);
    const existing = inputBindings.get(name);
    if (existing && existing.state !== fieldName)
      fail(path, `Input '${name}' already connects to state '${existing.state}'`);
    inputTypes.set(name, port);
    inputBindings.set(name, { state: fieldName });
    return { input: name };
  }

  const data: DirectProjectionPorts["data"] = Object.fromEntries(Object.entries(member.data ?? {}).map(([name, shorthand]) => {
    const path = `data.${name}`;
    const { read, params: explicit = {} } = typeof shorthand === "string" ? { read: shorthand } : shorthand;
    const declaration = type?.reads && Object.hasOwn(type.reads, read) ? type.reads[read]
      : fail(`${path}.read`, `'${read}' is not registered on type '${typeId}'`);
    const datum = appsSdkComponentDatum(component.data, name) ?? fail(path, "The component does not declare this datum");
    if (!datum.results.includes(declaration.result))
      fail(path, `The component does not accept result '${declaration.result}' for this datum`);
    const source: DirectProjectionData["source"] = declaration.source === "type"
      ? { type: { kind: typeId!.startsWith("platform:") ? "PlatformObjectType" : "ObjectType", id: typeId! } }
      : {
          object: bindInput(targetPort, member.target ?? fail("target", `Read '${read}' needs an object target`), "target"),
        };
    if (declaration.source === "object" && stateType(member.target!, "target").kind !== "object")
      fail("target", `Read '${read}' needs a single object`);
    const parameterNames = new Set([
      ...Object.keys(explicit), ...(declaration.parameterMode === "fixed"
        ? Object.keys(declaration.params).filter(param => Object.hasOwn(member.state ?? {}, param)) : []),
    ]);
    const params = Object.fromEntries([...parameterNames].map(param => {
      const paramPath = `${path}.params.${param}`;
      if (declaration.parameterMode === "fixed" && !Object.hasOwn(declaration.params, param))
        fail(paramPath, "Parameter is not registered for this read");
      const parameterId = panelReadParameterId(declaration, param)!;
      if (Object.hasOwn(member.state ?? {}, param)) consumedState.add(param);
      const supplied = Object.hasOwn(explicit, param) ? explicit[param] : { state: member.state![param] };
      if ("literal" in supplied) {
        const parsed = panelReadParameterSchemas[parameterId].safeParse(supplied.literal);
        if (!parsed.success) fail(paramPath, parsed.error.issues[0]!.message);
        return [param, supplied] as const;
      }
      if (!panelReadInputMatches(parameterId, stateType(supplied.state, paramPath)))
        fail(paramPath, `State '${supplied.state}' has an incompatible type for '${parameterId}'`);
      return [param, bindInput(param, supplied.state, paramPath)] as const;
    }));
    const [missing] = missingRequiredReadParameters(declaration, params, datum.runtimeParams);
    if (missing !== undefined) fail(`${path}.params.${missing}`, "Required parameter has no binding or component runtime source");
    return [name, { source, read, params }] as const;
  }));
  for (const [name, datum] of Object.entries(component.data))
    if (datum.required && !Object.hasOwn(data, name)) fail(`data.${name}`, "The component requires this datum");

  function concretePort<Port extends DirectProjectionPorts["inputs"][string]>(port: Port, path: string): Port {
    if (port.kind === "object" && port.objectType === "@binding")
      return { ...port, objectType: typeId ?? fail(path, "This port needs a declared object type") };
    if (port.kind === "list" && port.items.kind === "object" && port.items.objectType === "@binding")
      return { ...port, items: { ...port.items, objectType: typeId ?? fail(path, "This port needs a declared object type") } };
    return port;
  }

  for (const [port, fieldName] of Object.entries(member.state ?? {})) {
    const path = `state.${port}`;
    const actual = stateType(fieldName, path);
    const input = component.inputs && Object.hasOwn(component.inputs, port) ? component.inputs[port] : undefined;
    const output = component.outputs && Object.hasOwn(component.outputs, port) ? component.outputs[port] : undefined;
    if (input) {
      const expected = concretePort(input, path);
      if (expected.kind !== "json" && !panelPortAccepts(expected, actual))
        fail(path, `State '${fieldName}' has an incompatible type for component input '${port}'`);
      bindInput(port, fieldName, path);
    }
    if (output) {
      const offered = concretePort(output, path);
      if (!panelPortAccepts(actual, offered))
        fail(path, `State '${fieldName}' cannot receive component output '${port}'`);
      outputTypes.set(port, offered);
      outputBindings.set(port, { state: fieldName });
    }
    if (!input && !output && !consumedState.has(port)) fail(path, "Expected a component port or a registered read parameter");
  }

  const config = { ...member.config };
  let operations: DirectProjectionPorts["operations"];
  if (ownerOperation) {
    const { type: ownerType, operation } = ownerOperation;
    const target = operation.target.source === "none" || member.target === undefined
      ? undefined : bindInput(targetPort, member.target, "target");
    const binding: ProjectionOperationBinding = {
      operation: { kind: ownerType.startsWith("platform:") ? "PlatformOperation" : "Action", id: operation.id },
      ...(target && { target }),
    };
    if (!projectionOperationTargetMatches({ inputs: Object.fromEntries(inputTypes) }, binding, operation, ownerType))
      fail("target", `Operation '${operation.id}' requires a compatible target of type '${ownerType}'`);
    const localName = panelLocalOperationNameSchema.safeParse(operation.id.split(".").at(-1));
    if (!localName.success) return fail("operation", `'${operation.id}' has no usable local operation name`);
    const name = localName.data;
    operations = { [name]: binding };
    if (component.config?.some(field => field.name === "operation")) {
      if (Object.hasOwn(config, "operation") && config.operation !== name)
        fail("config.operation", `Expected '${name}' for operation '${operation.id}'`);
      config.operation = name;
    }
  }

  return {
    projection: {
      componentId: qualifiedId(component), inputs: Object.fromEntries(inputTypes), outputs: Object.fromEntries(outputTypes),
      data, config, ...(operations && { operations }),
    },
    placement: {
      ...(inputBindings.size && { inputs: Object.fromEntries(inputBindings) }),
      ...(outputBindings.size && { outputs: Object.fromEntries(outputBindings) }),
    },
  };
}
