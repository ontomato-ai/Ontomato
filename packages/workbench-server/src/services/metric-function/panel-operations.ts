import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  DATA_QUERY_GATEWAY, DELETE_FUNCTION, DELETE_METRIC_VIEW, FUNCTION, METRIC_VIEW,
} from "@ontomato/contracts/panel-client-requests";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { HttpError } from "../../utils/errors";
import type {
  PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelServerOperation,
} from "../product-panels/server-operations";

/*
 * The metric and function owners as panel server operations: the form save the coordinator dispatches for a person's
 * or an agent's call, and the two delete actions. The owners answer through the data-query service with their usual
 * envelope; a `success:false` answer is a business failure, while an HTTP failure is an uncertain transport result.
 */

const ownerEnvelopeSchema = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: z.unknown().optional(),
}).passthrough();

const savedIdSchema = z.object({ id: z.string().min(1) }).passthrough();
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

async function targetLabel(host: Host, target: PanelRecordTarget, path: string): Promise<string> {
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: target.primaryKey }),
  });
  if (!response.ok) return target.primaryKey;
  const envelope = ownerEnvelopeSchema.parse(await response.json());
  return envelope.success ? labelSchema.parse(envelope.data).name : target.primaryKey;
}

async function save(host: Host, path: string, values: unknown, refusalCode: string): Promise<PanelOperationOutcome> {
  const envelope = await ownerPost(host, path, values);
  return envelope.success
    ? { kind: "success", data: runtimeJsonObjectSchema.parse(envelope.data) }
    : { kind: "failure", code: refusalCode, message: envelope.message ?? "The owner refused the save" };
}

async function remove(host: Host, path: string, id: string, refusalCode: string): Promise<PanelOperationOutcome> {
  const envelope = await ownerPost(host, path, { id });
  return envelope.success
    ? { kind: "success", data: {} }
    : { kind: "failure", code: refusalCode, message: envelope.message ?? "The owner refused the delete" };
}

const formInstructions = "Read the form for the intended target. Use its fields, values and save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.";

export const m5ServerOperations = [
  {
    handlerRef: `${METRIC_VIEW}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: METRIC_VIEW },
    targetType: METRIC_VIEW,
    targetSchema: metricSaveTarget,
    inputSchema: saveInputSchema,
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
    async execute(host: Host, _target: PanelOperationTarget, input: Record<string, unknown>): Promise<PanelOperationOutcome> {
      return save(host, "/metricView/save", saveInputSchema.parse(input).values, "METRIC_VIEW_SAVE_REFUSED");
    },
  },
  {
    handlerRef: DELETE_METRIC_VIEW,
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_METRIC_VIEW },
    targetType: METRIC_VIEW,
    targetSchema: metricObjectTarget,
    inputSchema: deleteInputSchema,
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/metricView/queryById"),
    async execute(host: Host, target: PanelOperationTarget): Promise<PanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected metric");
      return remove(host, "/metricView/delete", target.primaryKey, "METRIC_VIEW_DELETE_REFUSED");
    },
  },
  {
    handlerRef: `${FUNCTION}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: FUNCTION },
    targetType: FUNCTION,
    targetSchema: functionSaveTarget,
    inputSchema: saveInputSchema,
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
    async execute(host: Host, _target: PanelOperationTarget, input: Record<string, unknown>): Promise<PanelOperationOutcome> {
      return save(host, "/function/save", saveInputSchema.parse(input).values, "FUNCTION_SAVE_REFUSED");
    },
  },
  {
    handlerRef: DELETE_FUNCTION,
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_FUNCTION },
    targetType: FUNCTION,
    targetSchema: functionObjectTarget,
    inputSchema: deleteInputSchema,
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/function/queryById"),
    async execute(host: Host, target: PanelOperationTarget): Promise<PanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected function");
      return remove(host, "/function/delete", target.primaryKey, "FUNCTION_DELETE_REFUSED");
    },
  },
] satisfies readonly PanelServerOperation[];
