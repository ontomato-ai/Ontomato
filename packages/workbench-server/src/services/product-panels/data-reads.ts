import { z } from "zod";
import { BUSINESS_KNOWLEDGE, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { matchesDirectPanelValue, panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { directReadDeclaration, panelReadParameterId, panelReadParameterSchemas, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import { OBJECT_TYPE, ONTOLOGY_TYPE, RELATIONSHIP, platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { productPanelSchema, type ProductPanel, type ProductProjection } from "@ontomato/contracts/product-panels";
import { currentProductRecord } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { createBusinessKnowledgeReadAdapter } from "../business-knowledge/panel-reads";
import { createPlatformOntologyReadAdapter } from "../platform-ontology/panel-reads";
import { createScheduledTaskReadAdapter } from "../scheduling/panel-reads";
import { requirePanelUse } from "./application-use";
import { requireCurrentProduct, requireDirectPanelMember } from "./current";

type ReadInputs = ProductPanelReadRequest["inputs"];
type ReadSelection = { typeId: string; method: string; primaryKey?: string };
type ReadAdapter = (selection: ReadSelection, params: Record<string, unknown>) => Promise<unknown> | unknown;

function readAdapters(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string): Record<string, Record<string, ReadAdapter>> {
  const schedules = createScheduledTaskReadAdapter(viewer);
  const ontology = createPlatformOntologyReadAdapter(owner, viewer, callerUserName);
  const knowledge = createBusinessKnowledgeReadAdapter(viewer);
  return {
    [OBJECT_TYPE]: { list: () => ontology.listObjectTypes() },
    [RELATIONSHIP]: { list: () => ontology.listRelationships() },
    [ONTOLOGY_TYPE]: {
      schema: () => ontology.schema(),
      counts: () => ontology.counts(),
      start: () => ontology.start(),
      neighbors: (_selection, params) => ontology.neighbors(params),
      objects: (_selection, params) => ontology.objects(params),
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
  projection: ProductProjection, member: ProductPanel["manifest"]["members"][string], submitted: ReadInputs,
): ReadInputs {
  const values = { ...submitted };
  for (const [name, ref] of Object.entries(member.inputs ?? {})) {
    if ("literal" in ref) values[name] = ref.literal;
  }
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(projection.inputs, name))
      throw new HttpError(400, `Unknown projection input: ${name}`, "PANEL_INPUT_UNKNOWN");
    const type = projection.inputs[name];
    if (type.kind !== "json" && !matchesDirectPanelValue(type, value))
      throw new HttpError(400, `Invalid projection input: ${name}`, "PANEL_INPUT_TYPE_MISMATCH");
  }
  return values;
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
    const params = Object.fromEntries(
      Object.entries(data.params).flatMap(([name, ref]) => {
        const value = "literal" in ref ? ref.literal : inputs[ref.input];
        if (value === undefined) return [];
        const parameter = panelReadParameterId(declaration, name)!;
        return [[name, panelReadParameterSchemas[parameter].parse(value)]];
      }),
    );
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
