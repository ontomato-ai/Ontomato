import { appsSdkComponentDatum, type AppsSdkComponentCatalogEntry } from "./apps-sdk";
import type { ComponentDeclaration } from "./component-declaration";
import { dashboardCardPrimaryKey } from "./dashboard";
import type { PanelAuthoringMember } from "./panel-authoring";
import { panelConversationEntrySchema } from "./panel-conversation-entry";
import {
  matchesDirectPanelValue, matchesObjectType, panelPortAccepts, panelStateInputType,
  type DirectPanelPortType, type PanelManifest, type PanelMember, type PanelMemberInput, type PanelStateFieldRef, type PanelStateRef,
} from "./panel-manifest";
import {
  directProjectionInputAccepts, formatOperationTargetTypes, missingRequiredReadParameters, panelLocalOperationNameSchema,
  panelOperationTargetPort, panelReadInputMatches, panelReadParameterId, panelReadParameterSchemas,
  projectionOperationTargetMatches, type DirectProjectionData, type DirectProjectionPorts, type ProjectionOperationBinding,
  type ProjectionOperationParam,
} from "./panel-projection";
import { customerRelationReads, DASHBOARD_CARD, platformOntologyLayers } from "./platform-object-types";
import { chartProjectionSchema } from "./product-panels";
import type { PlatformTypeTableResponse } from "./platform-type-table";

type ShortMember = Extract<PanelAuthoringMember, { component: string }>;

type AuthoringComponent = AppsSdkComponentCatalogEntry | ComponentDeclaration;

