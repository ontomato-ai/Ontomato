import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  DATA_QUERY_GATEWAY, DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, METRIC_VIEW, TEST_EXECUTE_METRIC_VIEW, TEST_METRIC_VIEW,
} from "@ontomato/contracts/panel-client-requests";
import { panelReadOperationCallSchema, panelReadOperationInputSchema } from "@ontomato/contracts/panel-operations";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { HttpError } from "../../utils/errors";
import type {
  PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelServerOperation, SinglePanelOperationOutcome,
} from "../product-panels/server-operations";

/*
 * The metric and function owners as panel server operations: the form save the coordinator dispatches for a person's
 * or an agent's call, and the two delete actions. The owners answer through the data-query service with their usual
 * envelope; a `success:false` answer is the owner's refusal, while an HTTP failure is an uncertain transport result. A
 * successful write names what changed: saving a metric may also change the function its definition embeds.
 */

const ownerEnvelopeSchema = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: z.unknown().optional(),
}).passthrough();

const savedIdSchema = z.object({ id: z.string().min(1) }).passthrough();
const deletedSchema = z.object({}).strict();
const labelSchema = z.object({ name: z.string() }).passthrough();

const metricObjectTarget = z.object({
  kind: z.literal("object"), objectType: z.literal(METRIC_VIEW), primaryKey: z.string().min(1),
}).strict();
const functionObjectTarget = z.object({
  kind: z.literal("object"), objectType: z.literal(FUNCTION), primaryKey: z.string().min(1),
}).strict();
const metricSaveTarget = z.discriminatedUnion("kind", [metricObjectTarget, panelFormTargetSchema.options[1]]);
const functionSaveTarget = z.discriminatedUnion("kind", [functionObjectTarget, panelFormTargetSchema.options[1]]);
const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const deleteInputSchema = z.object({}).strict();

type Host = Pick<PanelOperationHost, "request">;

async function ownerPost(host: Host, path: string, body: unknown) {
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new HttpError(response.status, `Owner request failed: ${path}`, "OWNER_UNAVAILABLE");
  return ownerEnvelopeSchema.parse(await response.json());
}

async function targetLabel(host: Host, target: PanelRecordTarget, path: string, code: string): Promise<string> {
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: target.primaryKey }),
  });
  if (!response.ok) {
    const body = await response.json() as { message?: string; error?: { message?: string } } | null;
    throw new HttpError(response.status, body?.message ?? body?.error?.message ?? "The owner could not read the target", code);
  }
  const envelope = ownerEnvelopeSchema.parse(await response.json());
  if (!envelope.success) throw new HttpError(404, envelope.message ?? "The owner could not read the target", code);
  return labelSchema.parse(envelope.data).name;
}

/** A save writes the chosen target: an existing id must match, and a new object carries none. */
function valuesForTarget(target: PanelOperationTarget, values: Record<string, unknown>): Record<string, unknown> {
  if (target.kind === "draft") {
    if (Object.hasOwn(values, "id"))
      throw new HttpError(400, "A new object cannot carry an id", "TARGET_ID_MISMATCH");
    return values;
  }
  if (Object.hasOwn(values, "id") && values.id !== target.primaryKey)
    throw new HttpError(400, "The values name another object", "TARGET_ID_MISMATCH");
  return { ...values, id: target.primaryKey };
}

/** The objects a write changed and the types whose lists and counts follow it. */
const affected = (objectType: string, primaryKey: string, objectTypes: string[]) => ({
  objects: [{ objectType, primaryKey }], objectTypes,
});

async function save(
  host: Host, path: string, values: unknown, refusalCode: string, objectType: string, objectTypes: string[],
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, path, values);
  if (!envelope.success) return { kind: "refusal", code: refusalCode, message: envelope.message ?? "The owner refused the save" };
  const data = runtimeJsonObjectSchema.parse(envelope.data);
  return { kind: "success", data, affected: affected(objectType, savedIdSchema.parse(data).id, objectTypes) };
}

async function remove(
  host: Host, path: string, target: PanelRecordTarget, refusalCode: string,
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, path, { id: target.primaryKey });
  return envelope.success
    ? { kind: "success", data: {}, affected: affected(target.objectType, target.primaryKey, [target.objectType]) }
    : { kind: "refusal", code: refusalCode, message: envelope.message ?? "The owner refused the delete" };
}

/*
 * The two read-only trials of a metric's unsaved definition. Both read the draft the metric panel's definition form
 * holds, with the parameter values the reader chose, and save nothing. The test answers in Markdown and reads the
 * parameter values from the function's own parameter definitions; the test-and-return-JSON takes them beside the
 * draft, and an optional saved binding, and its owner checks that the metric may run.
 */
const METRIC_FORM_SLOT = "definition";
const metricTrialTarget = metricSaveTarget.nullable();
const parameterDefinitionsSchema = z.array(z.object({ name: z.string() }).passthrough());
const trialDraftSchema = z.object({
  function: z.object({
    queryPackage: z.object({
      manifest: z.object({ parameterDefs: parameterDefinitionsSchema }).passthrough(),
    }).passthrough().nullish(),
    parameters: parameterDefinitionsSchema.nullish(),
  }).passthrough(),
}).passthrough();
const markdownResultSchema = z.object({ kind: z.literal("markdown"), markdown: z.string() }).strict();
const jsonResultSchema = z.object({ kind: z.literal("json"), value: runtimeJsonValueSchema }).strict();
const testedContentSchema = z.object({ md: z.string() }).passthrough();
const trialEnvelopeSchema = ownerEnvelopeSchema.extend({
  code: z.string().nullish(),
  truncated: z.boolean().optional(),
  rowLimit: z.number().nullish(),
  truncationHint: z.string().nullish(),
});

