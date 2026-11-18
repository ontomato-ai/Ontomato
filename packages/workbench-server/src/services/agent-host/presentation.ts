import { randomUUID } from "node:crypto";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import type {
  PresentationBinding, PresentationFrame, PresentationReceipt, PresentationResult,
  PresentRequest, RuntimePresentationCallback,
} from "@ontomato/contracts/agent-presentation";
import { environment } from "../../config/environment";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { callbackCredential } from "../agent-runtime/callback-credential";
import type { AgentHostOwner, AgentHostService, AgentPresentationHost } from "./types";
import type { AgentVisibilityReader } from "./visibility";

interface Pending {
  sessionId: string;
  finish(result: PresentationResult): void;
}

interface View {
  host: AgentPresentationHost;
  owner: AgentHostOwner;
  send(frame: PresentationFrame): void;
  signal: AbortSignal;
  pending: Map<string, Pending>;
}

const views = new Map<string, View>();
const hostPaths: Record<AgentPresentationHost, string> = {
  workbench: "/api/assistant",
  observe: "/api/observe/agent",
};

export const PRESENTATION_CALL_PATH = "/sessions/:sessionId/runs/:runId/presentation-call/:connectionId";

export function openPresentationView(
  host: AgentPresentationHost, owner: AgentHostOwner, send: View["send"], signal: AbortSignal,
): PresentationBinding {
  signal.throwIfAborted();
  const connectionId = randomUUID();
  views.set(connectionId, { host, owner, send, signal, pending: new Map() });
  signal.addEventListener("abort", () => views.delete(connectionId), { once: true });
  return { connectionId };
}

function boundView(host: AgentPresentationHost, owner: AgentHostOwner, connectionId: string) {
  const view = views.get(connectionId);
  return view && view.host === host &&
    view.owner.userId === owner.userId && view.owner.domainId === owner.domainId ? view : undefined;
}

export function visibilityReader(body: AgentPrepareRequest): AgentVisibilityReader | undefined {
  if (body.requestedBy) return "delegated";
  if (body.userRecipient?.session.providerId === body.agent.providerId &&
      body.userRecipient.session.sessionId === body.sessionId) return "user";
}

export function presentationCallback(
  host: AgentPresentationHost, body: AgentPrepareRequest, owner: AgentHostOwner,
  credentials: AssistantCredentials, expiresAt: number,
): RuntimePresentationCallback | undefined {
  const connectionId = body.presentationBinding?.connectionId;
  if (!connectionId || visibilityReader(body) !== "user" ||
      body.root.runId !== body.runId || body.root.session.sessionId !== body.sessionId ||
      body.root.session.providerId !== host || body.userRecipient?.actor.id !== body.actor.id ||
      body.userRecipient.actor.domainId !== owner.domainId || !boundView(host, owner, connectionId)) return;
  const path = `${hostPaths[host]}/sessions/${body.sessionId}/runs/${body.runId}/presentation-call/${connectionId}`;
  return {
    url: environment.agentRuntime().callbackUrl.replace(/\/$/, "") + path,
    credential: callbackCredential({
      pathPrefix: path, runId: body.runId, expiresAt, token: credentials.token ?? "", apiKey: credentials.apiKey ?? "",
    }).value,
  };
}

function notOpened(
  reason: "view_unavailable" | "forbidden" | "not_found", error?: { code: string; message: string },
): PresentationResult {
  return { status: "not_opened", reason, current: { known: false, reason }, ...(error ? { error } : {}) };
}

const receiptMissing: PresentationResult = {
  status: "unknown", reason: "receipt_missing", current: { known: false, reason: "receipt_missing" },
};

const callKey = (runId: string, toolCallId: string) => JSON.stringify([runId, toolCallId]);

export async function requestPresentation(
  service: AgentHostService, host: AgentPresentationHost, owner: AgentHostOwner,
  call: PresentationBinding & Pick<PresentationFrame, "sessionId" | "runId" | "toolCallId"> & { input: PresentRequest },
  signal: AbortSignal,
): Promise<PresentationResult> {
  const { connectionId, sessionId, runId, toolCallId, input } = call;
  const view = boundView(host, owner, connectionId);
  if (!view) return notOpened("view_unavailable");

  const gone = AbortSignal.any([view.signal, signal]);
  let target: PresentationFrame["target"];
  try {
    if (input.target.startsWith("outputs/")) {
      const { artifact } = await service.resolve(sessionId, runId, input.target, owner);
      if (!artifact) return notOpened("not_found");
      target = { kind: "artifact", artifact };
    } else {
      await service.ownRun(sessionId, runId, owner);
      target = { kind: "page", address: input.target, ...(input.state === undefined ? {} : { state: input.state }) };
    }
  } catch (error) {
    if (!(error instanceof HttpError) || (error.status !== 403 && error.status !== 404)) throw error;
    const reason = error.status === 403 ? "forbidden" : "not_found";
    return notOpened(reason, { code: error.code ?? reason.toUpperCase(), message: error.message });
  }
  if (gone.aborted) return notOpened("view_unavailable");

  const key = callKey(runId, toolCallId);
  const deadline = AbortSignal.any([gone, AbortSignal.timeout(30_000)]);
  return new Promise(resolve => {
    const finish = (result: PresentationResult) => {
      view.pending.delete(key);
      deadline.removeEventListener("abort", abandon);
      resolve(result);
    };
    const abandon = () => finish(receiptMissing);
    view.pending.set(key, { sessionId, finish });
    deadline.addEventListener("abort", abandon, { once: true });
    view.send({ type: "presentation", sessionId, runId, toolCallId, target });
  });
}

export function receivePresentation(
  host: AgentPresentationHost, owner: AgentHostOwner, sessionId: string, runId: string,
  receipt: PresentationReceipt,
): void {
  const pending = boundView(host, owner, receipt.connectionId)?.pending.get(callKey(runId, receipt.toolCallId));
  if (!pending || pending.sessionId !== sessionId)
    throw new HttpError(404, "No waiting presentation for this connection and run", "NOT_FOUND");
  pending.finish(receipt.result);
}
