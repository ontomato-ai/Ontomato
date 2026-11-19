import { z } from "zod";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, METRIC_VIEW, SET_METRIC_VIEW_STATUS, TEST_EXECUTE_METRIC_VIEW, TEST_METRIC_VIEW,
} from "@ontomato/contracts/panel-client-requests";
import { panelReadOperationCallSchema, panelReadOperationInputSchema } from "@ontomato/contracts/panel-operations";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import type {
  PanelBatchCalls, PanelImpactInspector, PanelOperationTarget, PanelRecordTarget, PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import {
  affected, ownerEnvelopeSchema, ownerPost, ownerRecord, remove, save, savedIdSchema, targetLabel,
  valuesForTarget, type DataQueryOperationHost as Host,
} from "../product-panels/data-query-operations";

/*
 * The metric and function owners as panel server operations: the form saves the coordinator dispatches for a person's
 * or an agent's call, the two delete actions with the impact their confirming human reads, and the batch change of a
 * metric's publication status. The owners answer through the data-query service with their usual envelope; a
 * `success:false` answer is the owner's refusal, while an HTTP failure is an uncertain transport result. A successful
 * write names what changed: saving a metric may also change the function its definition embeds.
 */

const deletedSchema = z.object({}).strict();
/** The delete impact reads the name a confirming human recognizes and the bindings the delete takes with it. */
const metricImpactSchema = z.object({ name: z.string(), bindings: z.array(z.unknown()) }).passthrough();
const statusInputSchema = z.object({ status: z.enum(["PENDING_REVIEW", "PUBLISHED", "UNUSED"]) }).strict();
/** The owner answers one status change per requested id, with the saved metric or its reason. */
const statusItemSchema = z.discriminatedUnion("outcome", [
  z.object({ id: z.string().min(1), outcome: z.literal("success"), data: z.unknown() }).strict(),
  z.object({ id: z.string().min(1), outcome: z.literal("failure"), error: z.object({ message: z.string() }).strict() }).strict(),
]);
const statusAnswerSchema = z.object({ items: z.array(statusItemSchema).nonempty() }).strict();

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

type StatusAnswer = { refused: string } | { items: Map<string, z.infer<typeof statusItemSchema>> };

/** One owner call: either its refusal for every requested id, or the owner's answer per id. */
async function changeStatus(host: Host, ids: string[], status: string): Promise<StatusAnswer> {
  const envelope = await ownerPost(host, "/metricView/setStatus", { ids, status }, ownerEnvelopeSchema);
  if (!envelope.success) return { refused: envelope.message ?? "The owner refused the status change" };
  return { items: new Map(statusAnswerSchema.parse(envelope.data).items.map(item => [item.id, item])) };
}

/** The owner's answer for one metric: a success carries the saved metric; a failure keeps the owner's reason. */
function statusOutcome(answer: StatusAnswer, id: string): SinglePanelOperationOutcome {
  if ("refused" in answer) return { kind: "refusal", code: "METRIC_VIEW_STATUS_REFUSED", message: answer.refused };
  const item = answer.items.get(id)!;
  if (item.outcome !== "success") return { kind: "refusal", code: "METRIC_VIEW_STATUS_REFUSED", message: item.error.message };
  const data = runtimeJsonObjectSchema.parse(item.data);
  return { kind: "success", data, affected: affected(METRIC_VIEW, savedIdSchema.parse(data).id, [METRIC_VIEW]) };
}

/*
 * The impact a delete shows its confirming human: each selected object under its owner-read name, with the bindings a
 * metric takes with it. A function referenced by a metric, an action or a write task is refused by the owner; the
 * description says so and does not rejudge the rule.
 */
const deleteMetricViewImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_METRIC_VIEW}.inspect-impact`,
  async inspect(host, calls) {
    const targets = calls.map(call => call.target as PanelRecordTarget);
    const records = await Promise.all(targets.map(async target =>
      metricImpactSchema.parse(await ownerRecord(host, target, "/metricView/queryById", "METRIC_VIEW_UNAVAILABLE"))));
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteMetricViewImpact",
        { bindings: records.reduce((total, record) => total + record.bindings.length, 0) }),
      objects: targets.map((target, index) => ({
        target: { objectType: target.objectType, primaryKey: target.primaryKey }, label: records[index]!.name,
      })),
      total: targets.length,
    };
  },
};
const deleteFunctionImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_FUNCTION}.inspect-impact`,
  async inspect(host, calls) {
    const targets = calls.map(call => call.target as PanelRecordTarget);
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteFunctionImpact"),
      objects: await Promise.all(targets.map(async target => ({
        target: { objectType: target.objectType, primaryKey: target.primaryKey },
        label: await targetLabel(host, target, "/function/queryById", "FUNCTION_UNAVAILABLE"),
      }))),
      total: targets.length,
    };
  },
};

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
  const envelope = await ownerPost(host, path, body, trialEnvelopeSchema);
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
        "METRIC_VIEW_SAVE_FAILED", METRIC_VIEW, [METRIC_VIEW, FUNCTION]);
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
    inspectImpact: deleteMetricViewImpact,
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected metric");
      return remove(host, "/metricView/delete", target, "METRIC_VIEW_DELETE_FAILED");
    },
  },
  {
    handlerRef: SET_METRIC_VIEW_STATUS,
    kind: "action",
    binding: { kind: "PlatformOperation", id: SET_METRIC_VIEW_STATUS },
    effect: "write",
    batch: true,
    targetType: METRIC_VIEW,
    targetSchema: metricObjectTarget,
    inputSchema: statusInputSchema,
    resultSchema: savedIdSchema,
    targetInput: "metric",
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/metricView/queryById", "METRIC_VIEW_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("The status change acts on a selected metric");
      const { status } = statusInputSchema.parse(input);
      return statusOutcome(await changeStatus(host, [target.primaryKey], status), target.primaryKey);
    },
    async executeBatch(host: Host, calls: readonly PanelBatchCalls[number][]): Promise<PanelOperationOutcome> {
      // Each call may set its own status; the owner takes one status per request, so the calls go in one request per
      // status and every call reads its own answer.
      const statuses = calls.map(call => statusInputSchema.parse(call.input).status);
      const answers = new Map<string, StatusAnswer>();
      for (const status of new Set(statuses))
        answers.set(status, await changeStatus(host, calls.filter((_, index) => statuses[index] === status)
          .map(call => call.target.primaryKey), status));
      // A batch invocation is nonempty, so the items tuple starts with the first call's answer and spreads the rest.
      const [first, ...rest] = calls.map((call, index) => ({
        target: { objectType: call.target.objectType, primaryKey: call.target.primaryKey },
        outcome: statusOutcome(answers.get(statuses[index]!)!, call.target.primaryKey),
      }));
      return { kind: "batch", items: [first!, ...rest] };
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
        "FUNCTION_SAVE_FAILED", FUNCTION, [FUNCTION]);
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
    inspectImpact: deleteFunctionImpact,
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected function");
      return remove(host, "/function/delete", target, "FUNCTION_DELETE_FAILED");
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
