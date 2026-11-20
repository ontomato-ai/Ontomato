import { z } from "zod";
import { BUSINESS_KNOWLEDGE, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { matchesDirectPanelValue, panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { authoredReadParameterSource, directReadDeclaration, panelReadParameterId, panelReadParameterSchemas, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import {
  ATTRIBUTE, DELETE_ATTRIBUTE, DELETE_OBJECT_TYPE, DELETE_RELATIONSHIP, OBJECT_TYPE, ONTOLOGY_TYPE, RELATIONSHIP,
  SET_PRIMARY_KEY, platformObjectTypes, type PlatformReadDeclaration,
} from "@ontomato/contracts/platform-object-types";
import { productPanelSchema, type ProductPanel, type ProductProjection } from "@ontomato/contracts/product-panels";
import { currentProductRecord } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { createBusinessKnowledgeReadAdapter } from "../business-knowledge/panel-reads";
import { createOntologyModelReadAdapter } from "../ontology-model/model-reads";
import { createScheduledTaskReadAdapter } from "../scheduling/panel-reads";
import { requirePanelUse } from "./application-use";
import { readPanelComponentCatalogue } from "./component-catalogue";
import { requireCurrentProduct, requireDirectPanelMember } from "./current";

type ReadInputs = ProductPanelReadRequest["inputs"];
type ReadMember = ProductPanel["manifest"]["members"][string];
type ReadSelection = { typeId: string; method: string; primaryKey?: string };
type ReadAdapter = (selection: ReadSelection, params: Record<string, unknown>) => Promise<unknown> | unknown;

function readAdapters(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string): Record<string, Record<string, ReadAdapter>> {
  const schedules = createScheduledTaskReadAdapter(viewer);
  const ontology = async () => {
    const { createPlatformOntologyReadAdapter } = await import("../platform-ontology/panel-reads");
    return createPlatformOntologyReadAdapter(owner, viewer, callerUserName);
  };
  const knowledge = createBusinessKnowledgeReadAdapter(viewer);
  const model = createOntologyModelReadAdapter(owner, viewer, callerUserName);
  const formParams = (params: Record<string, unknown>) => ({
    values: panelReadParameterSchemas.panelFormValues.optional().parse(params.values),
    changedField: panelReadParameterSchemas.changedField.optional().parse(params.changedField),
  });
  const modelReads: Record<string, ReadAdapter> = {
    list: (selection, params) => model.list(selection.typeId, {
      className: panelReadParameterSchemas.className.optional().parse(params.className),
    }),
    record: selection => model.record(selection.typeId, selection.primaryKey!),
    form: (selection, params) => model.form(selection.typeId, selection.primaryKey!, formParams(params)),
    createForm: (selection, params) => model.createForm(selection.typeId, formParams(params)),
  };
  return {
    [OBJECT_TYPE]: { ...modelReads, [`${DELETE_OBJECT_TYPE}.describe`]: () => model.describe(DELETE_OBJECT_TYPE) },
    [ATTRIBUTE]: {
      ...modelReads,
      [`${DELETE_ATTRIBUTE}.describe`]: () => model.describe(DELETE_ATTRIBUTE),
      [`${SET_PRIMARY_KEY}.describe`]: () => model.describe(SET_PRIMARY_KEY),
    },
    [RELATIONSHIP]: { ...modelReads, [`${DELETE_RELATIONSHIP}.describe`]: () => model.describe(DELETE_RELATIONSHIP) },
    [ONTOLOGY_TYPE]: {
      schema: async () => (await ontology()).schema(),
      counts: async () => (await ontology()).counts(),
      start: async () => (await ontology()).start(),
      neighbors: async (_selection, params) => (await ontology()).neighbors(params),
      objects: async (_selection, params) => (await ontology()).objects(params),
    },
    [SCHEDULED_TASK]: {
      list: () => schedules.list(),
      record: selection => schedules.record(selection.primaryKey!),
      form: (selection, params) => schedules.form(selection.primaryKey!, {
        values: panelReadParameterSchemas.formValues.optional().parse(params.values),
        changedField: panelReadParameterSchemas.changedField.optional().parse(params.changedField),
      }),
      "schedules.runNow.describe": () => schedules["schedules.runNow.describe"](),
    },
    [BUSINESS_KNOWLEDGE]: {
      query: (_selection, params) => knowledge.query(params),
      counts: (_selection, params) => knowledge.counts(params),
      record: (selection, params) => knowledge.record(selection.primaryKey!, params),
      form: (selection, params) => knowledge.form(selection.primaryKey!, params),
      createForm: (_selection, params) => knowledge.form(undefined, params),
      "knowledge.approve.describe": () => knowledge["knowledge.approve.describe"](),
      "knowledge.delete.describe": () => knowledge["knowledge.delete.describe"](),
    },
  };
}

async function readRoot(owner: ProductOwner, viewer: AssistantCredentials, source: ProductPanelReadRequest["source"]) {
  if (source.kind === "candidate")
    throw new HttpError(422, "Direct workspace panel reads are not available", "DIRECT_CANDIDATE_UNAVAILABLE");
  const { panelId } = await requirePanelUse(viewer, source);
  const row = await requireCurrentProduct(owner, viewer, "panel", panelId, "use");
  return productPanelSchema.parse(currentProductRecord(row, false));
}

function effectiveInputs(
  projection: ProductProjection, member: ReadMember, submitted: ReadInputs,
): ReadInputs {
  const values = { ...submitted };
  for (const [name, ref] of Object.entries(member.inputs ?? {})) {
    if ("literal" in ref) values[name] = ref.literal;
  }
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(projection.inputs, name)) {
      const implicit = Object.values(projection.data).some(datum => {
        const source = authoredReadParameterSource(datum.params, name, member);
        return source && "state" in source && panelReadParameterId(directReadDeclaration(projection, datum)!, name);
      });
      if (!implicit) throw new HttpError(400, `Unknown projection input: ${name}`, "PANEL_INPUT_UNKNOWN");
      continue;
    }
    const type = projection.inputs[name];
    if (type.kind !== "json" && !matchesDirectPanelValue(type, value))
      throw new HttpError(400, `Invalid projection input: ${name}`, "PANEL_INPUT_TYPE_MISMATCH");
  }
  return values;
}

async function readParameters(
  projection: ProductProjection, member: ReadMember, dataName: string, data: DirectProjectionData,
  declaration: PlatformReadDeclaration, inputs: ReadInputs, runtimeParams: ProductPanelReadRequest["runtimeParams"],
) {
  const resolved = new Map<string, unknown>();
  const runtime = Object.entries(runtimeParams ?? {});
  if (runtime.length) {
    const { components } = await readPanelComponentCatalogue();
    const names = components.get(projection.componentId)?.data?.[dataName]?.runtimeParams ?? [];
    for (const [name, value] of runtime) {
      const parameter = panelReadParameterId(declaration, name);
      if (!parameter || !names.includes(name))
        throw new HttpError(400, `Runtime parameter '${name}' is not declared for data '${dataName}'`, "PANEL_RUNTIME_PARAMETER_UNKNOWN");
      if (value == null) continue;
      const parsed = panelReadParameterSchemas[parameter].parse(value);
      if (!authoredReadParameterSource(data.params, name, member)) resolved.set(name, parsed);
    }
  }
  const authored = new Set([...Object.keys(data.params), ...Object.keys(member.inputs ?? {}), ...Object.keys(member.outputs ?? {})]);
  for (const name of authored) {
    const source = authoredReadParameterSource(data.params, name, member);
    const parameter = panelReadParameterId(declaration, name);
    if (!source || !parameter) continue;
    const value = "literal" in source ? source.literal : inputs["input" in source ? source.input : name];
    if (value != null) resolved.set(name, panelReadParameterSchemas[parameter].parse(value));
  }
  return Object.fromEntries(resolved);
}

function readSelection({ source, read }: DirectProjectionData, inputs: ReadInputs): ReadSelection {
  if ("type" in source) return { typeId: source.type.id, method: read };
  if ("object" in source) {
    const value = "literal" in source.object ? source.object.literal : inputs[source.object.input];
    if (value == null) throw new HttpError(400, "Select an object before reading its data", "PANEL_SELECTION_REQUIRED");
    const { className, primaryKey } = panelObjectRefSchema.parse(value);
    return { typeId: className, method: read, primaryKey };
  }
  if (source.operation.kind === "Action")
    throw new HttpError(422, "Object action reads require an owner adapter", "PANEL_READ_UNAVAILABLE");
  const [typeId] = Object.entries(platformObjectTypes).find(([, entry]) => entry.operations?.includes(source.operation.id))!;
  return { typeId, method: `${source.operation.id}.${read}` };
}

export async function readProductPanelData(
  owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest, callerUserName?: string,
): Promise<ProductPanelReadResponse> {
  try {
    const panel = await readRoot(owner, viewer, request.source);
    if (request.memberPath.length !== 1)
      throw new HttpError(422, "Only a fixed projection at the panel root can be read here", "PANEL_MEMBER_TARGET_UNSUPPORTED");
    const { member: key } = request.memberPath[0];
    const { member, projection } = await requireDirectPanelMember(owner, viewer, panel, key);
    if (!Object.hasOwn(projection.data, request.dataName)) return { status: "forbidden" };
    const data = projection.data[request.dataName];
    const inputs = effectiveInputs(projection, member, request.inputs);
    const selection = readSelection(data, inputs);
    const declaration = directReadDeclaration(projection, data)!;
    const params = await readParameters(projection, member, request.dataName, data, declaration, inputs, request.runtimeParams);
    if (declaration.parameterMode === "fixed") {
      for (const name of declaration.requiredParams ?? [])
        if (!Object.hasOwn(params, name)) throw new HttpError(400, `Missing read parameter: ${name}`, "PANEL_INPUT_REQUIRED");
    }
    const read = readAdapters(owner, viewer, callerUserName)[selection.typeId]?.[selection.method];
    if (!read) throw new HttpError(422, "The owner read is unavailable", "PANEL_READ_UNAVAILABLE");
    const result = await read(selection, params);
    if (declaration.result === "panelRecordList") {
      const value = panelReadResultSchemas.panelRecordList.parse(result);
      return value.length ? { status: "ready", value } : { status: "empty" };
    }
    if (declaration.result === "metricOutput") {
      const value = panelReadResultSchemas.metricOutput.parse(result);
      return value.rows.length || value.truncation ? { status: "ready", value } : { status: "empty" };
    }
    return { status: "ready", value: panelReadResultSchemas[declaration.result].parse(result) };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return { status: "forbidden" };
    if (error instanceof HttpError || error instanceof BackendUnavailableError || error instanceof z.ZodError || error instanceof SyntaxError)
      return { status: "error", message: error.message };
    throw error;
  }
}
