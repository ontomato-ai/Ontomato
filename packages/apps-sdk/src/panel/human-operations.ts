import {
  panelHumanOperationPreparationSchema, panelOperationDescriptorResponseSchema, readPanelOperationResponseSchema,
  type PanelHumanOperationPreparation, type PanelUseRef,
} from "@ontomato/contracts/panel-agent";
import type { AppBridgeConfirmPanelOperationResult } from "@ontomato/contracts/app-bridge";
import type { PanelMemberPath, PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type { PlatformRequests } from "./platform-objects";
import type { ReadOperationInput } from "./read-operation-input";
import type { PanelDownloadMime } from "@ontomato/contracts/panel-download";
import { attachmentName, savePanelFile } from "./save-file";

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

/** A read's call: the object or draft it acts on, if any, and its input — a trial run's, or a caller's own values. */
export interface PanelReadCall {
  target: PanelOperationCall["target"];
  input: ReadOperationInput | Readonly<Record<string, unknown>>;
}

export interface PanelHumanOperations {
  /** The owner's description of one operation of this panel: its effect, schemas, target, batch and confirmation. */
  describe(operationId: string, memberPath?: PanelMemberPath): Promise<PanelOperationDescriptor>;
  /** Runs a read-only operation and returns what it read; nothing is written and nothing reported changed. */
  read(operationId: string, call: PanelReadCall, memberPath?: PanelMemberPath): Promise<PanelReadOperationResult>;
  /** Freezes one write, of one call or a batch, for the host to confirm and dispatch. */
  prepare(operationId: string, invocation: PanelWriteInvocation, memberPath?: PanelMemberPath): Promise<PanelHumanOperationPreparation>;
}

/** What the host does with a prepared write: confirms it where it must and dispatches it once, or the reader cancels. */
export type ConfirmPanelOperation = (preparation: PanelHumanOperationPreparation) => Promise<AppBridgeConfirmPanelOperationResult>;

/** The coordinator's answer, or its refusal or failure with its own message. */
async function sent(response: Promise<Response>): Promise<Response> {
  try {
    return await response;
  } catch (error) {
    const payload = (error as { payload?: { error?: string | { message?: string }; message?: string } }).payload;
    const message = typeof payload?.error === "string" ? payload.error : payload?.error?.message ?? payload?.message;
    if (message) throw new Error(message, { cause: error });
    throw error;
  }
}

/** The coordinator's JSON answer. */
async function answer(response: Promise<Response>): Promise<unknown> {
  return (await sent(response)).json();
}

/**
 * The operations of the application use this panel runs as. A candidate preview runs as no use: it shows the panel but
 * runs none of its operations.
 */
export function panelHumanOperations(use: PanelUseRef | null, requests: PlatformRequests): PanelHumanOperations {
  // A nested publisher's operation is found through its path in the opened panel, the selections that placed it included.
  const of = (operationId: string, memberPath?: PanelMemberPath) => {
    if (!use) throw new Error("A panel preview runs no operations; they run in the panel's application");
    return { applicationId: use.applicationId, useId: use.useId, operationId, ...(memberPath ? { memberPath } : {}) };
  };
  const post = (path: string, body: unknown) =>
    answer(requests.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, ""));
  return {
    async describe(operationId, memberPath) {
      const { memberPath: path, ...ref } = of(operationId, memberPath);
      const query = new URLSearchParams({ ...ref, ...(path ? { memberPath: JSON.stringify(path) } : {}) });
      return panelOperationDescriptorResponseSchema.parse(await answer(requests.request(`/panel-operations/descriptor?${query}`, {}, "")));
    },
    async read(operationId, { target, input }, memberPath) {
      // A read acts on the chosen object or the draft, or on nothing, which the call then leaves out.
      const call = { ...(target ? { target } : {}), input };
      const response = await sent(requests.request("/panel-operations/read", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...of(operationId, memberPath), call }),
      }, ""));
      // An owner's file comes as its bytes, an attachment of one of the allowed types: the reader saves it.
      const disposition = response.headers.get("Content-Disposition");
      if (disposition && /^\s*attachment\b/i.test(disposition)) {
        const mime = (response.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
        return savePanelFile({ bytes: await response.blob(), mime: mime as PanelDownloadMime, suggestedName: attachmentName(disposition) });
      }
      return readPanelOperationResponseSchema.parse(await response.json());
    },
    async prepare(operationId, invocation, memberPath) {
      return panelHumanOperationPreparationSchema.parse(await post("/panel-operations/intents", { ...of(operationId, memberPath), ...invocation }));
    },
  };
}