function qualifiedId(component: AuthoringComponent): string {
  if (!("module" in component) || component.componentId.includes(":")) return component.componentId;
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
    components: readonly AuthoringComponent[];
    typeTable: Pick<PlatformTypeTableResponse, "objectTypes" | "operations" | "unavailableActions">;
  },
): {
  projection: DirectProjectionPorts;
  placement: Pick<PanelMember, "inputs" | "outputs" | "readOperationInputs" | "operationDrafts">;
} {
  const fail = (field: string, message: string): never => {
    throw new Error(`Member '${key}', field '${field}': ${message}`);
  };
  if (member.sourceCard !== undefined)
    return fail("sourceCard", "Resolve the source card through the chart owner before binding this member");
  const matching = components.filter(component =>
    qualifiedId(component) === member.component || component.componentId === member.component);
  if (!matching.length) return fail("component", `SDK component '${member.component}' does not exist`);
  if (matching.length !== 1) return fail("component", `'${member.component}' is ambiguous. Use the full component ID`);
  const component = matching[0];
  if (component.data === undefined && Object.keys(member.data ?? {}).length > 0)
    return fail("component", "This component does not declare projection data");
  if (component.data === undefined && member.operation === undefined && !(member.operations && Object.keys(member.operations).length))
    return fail("component", "This component does not declare projection data");
  const componentData = component.data ?? {};
  const componentId = qualifiedId(component);
  const isObjectRelations = componentId === "@ontomato/sdk:ObjectRelations";
  const isOntologyGraph = componentId === "@ontomato/sdk:InstanceGraph";
  const allowsAgentTarget = componentId === "@ontomato/sdk:ConversationEntry" || componentId === "@ontomato/sdk:AgentChat";
  if (member.agent !== undefined && !allowsAgentTarget)
    return fail("agent", "The agent target belongs to the official ConversationEntry or AgentChat component");
  if ((member.prefill !== undefined || member.prefillKey !== undefined) && componentId !== "@ontomato/sdk:ConversationEntry")
    return fail(member.prefill !== undefined ? "prefill" : "prefillKey", "The opening sentence belongs to the official ConversationEntry component");
  if ((member.submit !== undefined || member.newSession !== undefined) && componentId !== "@ontomato/sdk:ConversationEntry")
    return fail(member.submit !== undefined ? "submit" : "newSession", "Submit and newSession belong to the official ConversationEntry component");
  const conversationEntry = member.agent === undefined ? undefined : panelConversationEntrySchema.parse({
    target: member.agent === "page-default" ? { kind: "page-default" } : member.agent,
    ...(member.prefill !== undefined && { prefill: member.prefill }),
    ...(member.prefillKey !== undefined && { prefillKey: member.prefillKey }),
    ...(member.submit !== undefined && { submit: member.submit }),
    ...(member.newSession !== undefined && { newSession: member.newSession }),
  });

  const stateType = (name: string, field: string): DirectPanelPortType =>
    Object.hasOwn(state, name) ? state[name].type : fail(field, `State '${name}' is not declared`);
  function stateInputType(ref: PanelStateRef | PanelStateFieldRef, path: string): DirectPanelPortType {
    return panelStateInputType(ref, stateType(ref.state, path))
      ?? fail(path, `State '${ref.state}' must be an object, object-union, or child-object to expose an identity field`);
  }

  const targetIsFromSlot = typeof member.target === "object" && member.target !== null && "fromSlot" in member.target;
  const targetStateName = typeof member.target === "string" ? member.target : undefined;
  const targetStatePort = targetStateName === undefined ? undefined : stateType(targetStateName, "target");
  const targetType = targetStatePort === undefined ? undefined
    : targetStatePort.kind === "object-union" ? undefined
      : objectTypeOf(targetStatePort) ?? fail("target", "Expected object state of one type, an object-union, or a list of one type");

  const { objectTypes, operations: topLevelOperations, unavailableActions } = typeTable;
  let typeId = member.type ?? targetType;
  if (typeId !== undefined && typeId !== "@any" && !Object.hasOwn(objectTypes, typeId))
    return fail("type", `Type '${typeId}' is absent from the author type table`);

  function lookupOwnerOperation(operationId: string, preferredType: string | undefined, fieldPath: string) {
    if (preferredType !== undefined && !Object.hasOwn(objectTypes, preferredType))
      fail(fieldPath, `Type '${preferredType}' is absent from the author type table`);
    const candidates = preferredType === undefined ? Object.entries(objectTypes) : [[preferredType, objectTypes[preferredType]]] as const;
    const typedMatches = candidates.flatMap(([type, entry]) =>
      (entry.operations ?? []).filter(operation => operation.id === operationId).map(operation => ({ type: type as string | undefined, operation })));
    const globalMatches = (topLevelOperations ?? [])
      .filter(operation => operation.id === operationId)
      .map(operation => ({ type: undefined as string | undefined, operation }));
    const matches = [...typedMatches, ...globalMatches];
    if (matches.length > 1) return fail(fieldPath, `'${operationId}' is ambiguous. Declare its owner type`);
    if (!matches.length) {
      const unavailable = unavailableActions?.find(action => action.id === operationId &&
        (preferredType === undefined || action.objectType === undefined || action.objectType === preferredType));
      return fail(fieldPath, `'${operationId}' is unavailable${unavailable ? `: ${unavailable.reason}` :
        preferredType === undefined ? "" : ` on type '${preferredType}'`}`);
    }
    return matches[0]!;
  }

  const ownerOperation = member.operation === undefined
    ? undefined
    : lookupOwnerOperation(member.operation, typeId === "@any" ? undefined : typeId, "operation");
  const operationAcceptsTargetState = ownerOperation?.operation.targetTypes !== undefined
    && targetStatePort !== undefined
    && panelOperationTargetPort(
      targetStatePort,
      ownerOperation.type,
      ownerOperation.operation.batch,
      ownerOperation.operation.targetTypes,
    ) !== undefined;
  if (!operationAcceptsTargetState) {
    if (targetStatePort?.kind === "object-union" && member.type !== undefined && !matchesObjectType(targetStatePort, member.type))
      return fail("type", `'${member.type}' is not included in target state object-union`);
    if (targetType !== undefined && member.type !== undefined && targetType !== member.type)
      return fail("type", `'${member.type}' does not match target state type '${targetType}'`);
  }
  const readsDraft = ownerOperation?.operation.effect === "read" && ownerOperation.operation.target.source === "draft";
  const writesWithDraft = ownerOperation?.operation.effect === "write";
  if (!readsDraft) {
    for (const field of ["parameters", "bindingId"] as const) {
      if (member[field] !== undefined) fail(field, "This field requires an operation that reads a form draft");
    }
    if (!writesWithDraft && member.draft !== undefined) {
      fail("draft", "This field requires a write operation or a read operation that reads a form draft");
    }
  }
  typeId ??= ownerOperation?.type;
  const targetPort = ownerOperation?.operation.target.source === "input" ? ownerOperation.operation.target.input : "target";
  const inputTypes = new Map<string, DirectProjectionPorts["inputs"][string]>();
  const inputBindings = new Map<string, PanelMemberInput>();
  const outputTypes = new Map<string, DirectPanelPortType>();
  const outputBindings = new Map<string, PanelStateRef>();
  const consumedState = new Set<string>();
  const ontologyNode: DirectPanelPortType = {
    kind: "object-union", layers: [...platformOntologyLayers],
  };

  function sameBinding(a: PanelMemberInput, b: PanelMemberInput): boolean {
    if ("state" in a && "state" in b)
      return a.state === b.state && ("field" in a ? a.field : undefined) === ("field" in b ? b.field : undefined);
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function bindInput(name: string, fieldName: string, path: string) {
    return bindMemberInput(name, { state: fieldName }, path);
  }

  function bindMemberInput(
    name: string,
    source: PanelMemberInput | { fromSlot: true },
    path: string,
    expected?: DirectProjectionPorts["inputs"][string],
    preferredObjectType?: string,
  ) {
    if ("fromSlot" in source) {
      if (!inputTypes.has(name)) {
        inputTypes.set(name, expected ?? (preferredObjectType ? { kind: "object", objectType: preferredObjectType } : { kind: "json" }));
      }
      return { input: name };
    }
    const existing = inputBindings.get(name);
    if (existing && !sameBinding(existing, source)) {
      fail(path, `Input '${name}' already has a different binding`);
    }
    if ("state" in source) {
      const actual = stateInputType(source, path);
      if (expected && !directProjectionInputAccepts(expected, actual)) {
        fail(path, `State '${source.state}' has an incompatible type for input '${name}'`);
      }
      inputTypes.set(name, actual);
      inputBindings.set(name, source);
      return { input: name };
    }
    if ("literal" in source && expected && expected.kind !== "json" && !matchesDirectPanelValue(expected, source.literal)) {
      fail(path, `Literal value does not match input '${name}'`);
    }
    if (!inputTypes.has(name)) {
      inputTypes.set(name, expected ?? { kind: "json" });
    }
    inputBindings.set(name, source);
    return { input: name };
  }

  function parameterPortType(parameterId: ReturnType<typeof panelReadParameterId>): DirectPanelPortType {
    if (!parameterId) return { kind: "json" };
    if (panelReadInputMatches(parameterId, { kind: "scalar", type: "string" })) return { kind: "scalar", type: "string" };
    if (panelReadInputMatches(parameterId, { kind: "scalar", type: "number" })) return { kind: "scalar", type: "number" };
    if (panelReadInputMatches(parameterId, { kind: "scalar", type: "boolean" })) return { kind: "scalar", type: "boolean" };
    return { kind: "json" };
  }

  const dataTypes = new Map<string, string>();
  const dataRowTypes = new Map<string, string>();
  let readsOntologyObjects = false;
  const data: DirectProjectionPorts["data"] = Object.fromEntries(Object.entries(member.data ?? {}).map(([name, shorthand]) => {
    const path = `data.${name}`;
    const { read, type: declaredType, params: explicit = {} } = typeof shorthand === "string" ? { read: shorthand } : shorthand;
    const readType = declaredType ?? typeId ?? fail(`${path}.type`, "Declare the datum's owner type");
    // Relationship identities are resolved by the domain owner at registration.
    const datumDecl = appsSdkComponentDatum(componentData, name);
    const relationship = datumDecl?.results.includes("panelRelationNeighbors") === true && declaredType !== undefined
      && !declaredType.startsWith("platform:") && Object.hasOwn(customerRelationReads, read);
    if (!relationship && !Object.hasOwn(objectTypes, readType))
      fail(`${path}.type`, `Type '${readType}' is absent from the author type table`);
    const reads = relationship ? customerRelationReads : objectTypes[readType].reads;
    const declaration = reads && Object.hasOwn(reads, read) ? reads[read]
      : fail(`${path}.read`, `'${read}' is not registered on type '${readType}'`);
    dataTypes.set(name, readType);
    dataRowTypes.set(name, declaration.rowType ?? readType);
    readsOntologyObjects ||= declaration.result === "panelOntologyObjects";
    const datum = datumDecl ?? fail(path, "The component does not declare this datum");
    if (!datum.results.includes(declaration.result))
      fail(path, `The component does not accept result '${declaration.result}' for this datum`);
    let source: DirectProjectionData["source"];
    if (declaration.source === "type") {
      const kind = relationship ? "Relationship" : readType.startsWith("platform:") ? "PlatformObjectType" : "ObjectType";
      source = { type: { kind, id: readType } };
    } else if (targetIsFromSlot) {
      inputTypes.set(targetPort, { kind: "object", objectType: readType });
      source = { object: { input: targetPort } };
    } else if (targetStateName !== undefined) {
      source = { object: bindInput(targetPort, targetStateName, "target") };
      if (stateType(targetStateName, "target").kind !== "object") fail("target", `Read '${read}' needs a single object`);
      if (targetType !== readType)
        fail(`${path}.type`, `'${readType}' does not match target state type '${targetType}'`);
    } else if (member.inputs && Object.hasOwn(member.inputs, targetPort)) {
      source = {
        object: bindMemberInput(
          targetPort,
          member.inputs[targetPort],
          `inputs.${targetPort}`,
          { kind: "object", objectType: readType },
          readType,
        ),
      };
    } else {
      return fail("target", `Read '${read}' needs an object target`);
    }
    const parameterNames = new Set([
      ...Object.keys(explicit), ...(declaration.parameterMode === "fixed"
        ? Object.keys(declaration.params).filter((param) =>
            Object.hasOwn(member.state ?? {}, param)
            && !(componentId === "@ontomato/sdk:ObjectTree" && param === "search"),
          )
        : []),
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
      if ("fromSlot" in supplied) {
        const port = inputTypes.has(param) ? `${name}_${param}` : param;
        inputTypes.set(port, parameterPortType(parameterId));
        return [param, { input: port }] as const;
      }
      // Another member's read-only output reaches this read through this placement's input of the same name.
      if ("output" in supplied) {
        const port = inputTypes.has(param) ? `${name}_${param}` : param;
        return [param, bindMemberInput(port, supplied, paramPath, parameterPortType(parameterId))] as const;
      }
      if (!panelReadInputMatches(parameterId, stateInputType(supplied, paramPath)))
        fail(paramPath, `State '${supplied.state}' has an incompatible type for '${parameterId}'`);
      const existing = inputBindings.get(param);
      const port = existing && !sameBinding(existing, supplied)
        ? (!inputBindings.has(supplied.state) || sameBinding(inputBindings.get(supplied.state)!, supplied)
            ? supplied.state
            : `${name}_${param}`)
        : param;
      return [param, bindMemberInput(port, supplied, paramPath)] as const;
    }));
    const [missing] = missingRequiredReadParameters(declaration, params, datum.runtimeParams);
    if (missing !== undefined) fail(`${path}.params.${missing}`, "Required parameter has no binding or component runtime source");
    return [name, { source, read, params }] as const;
  }));
  for (const [name, datum] of Object.entries(componentData))
    if (datum.required && !Object.hasOwn(data, name)) fail(`data.${name}`, "The component requires this datum");
  if (
    componentId === "@ontomato/sdk:GroupedGrid"
    && !Object.hasOwn(data, "rows")
    && !(Array.isArray(member.config?.items) || member.state?.layout !== undefined || member.inputs?.layout !== undefined)
  ) {
    fail("data.rows", "GroupedGrid requires 'data.rows' in record mode, or 'config.items' / 'state.layout' in fixed-member mode");
  }
  if (
    componentId === "@ontomato/sdk:ObjectTree"
    && !Object.hasOwn(data, "files")
    && !Object.hasOwn(data, "rows")
  ) {
    fail("data", "ObjectTree requires either 'data.files' or 'data.rows'");
  }

  const owners = new Set(dataTypes.values());
  const bindingType = typeId ?? (owners.size === 1 ? [...owners][0] : undefined);
  const rowOwners = new Set(dataRowTypes.values());
  const rowBindingType = rowOwners.size === 1 ? [...rowOwners][0] : bindingType;

  function concreteObjectType(objectType: string, path: string): string {
    if (objectType === "@binding") return rowBindingType ?? fail(path, "This port needs a declared object type");
    if (objectType.startsWith("@data:")) {
      const datum = objectType.slice("@data:".length);
      return dataRowTypes.get(datum) ?? fail(path, `This port requires data '${datum}'`);
    }
    return objectType;
  }

  function concretePort<Port extends DirectProjectionPorts["inputs"][string]>(port: Port, path: string): Port {
    if (port.kind === "object") return { ...port, objectType: concreteObjectType(port.objectType, path) };
    if (port.kind === "list" && port.items.kind === "object")
      return { ...port, items: { ...port.items, objectType: concreteObjectType(port.items.objectType, path) } };
    return port;
  }

  function boundComponentPort(
    name: string,
    declared: DirectPanelPortType,
    actual: DirectPanelPortType | undefined,
    path: string,
  ): DirectPanelPortType {
    if (declared.kind === "object" && declared.objectType === "@any") {
      if (actual?.kind !== "object" && actual?.kind !== "object-union")
        return fail(path, `Port '${name}' requires object or object-union state`);
      return actual;
    }
    if (declared.kind === "list" && declared.items.kind === "object" && declared.items.objectType === "@any") {
      if (actual?.kind !== "list" || (actual.items.kind !== "object" && actual.items.kind !== "object-union"))
        return fail(path, `Port '${name}' requires a list of object or object-union state`);
      return actual;
    }
    if ((isObjectRelations || isOntologyGraph) && name === "visibleRelationKinds" && actual !== undefined) {
      if (actual.kind !== "list" || (actual.items.kind !== "object"
        && !(actual.items.kind === "scalar" && actual.items.type === "string")))
        return fail(path, `Port '${name}' requires a list of strings or object references`);
      return actual;
    }
    return concretePort(declared, path);
  }

  for (const [port, source] of Object.entries(member.inputs ?? {})) {
    const path = `inputs.${port}`;
    const declared = component.inputs && Object.hasOwn(component.inputs, port) ? component.inputs[port] : undefined;
    const actual = "state" in source ? stateInputType(source, path) : undefined;
    const expected = declared ? boundComponentPort(port, declared, actual, path) : undefined;
    bindMemberInput(port, source, path, expected, bindingType);
  }

  for (const [port, fieldName] of Object.entries(member.state ?? {})) {
    const path = `state.${port}`;
    const actual = stateType(fieldName, path);
    const input = component.inputs && Object.hasOwn(component.inputs, port) ? component.inputs[port] : undefined;
    const output = component.outputs && Object.hasOwn(component.outputs, port) ? component.outputs[port] : undefined;
    if (input) {
      const expected = boundComponentPort(port, input, actual, path);
      if (!directProjectionInputAccepts(expected, actual))
        fail(path, `State '${fieldName}' has an incompatible type for component input '${port}'`);
      bindInput(port, fieldName, path);
    }
    if (output) {
      const usesOntologyNodes = componentId === "@ontomato/sdk:ObjectList" && readsOntologyObjects && objectTypeOf(output) === "@binding";
      if (usesOntologyNodes && output.kind === "list")
        fail(path, "The objects read exposes several types, but list state requires one object type");
      let offered: DirectPanelPortType;
      if (usesOntologyNodes) {
        offered = ontologyNode;
      } else if (
        componentId === "@ontomato/sdk:ObjectList"
        && port === "selected"
        && actual.kind === "child-object"
      ) {
        const rowsDatum = data.rows;
        const rowsParentType = dataTypes.get("rows");
        const hasDeclaredCollection = rowsParentType !== undefined
          && objectTypes[rowsParentType]?.childCollections?.includes(actual.collection) === true;
        if (
          rowsDatum !== undefined
          && "object" in rowsDatum.source
          && rowsParentType === actual.parentType
          && dataRowTypes.get("rows") === rowsParentType
          && hasDeclaredCollection
        ) {
          offered = actual;
        } else {
          offered = boundComponentPort(port, output, actual, path);
        }
      } else if (componentId === "@ontomato/sdk:GroupedGrid" && port === "layout" && actual.kind === "grid-layout") {
        offered = actual;
      } else if (componentId === "@ontomato/sdk:ObjectTree" && port === "selected") {
        offered = actual.kind === "object"
          ? concretePort({ kind: "object", objectType: "@binding" }, path)
          : { kind: "scalar", type: "string" };
      } else if (componentId === "@ontomato/sdk:ObjectRefCard" && port === "navigate") {
        const targetClassName = typeof member.config?.targetClassName === "string" ? member.config.targetClassName.trim() : "";
        if (targetClassName) {
          offered = { kind: "object", objectType: targetClassName };
        } else if (member.config?.field === undefined && bindingType !== undefined && dataTypes.get("record") === bindingType) {
          offered = { kind: "object", objectType: bindingType };
        } else {
          offered = concretePort(output, path);
        }
      } else {
        offered = boundComponentPort(port, output, actual, path);
      }
      if (!panelPortAccepts(actual, offered))
        fail(path, `State '${fieldName}' cannot receive component output '${port}'`);
      outputTypes.set(port, offered);
      outputBindings.set(port, { state: fieldName });
    }
    if (!input && !output && !consumedState.has(port)) fail(path, "Expected a component port or a registered read parameter");
  }

  const config = { ...member.config };
  if (componentId === "@ontomato/sdk:GroupedGrid" && config.items !== undefined) {
    const items = config.items;
    if (!Array.isArray(items)) {
      return fail("config.items", "GroupedGrid 'config.items' must be an array");
    }
    const layoutStatePort = member.state?.layout !== undefined ? state[member.state.layout]?.type : undefined;
    const allowedItems = layoutStatePort?.kind === "grid-layout" && layoutStatePort.itemIds
      ? new Set(layoutStatePort.itemIds)
      : null;
    const allowedGroups = layoutStatePort?.kind === "grid-layout" && layoutStatePort.groupIds
      ? new Set(layoutStatePort.groupIds)
      : null;
    const seenItems = new Set<string>();
    for (let index = 0; index < items.length; index++) {
      const entry = items[index];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return fail(`config.items.${index}`, "Each GroupedGrid static item must be an object with an 'id'");
      }
      const itemId = typeof (entry as Record<string, unknown>).id === "string"
        ? ((entry as Record<string, unknown>).id as string).trim()
        : "";
      if (!itemId) {
        return fail(`config.items.${index}.id`, "Each GroupedGrid static item requires a non-empty string 'id'");
      }
      if (seenItems.has(itemId)) {
        return fail(`config.items.${index}.id`, `Duplicate GroupedGrid static item id '${itemId}'`);
      }
      seenItems.add(itemId);
      if (allowedItems && !allowedItems.has(itemId)) {
        return fail(`config.items.${index}.id`, `Static item '${itemId}' is not declared in layout state's itemIds`);
      }
      const groupId = typeof (entry as Record<string, unknown>).groupId === "string"
        ? ((entry as Record<string, unknown>).groupId as string).trim()
        : "";
      if (groupId && allowedGroups && !allowedGroups.has(groupId)) {
        return fail(`config.items.${index}.groupId`, `Static item group '${groupId}' is not declared in layout state's groupIds`);
      }
    }
    if (allowedGroups && Array.isArray(config.groups)) {
      for (let index = 0; index < config.groups.length; index++) {
        const entry = config.groups[index];
        const groupId = entry && typeof entry === "object" && !Array.isArray(entry) && typeof (entry as Record<string, unknown>).id === "string"
          ? ((entry as Record<string, unknown>).id as string).trim()
          : "";
        if (groupId && !allowedGroups.has(groupId)) {
          return fail(`config.groups.${index}.id`, `Static group '${groupId}' is not declared in layout state's groupIds`);
        }
      }
    }
  }
  if (componentId === "@ontomato/sdk:ObjectList" && typeof config.openOutput === "string") {
    const rowsType = dataTypes.get("rows");
    const rowsRead = data.rows?.read;
    const rowsDeclaration = rowsType && rowsRead ? typeTable.objectTypes[rowsType]?.reads?.[rowsRead] : undefined;
    const outputType = rowsDeclaration?.outputs?.[config.openOutput];
    if (!outputType || outputType.kind !== "scalar" || outputType.type !== "string") {
      fail(
        "config.openOutput",
        `Read '${rowsRead ?? "rows"}' on '${rowsType ?? "unknown"}' does not declare a string output '${config.openOutput}'`,
      );
    }
  }
  const operationEntries: Record<string, ProjectionOperationBinding> = {};
  let readOperationInputs: PanelMember["readOperationInputs"];
  let operationDrafts: PanelMember["operationDrafts"];

  function expandOperationParams(
    rawParams: Record<string, NonNullable<ShortMember["operationParams"]>[string]> | undefined,
    prefix: string,
  ): Record<string, ProjectionOperationParam> | undefined {
    const entries = Object.entries(rawParams ?? {}).map(([param, source]): readonly [string, ProjectionOperationParam] => {
      const paramPath = `${prefix}.${param}`;
      if ("literal" in source || "row" in source || "rowField" in source || "formField" in source || "formFields" in source) return [param, source];
      if ("input" in source) {
        if (!inputTypes.has(source.input)) fail(paramPath, `Input '${source.input}' is not declared on this member`);
        return [param, source];
      }
      return [param, bindMemberInput(param, source, paramPath, undefined, bindingType)];
    });
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  if (ownerOperation) {
    const { type: ownerType, operation } = ownerOperation;
    let target: ProjectionOperationBinding["target"];
    if (operation.target.source !== "none" && !readsDraft) {
      if (targetIsFromSlot) {
        const resolvedOwnerType = ownerType ?? fail("target", `Operation '${operation.id}' requires a declared owner type`);
        inputTypes.set(targetPort, { kind: "object", objectType: resolvedOwnerType });
        target = { input: targetPort };
      } else if (targetStateName !== undefined) {
        target = bindInput(targetPort, targetStateName, "target");
      } else if (member.inputs && Object.hasOwn(member.inputs, targetPort)) {
        target = { input: targetPort };
      }
    }
    const opParams = expandOperationParams(member.operationParams, "operationParams");
    const binding: ProjectionOperationBinding = {
      operation: { kind: ownerType?.startsWith("platform:") ? "PlatformOperation" : "Action", id: operation.id },
      ...(target && { target }),
      ...(opParams && { params: opParams }),
    };
    if (!projectionOperationTargetMatches({ inputs: Object.fromEntries(inputTypes) }, binding, operation, ownerType)) {
      const expectedTarget = formatOperationTargetTypes(ownerType, operation.targetTypes);
      fail("target", expectedTarget
        ? `Operation '${operation.id}' requires a compatible target of type '${expectedTarget}'`
        : `Operation '${operation.id}' takes no target`);
    }
    const localName = panelLocalOperationNameSchema.safeParse(operation.id.split(".").at(-1));
    if (!localName.success) return fail("operation", `'${operation.id}' has no usable local operation name`);
    const name = localName.data;
    operationEntries[name] = binding;
    if (readsDraft) {
      const slot = member.draft ?? fail("draft", `Operation '${operation.id}' requires the key of the form member whose draft it reads`);
      readOperationInputs = { [name]: {
        draft: { slot },
        parameters: member.parameters ?? { fields: {} },
        ...(member.bindingId && { bindingId: member.bindingId }),
      } };
    } else if (member.draft !== undefined) {
      operationDrafts = { [name]: { slot: member.draft } };
    }
    if (component.config?.some(field => field.name === "operation")) {
      if (Object.hasOwn(config, "operation") && config.operation !== name)
        fail("config.operation", `Expected '${name}' for operation '${operation.id}'`);
      config.operation = name;
    }
  }

  for (const [localName, spec] of Object.entries(member.operations ?? {})) {
    const opPath = `operations.${localName}`;
    const parsedName = panelLocalOperationNameSchema.safeParse(localName);
    if (!parsedName.success) fail(opPath, parsedName.error.issues[0]!.message);
    if (Object.hasOwn(operationEntries, localName)) fail(opPath, `Duplicate operation name '${localName}'`);
    const normalized = typeof spec === "string" ? { operation: spec } : spec;
    const { type: ownerType, operation } = lookupOwnerOperation(normalized.operation, normalized.type ?? bindingType, opPath);
    const opTargetPort = operation.target.source === "input" ? operation.target.input : "target";
    const opReadsDraft = operation.effect === "read" && operation.target.source === "draft";
    let target: ProjectionOperationBinding["target"];
    if (operation.target.source !== "none" && !opReadsDraft) {
      if (normalized.target === "row") {
        target = { row: true };
      } else if (typeof normalized.target === "string") {
        target = bindInput(opTargetPort, normalized.target, `${opPath}.target`);
      } else if (normalized.target !== undefined) {
        if ("row" in normalized.target || "rowField" in normalized.target || "literal" in normalized.target) {
          target = normalized.target;
        } else {
          target = bindInput(opTargetPort, normalized.target.state, `${opPath}.target`);
        }
      } else if (componentId === "@ontomato/sdk:ObjectList") {
        target = { row: true };
      } else if (targetIsFromSlot) {
        const resolvedOwnerType = ownerType ?? fail(`${opPath}.target`, `Operation '${operation.id}' requires a declared owner type`);
        inputTypes.set(opTargetPort, { kind: "object", objectType: resolvedOwnerType });
        target = { input: opTargetPort };
      } else if (targetStateName !== undefined) {
        target = bindInput(opTargetPort, targetStateName, `${opPath}.target`);
      } else if (member.inputs && Object.hasOwn(member.inputs, opTargetPort)) {
        target = { input: opTargetPort };
      }
    }
    const opParams = expandOperationParams(normalized.params, `${opPath}.params`);
    const binding: ProjectionOperationBinding = {
      operation: { kind: ownerType?.startsWith("platform:") ? "PlatformOperation" : "Action", id: operation.id },
      ...(target && { target }),
      ...(opParams && { params: opParams }),
    };
    if (!projectionOperationTargetMatches({ inputs: Object.fromEntries(inputTypes) }, binding, operation, ownerType)) {
      const expectedTarget = formatOperationTargetTypes(ownerType, operation.targetTypes);
      fail(`${opPath}.target`, expectedTarget
        ? `Operation '${operation.id}' requires a compatible target of type '${expectedTarget}'`
        : `Operation '${operation.id}' takes no target`);
    }
    if (normalized.draft !== undefined) {
      if (operation.effect === "read" && operation.target.source === "draft") {
        readOperationInputs = {
          ...readOperationInputs,
          [localName]: { draft: { slot: normalized.draft }, parameters: { fields: {} } },
        };
      } else if (operation.effect === "write") {
        operationDrafts = { ...operationDrafts, [localName]: { slot: normalized.draft } };
      } else {
        fail(`${opPath}.draft`, "This field requires a write operation or a read operation that reads a form draft");
      }
    }
    operationEntries[localName] = binding;
  }

  const operations = Object.keys(operationEntries).length ? operationEntries : undefined;

  return {
    projection: {
      componentId, inputs: Object.fromEntries(inputTypes), outputs: Object.fromEntries(outputTypes),
      data, config, ...(operations && { operations }), ...(conversationEntry && { conversationEntry }),
    },
    placement: {
      ...(inputBindings.size && { inputs: Object.fromEntries(inputBindings) }),
      ...(outputBindings.size && { outputs: Object.fromEntries(outputBindings) }),
      ...(readOperationInputs && { readOperationInputs }),
      ...(operationDrafts && { operationDrafts }),
    },
  };
}

