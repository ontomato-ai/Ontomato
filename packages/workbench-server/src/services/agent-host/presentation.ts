import { randomUUID } from "node:crypto";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import type { AgentHostObjectChangedFrame, AgentHostSessionLiveFrame } from "@ontomato/contracts/agent-host";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationAffected } from "@ontomato/contracts/panel-operations";
import { isDirectUserRun } from "@ontomato/contracts/agent-visibility";
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
  connection: Connection;
  sessionId: string;
  finish(result: PresentationResult): void;
}

interface Connection {
  id: string;
  host: AgentPresentationHost;
  owner: AgentHostOwner;
  send(frame: AgentHostSessionLiveFrame): void;
  signal: AbortSignal;
}

const views = new Map<string, Connection>();
const pendingCalls = new Map<string, Pending>();
const viewKey = (host: AgentPresentationHost, owner: AgentHostOwner, viewId: string) =>
  JSON.stringify([host, owner.domainId, owner.userId, viewId]);
const hostPaths: Record<AgentPresentationHost, string> = {
  workbench: "/api/assistant",
  observe: "/api/observe/agent",
};

export const PRESENTATION_CALL_PATH = "/sessions/:sessionId/runs/:runId/presentation-call/:viewId";

export function openPresentationView(
  host: AgentPresentationHost, owner: AgentHostOwner, viewId: string,
  send: Connection["send"], signal: AbortSignal,
): string {
  signal.throwIfAborted();
  const key = viewKey(host, owner, viewId);
  const connection = { id: randomUUID(), host, owner, send, signal };
  views.set(key, connection);
  signal.addEventListener("abort", () => {
    if (views.get(key) === connection) views.delete(key);
  }, { once: true });
  return connection.id;
}

export function publishObjectChanged(input: {
  domainId: string;
  initiator: string;
  rootSession: AgentHostObjectChangedFrame["session"];
} & (
  | { target: PanelObjectIdentity; affected?: PanelOperationAffected }
  | { target: null; affected: PanelOperationAffected }
)): void {
  const { domainId, initiator, rootSession, ...change } = input;
  const frame: AgentHostObjectChangedFrame = { type: "object-changed", session: rootSession, ...change };
  for (const { host, owner, send } of views.values()) {
    if (host === rootSession.providerId && owner.domainId === domainId && owner.userId === initiator)
      send(frame);
  }
}

export function visibilityReader(body: AgentPrepareRequest): AgentVisibilityReader | undefined {
  if (body.requestedBy) return "delegated";
  if (isDirectUserRun(body, body.sessionId)) return "user";
}

export function presentationCallback(
  host: AgentPresentationHost, body: AgentPrepareRequest, owner: AgentHostOwner,
  credentials: AssistantCredentials, expiresAt: number,
): RuntimePresentationCallback | undefined {
  const viewId = body.presentationBinding?.viewId;
  if (!viewId || body.mode !== "run" || body.input.role !== "user" || visibilityReader(body) !== "user" ||
      body.root.runId !== body.runId || body.root.session.sessionId !== body.sessionId ||
      body.root.session.providerId !== host || body.userRecipient?.actor.id !== body.actor.id ||
      body.userRecipient.actor.domainId !== owner.domainId || !views.has(viewKey(host, owner, viewId))) return;
  const path = `${hostPaths[host]}/sessions/${body.sessionId}/runs/${body.runId}/presentation-call/${viewId}`;
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

const callKey = (connectionId: string, runId: string, toolCallId: string) =>
  JSON.stringify([connectionId, runId, toolCallId]);

export async function requestPresentation(
  service: AgentHostService, host: AgentPresentationHost, owner: AgentHostOwner,
  call: PresentationBinding & Pick<PresentationFrame, "sessionId" | "runId" | "toolCallId"> & { input: PresentRequest },
  signal: AbortSignal,
): Promise<PresentationResult> {
  const { viewId, sessionId, runId, toolCallId, input } = call;
  const route = viewKey(host, owner, viewId);
  const connection = views.get(route);
  if (!connection) return notOpened("view_unavailable");

  const gone = AbortSignal.any([connection.signal, signal]);
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
  if (gone.aborted || views.get(route) !== connection) return notOpened("view_unavailable");

  const key = callKey(connection.id, runId, toolCallId);
  const deadline = AbortSignal.any([gone, AbortSignal.timeout(30_000)]);
  return new Promise(resolve => {
    const finish = (result: PresentationResult) => {
      pendingCalls.delete(key);
      deadline.removeEventListener("abort", abandon);
      resolve(result);
    };
    const abandon = () => finish(receiptMissing);
    pendingCalls.set(key, { connection, sessionId, finish });
    deadline.addEventListener("abort", abandon, { once: true });
    connection.send({ type: "presentation", sessionId, runId, toolCallId, target });
  });
}

export function receivePresentation(
  host: AgentPresentationHost, owner: AgentHostOwner, sessionId: string, runId: string,
  receipt: PresentationReceipt,
): void {
  const pending = pendingCalls.get(callKey(receipt.connectionId, runId, receipt.toolCallId));
  if (!pending || pending.sessionId !== sessionId || pending.connection.host !== host ||
    pending.connection.owner.domainId !== owner.domainId || pending.connection.owner.userId !== owner.userId)
    throw new HttpError(404, "No waiting presentation for this connection and run", "NOT_FOUND");
  pending.finish(receipt.result);
}