/** The draft with the chosen values written into the parameter definitions the trial reads them from. */
function withParameterValues(draft: Record<string, unknown>, parameters: Record<string, unknown>) {
  const copy = trialDraftSchema.parse(structuredClone(draft));
  const definitions = copy.function.queryPackage ? copy.function.queryPackage.manifest.parameterDefs : copy.function.parameters ?? [];
  for (const definition of definitions)
    if (Object.hasOwn(parameters, definition.name)) definition.value = parameters[definition.name];
  return copy;
}

/** The owner's answer to a trial; a refusal keeps the owner's reason and code. */
async function trial(host: Host, path: string, body: unknown, refusalCode: string) {
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new HttpError(response.status, `Owner request failed: ${path}`, "OWNER_UNAVAILABLE");
  const envelope = trialEnvelopeSchema.parse(await response.json());
  if (!envelope.success) throw new HttpError(422, envelope.message ?? "The owner refused the trial", envelope.code ?? refusalCode);
  return envelope;
}

const formInstructions = "Read the form for the intended target. Use its fields, values and save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.";

export const m5ServerOperations = [
  {
    handlerRef: `${METRIC_VIEW}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: METRIC_VIEW },
    effect: "write",
    batch: false,
    targetType: METRIC_VIEW,
    targetSchema: metricSaveTarget,
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "metric-view.create" : "metric-view.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: METRIC_VIEW, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/metricView/save", valuesForTarget(target, saveInputSchema.parse(input).values),
        "METRIC_VIEW_SAVE_REFUSED", METRIC_VIEW, [METRIC_VIEW, FUNCTION]);
    },
  },
  {
    handlerRef: DELETE_METRIC_VIEW,
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_METRIC_VIEW },
    effect: "write",
    batch: false,
    targetType: METRIC_VIEW,
    targetSchema: metricObjectTarget,
    inputSchema: deleteInputSchema,
    resultSchema: deletedSchema,
    targetInput: "metric",
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/metricView/queryById", "METRIC_VIEW_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected metric");
      return remove(host, "/metricView/delete", target, "METRIC_VIEW_DELETE_REFUSED");
    },
  },
  {
    handlerRef: `${FUNCTION}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: FUNCTION },
    effect: "write",
    batch: false,
    targetType: FUNCTION,
    targetSchema: functionSaveTarget,
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "function.create" : "function.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: FUNCTION, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/function/save", valuesForTarget(target, saveInputSchema.parse(input).values),
        "FUNCTION_SAVE_REFUSED", FUNCTION, [FUNCTION]);
    },
  },
  {
    handlerRef: DELETE_FUNCTION,
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_FUNCTION },
    effect: "write",
    batch: false,
    targetType: FUNCTION,
    targetSchema: functionObjectTarget,
    inputSchema: deleteInputSchema,
    resultSchema: deletedSchema,
    targetInput: "function",
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/function/queryById", "FUNCTION_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected function");
      return remove(host, "/function/delete", target, "FUNCTION_DELETE_REFUSED");
    },
  },
  {
    handlerRef: TEST_METRIC_VIEW,
    binding: { kind: "PlatformOperation", id: TEST_METRIC_VIEW },
    kind: "action",
    effect: "read",
    batch: false,
    target: { source: "draft", slot: METRIC_FORM_SLOT },
    targetSchema: metricTrialTarget,
    inputSchema: panelReadOperationInputSchema,
    resultSchema: markdownResultSchema,
    async execute(host: Host, call: z.infer<typeof panelReadOperationCallSchema>) {
      const { draft, parameters } = call.input;
      const envelope = await trial(host, "/metricView/test", withParameterValues(draft, parameters), "METRIC_VIEW_TEST_REFUSED");
      return { kind: "markdown" as const, markdown: testedContentSchema.parse(envelope.data).md };
    },
  },
  {
    handlerRef: TEST_EXECUTE_METRIC_VIEW,
    binding: { kind: "PlatformOperation", id: TEST_EXECUTE_METRIC_VIEW },
    kind: "action",
    effect: "read",
    batch: false,
    target: { source: "draft", slot: METRIC_FORM_SLOT },
    targetSchema: metricTrialTarget,
    inputSchema: panelReadOperationInputSchema,
    resultSchema: jsonResultSchema,
    async execute(host: Host, call: z.infer<typeof panelReadOperationCallSchema>) {
      const { draft, parameters, bindingId } = call.input;
      const envelope = await trial(host, "/metricView/testExecute",
        { metricView: draft, param: parameters, ...(bindingId ? { bindingId } : {}) }, "METRIC_VIEW_TEST_EXECUTE_REFUSED");
      // A truncated run is a partial result: the reader sees that it is, and why, beside the rows.
      const value = runtimeJsonValueSchema.parse({
        result: envelope.data ?? null,
        ...(envelope.truncated ? { truncated: true, rowLimit: envelope.rowLimit ?? null, truncationHint: envelope.truncationHint ?? null } : {}),
      });
      return { kind: "json" as const, value };
    },
  },
] satisfies readonly PanelServerOperation[];