/** Bind an author member to the formal chart record returned by the source owner. */
export function bindPanelAuthoringChart(
  key: string,
  member: ShortMember,
  { state, projection }: { state: PanelManifest["state"]; projection: unknown },
): PanelMember {
  const fail = (field: string, message: string): never => {
    throw new Error(`Member '${key}', field '${field}': ${message}`);
  };
  const card = member.sourceCard ?? fail("sourceCard", "Declare a source card");
  const parsed = chartProjectionSchema.safeParse(projection);
  if (!parsed.success) return fail("sourceCard", "The owner did not return a valid chart projection");
  const saved = parsed.data;
  const source = saved.data.template?.source;
  if (!source || !("object" in source) || !("literal" in source.object) ||
      source.object.literal.className !== DASHBOARD_CARD || source.object.literal.primaryKey !== dashboardCardPrimaryKey(card))
    return fail("sourceCard", "The chart projection belongs to a different source card");

  const inputs = Object.fromEntries(Object.entries(member.state ?? {}).map(([parameter, stateName]) => {
    const field = `state.${parameter}`;
    if (!Object.hasOwn(saved.inputs, parameter)) return fail(field, "The source card does not expose this input");
    if (!Object.hasOwn(state, stateName)) return fail(field, `State '${stateName}' is not declared`);
    const expected = saved.inputs[parameter];
    if (!directProjectionInputAccepts(expected, state[stateName].type))
      return fail(field, `State '${stateName}' has an incompatible type for source card input '${parameter}'`);
    return [parameter, { state: stateName }];
  }));
  return { target: { projectionId: saved.id }, ...(Object.keys(inputs).length && { inputs }) };
}
