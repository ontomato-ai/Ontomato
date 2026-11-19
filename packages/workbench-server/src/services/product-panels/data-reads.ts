import { z } from "zod";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { matchesDirectPanelValue, panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { directReadDeclaration, panelReadParameterSchemas, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { directPanelSchema, directProjectionSchema, type DirectPanel, type DirectProjection } from "@ontomato/contracts/product-panels";
import { currentProductRecord } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { createScheduledTaskReadAdapter } from "../scheduling/panel-reads";
import { requirePanelUse } from "./application-use";
import { requireCurrentProduct } from "./current";

type ReadInputs = ProductPanelReadRequest["inputs"];
type ReadSelection = { typeId: string; method: string; primaryKey?: string };
type ReadAdapter = (selection: ReadSelection, params: ReadInputs) => Promise<unknown> | unknown;

function readAdapters(viewer: AssistantCredentials): Record<string, Record<string, ReadAdapter>> {
  const schedules = createScheduledTaskReadAdapter(viewer);
  return {
    [SCHEDULED_TASK]: {
      list: () => schedules.list(),
      record: selection => schedules.record(selection.primaryKey!),
      form: (selection, params) => schedules.form(selection.primaryKey!, {
        values: panelReadParameterSchemas.formValues.optional().parse(params.values),
        changedField: panelReadParameterSchemas.changedField.optional().parse(params.changedField),
      }),
      "schedules.runNow.describe": () => schedules["schedules.runNow.describe"](),
    },
  };
}

async function readRoot(owner: ProductOwner, viewer: AssistantCredentials, source: ProductPanelReadRequest["source"]) {
  if (source.kind === "candidate")
    throw new HttpError(422, "Direct workspace panel reads are not available", "DIRECT_CANDIDATE_UNAVAILABLE");
  const { panelId } = await requirePanelUse(viewer, source);
  const row = await requireCurrentProduct(owner, viewer, "panel", panelId, "use");
  return directPanelSchema.parse(currentProductRecord(row, false));
}

function effectiveInputs(
  projection: DirectProjection, member: DirectPanel["manifest"]["members"][string], submitted: ReadInputs,
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
  if ("type" in source) return { typeId: source.type, method: read };
  if ("object" in source) {
    const value = "literal" in source.object ? source.object.literal : inputs[source.object.input];
    if (value == null) throw new HttpError(400, "Select an object before reading its data", "PANEL_SELECTION_REQUIRED");
    const { className, primaryKey } = panelObjectRefSchema.parse(value);
    return { typeId: className, method: read, primaryKey };
  }
  const [typeId] = Object.entries(platformObjectTypes).find(([, entry]) => entry.operations?.includes(source.operation))!;
  return { typeId, method: `${source.operation}.${read}` };
}

export async function readProductPanelData(
  owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest,
): Promise<ProductPanelReadResponse> {
  try {
    const panel = await readRoot(owner, viewer, request.source);
    const { member: key } = request.memberPath[0];
    if (!Object.hasOwn(panel.manifest.members, key)) return { status: "forbidden" };
    const member = panel.manifest.members[key];
    const row = await requireCurrentProduct(owner, viewer, "projection", member.target.projectionId, "use");
    const projection = directProjectionSchema.parse(currentProductRecord(row, false));
    if (!Object.hasOwn(projection.data, request.dataName)) return { status: "forbidden" };
    const data = projection.data[request.dataName];
    const inputs = effectiveInputs(projection, member, request.inputs);
    const selection = readSelection(data, inputs);
    const declaration = directReadDeclaration(projection, data)!;
    const params = Object.fromEntries(
      Object.entries(data.params).flatMap(([name, ref]) => {
        const value = "literal" in ref ? ref.literal : inputs[ref.input];
        return value === undefined ? [] : [[name, value]];
      }),
    );
    const read = readAdapters(viewer)[selection.typeId][selection.method];
    const result = await read(selection, params);
    if (declaration.result === "panelRecordList") {
      const value = panelReadResultSchemas.panelRecordList.parse(result);
      return value.length ? { status: "ready", value } : { status: "empty" };
    }
    return { status: "ready", value: panelReadResultSchemas[declaration.result].parse(result) };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return { status: "forbidden" };
    if (error instanceof HttpError || error instanceof BackendUnavailableError || error instanceof z.ZodError || error instanceof SyntaxError)
      return { status: "error", message: error.message };
    throw error;
  }
}
