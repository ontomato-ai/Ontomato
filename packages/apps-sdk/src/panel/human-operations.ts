import {
  panelHumanOperationPreparationSchema, panelOperationDescriptorResponseSchema, readPanelOperationResponseSchema,
  type PanelHumanOperationPreparation, type PanelUseRef,
} from "@ontomato/contracts/panel-agent";
import type { AppBridgeConfirmPanelOperationResult } from "@ontomato/contracts/app-bridge";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type { PlatformRequests } from "./platform-objects";
import type { ReadOperationInput } from "./read-operation-input";

/*
 * A person's operation, run the way an agent's is (design 3): the platform's coordinator holds the owner's description
 * and runs the owner's registered operation under the reader's own credential. The frame asks for the description,
 * runs a read there directly, and for a write prepares one intent that freezes the exact calls; the host then confirms
 * it where the owner or a batch asks for that, dispatches it once and hands the frame the receipt. The frame never runs
 * an owner's write itself.
 */

export type PanelOperationDescriptor = ReturnType<typeof panelOperationDescriptorResponseSchema.parse>;
export type PanelWriteInvocation = { call: Omit<PanelOperationCall, "draft"> } | { calls: [WriteCall, ...WriteCall[]] };
type WriteCall = { target: { kind: "object"; objectType: string; primaryKey: string }; input: Record<string, unknown> };

export interface PanelHumanOperations {
  /** The owner's description of one operation of this panel: its effect, schemas, target, batch and confirmation. */
  describe(operationId: string): Promise<PanelOperationDescriptor>;
  /** Runs a read-only operation and returns what it read; nothing is written and nothing reported changed. */
  read(operationId: string, call: { target: PanelOperationCall["target"]; input: ReadOperationInput }): Promise<PanelReadOperationResult>;
  /** Freezes one write, of one call or a batch, for the host to confirm and dispatch. */
  prepare(operationId: string, invocation: PanelWriteInvocation): Promise<PanelHumanOperationPreparation>;
}

/** What the host does with a prepared write: confirms it where it must and dispatches it once, or the reader cancels. */
export type ConfirmPanelOperation = (preparation: PanelHumanOperationPreparation) => Promise<AppBridgeConfirmPanelOperationResult>;

/** The coordinator's refusal or failure, with its own message. */
async function answer(response: Promise<Response>): Promise<unknown> {
  try {
    return await (await response).json();
  } catch (error) {
    const payload = (error as { payload?: { error?: string | { message?: string }; message?: string } }).payload;
    const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message ?? payload?.message;
    if (message) throw new Error(message, { cause: error });
    throw error;
  }
}

/**
 * The operations of the application use this panel runs as. A candidate preview runs as no use: it shows the panel but
 * runs none of its operations.
 */
export function panelHumanOperations(use: PanelUseRef | null, requests: PlatformRequests): PanelHumanOperations {
  const of = (operationId: string) => {
    if (!use) throw new Error("A panel preview runs no operations; they run in the panel's application");
    return { applicationId: use.applicationId, useId: use.useId, operationId };
  };
  const post = (path: string, body: unknown) =>
    answer(requests.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, ""));
  return {
    async describe(operationId) {
      const query = new URLSearchParams(of(operationId));
      return panelOperationDescriptorResponseSchema.parse(await answer(requests.request(`/panel-operations/descriptor?${query}`, {}, "")));
    },
    async read(operationId, call) {
      return readPanelOperationResponseSchema.parse(await post("/panel-operations/read", { ...of(operationId), call }));
    },
    async prepare(operationId, invocation) {
      return panelHumanOperationPreparationSchema.parse(await post("/panel-operations/intents", { ...of(operationId), ...invocation }));
    },
  };
}
