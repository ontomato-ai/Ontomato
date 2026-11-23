import { randomUUID } from "node:crypto";
import type { AgentPrepareRequest, AgentRunContext } from "@ontomato/contracts/agent-channel";
import type { AgentHostSessionLiveFrame } from "@ontomato/contracts/agent-host";
import { isDirectUserRun } from "@ontomato/contracts/agent-visibility";
import type {
  FillFormRequest, ObserveDisplayRequest, PageActionRequest, PresentationBinding, PresentationFrame, PresentationReceipt, PresentationResult,
  PresentRequest, RuntimePresentationCallback,
} from "@ontomato/contracts/agent-presentation";
import { environment } from "../../config/environment";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { callbackCredential } from "../agent-runtime/callback-credential";
import { panelOperationStore } from "../product-panels/operation-store";
import type { SinglePanelOperationOutcome } from "../product-panels/server-operations";
import type { AgentHostOwner, AgentHostService, AgentPresentationHost } from "./types";
import type { AgentVisibilityReader } from "./visibility";

interface Pending {
  connection: Connection;
  sessionId: string;
  runId: string;
  finish(result: PresentationResult): void;
}

interface Connection {
  id: string;
  host: AgentPresentationHost;
  owner: AgentHostOwner;
  send(frame: AgentHostSessionLiveFrame): void;
  signal: AbortSignal;
}

interface AuthorizedRunView {
  viewId: string;
  expiresAt: number;
}

const views = new Map<string, Connection>();
const pendingCalls = new Map<string, Pending>();
const runViews = new Map<string, AuthorizedRunView>();
const viewKey = (host: AgentPresentationHost, owner: AgentHostOwner, viewId: string) =>
  JSON.stringify([host, owner.domainId, owner.userId, viewId]);
const runViewKey = (host: AgentPresentationHost, owner: AgentHostOwner, runId: string) =>
  JSON.stringify([host, owner.domainId, owner.userId, runId]);
const hostPaths: Record<AgentPresentationHost, string> = {
  workbench: "/api/assistant",
  observe: "/api/observe/agent",
};

export interface LivePresentationRunEligibility {
  readonly host: AgentPresentationHost;
  readonly owner: AgentHostOwner;
  readonly runId: string;
  readonly sessionId: string;
  readonly channel: Pick<
    AgentRunContext,
    "agent" | "actor" | "authority" | "requestedBy" | "root" | "userRecipient"
  >;
}

/**
 * Shared run-level eligibility rule for live page presentation and browser-side agent confirmation:
 * direct user root run on the matching host, same initiator/recipient actor and domain, and live authority.
 */
export function isLivePresentationEligibleRun(input: LivePresentationRunEligibility): boolean {
  const { host, owner, runId, sessionId, channel } = input;
  if (channel.requestedBy) return false;
  if (!isDirectUserRun(channel, sessionId)) return false;
  if (channel.root.runId !== runId || channel.root.session.sessionId !== sessionId) return false;
  if (channel.root.session.providerId !== host || channel.agent.providerId !== host) return false;
  if (channel.authority.executionKind !== "live") return false;
  if (!channel.userRecipient) return false;
  if (channel.userRecipient.actor.id !== channel.actor.id) return false;
  if (channel.userRecipient.actor.domainId !== owner.domainId || channel.actor.domainId !== owner.domainId) {
    return false;
  }
  return true;
}

/** Returns true when `runId` is bound to a currently connected live presentation view for `owner`. */
export function hasActivePresentationForRun(
  host: AgentPresentationHost,
  owner: AgentHostOwner,
  runId: string,
): boolean {
  const key = runViewKey(host, owner, runId);
  const authorized = runViews.get(key);
  if (authorized) {
    if (authorized.expiresAt <= Date.now()) {
      runViews.delete(key);
    } else if (views.has(viewKey(host, owner, authorized.viewId))) {
      return true;
    }
  }
  for (const pending of pendingCalls.values()) {
    if (
      pending.runId === runId
      && pending.connection.host === host
      && pending.connection.owner.domainId === owner.domainId
      && pending.connection.owner.userId === owner.userId
      && !pending.connection.signal.aborted
    ) {
      return true;
    }
  }
  return false;
}

/** Releases the run-to-view binding once a run settles or cancels. */
export function releasePresentationRun(
  host: AgentPresentationHost,
  owner: AgentHostOwner,
  runId: string,
): void {
  runViews.delete(runViewKey(host, owner, runId));
}

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

export function visibilityReader(body: AgentPrepareRequest): AgentVisibilityReader | undefined {
  if (body.requestedBy) return "delegated";
  if (isDirectUserRun(body, body.sessionId)) return "user";
}

export function presentationCallback(
  host: AgentPresentationHost, body: AgentPrepareRequest, owner: AgentHostOwner,
  credentials: AssistantCredentials, expiresAt: number,
): RuntimePresentationCallback | undefined {
  const viewId = body.presentationBinding?.viewId;
  if (!viewId || body.mode !== "run" || body.input.role !== "user" ||
      !isLivePresentationEligibleRun({ host, owner, runId: body.runId, sessionId: body.sessionId, channel: body }) ||
      !views.has(viewKey(host, owner, viewId))) return;
  runViews.set(runViewKey(host, owner, body.runId), { viewId, expiresAt });
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

function notFilled(
  reason: "view_unavailable" | "forbidden" | "not_found", error?: { code: string; message: string },
): PresentationResult {
  return { status: "not_filled", reason, current: { known: false, reason }, ...(error ? { error } : {}) };
}

function notExecuted(
  reason: "view_unavailable" | "forbidden" | "not_found", error?: { code: string; message: string },
): PresentationResult {
  return { status: "not_executed", reason, current: { known: false, reason }, ...(error ? { error } : {}) };
}

const receiptMissing: Extract<PresentationResult, { status: "unknown" }> = {
  status: "unknown", reason: "receipt_missing", current: { known: false, reason: "receipt_missing" },
};

function hasRecordedPanelWrites(outcome: SinglePanelOperationOutcome): boolean {
  if (outcome.kind === "success") return true;
  if (outcome.kind === "unknown") return false;
  return Object.keys(outcome.savedFields ?? {}).length > 0
    || Boolean(outcome.affected?.objects.length || outcome.affected?.removed?.length || outcome.affected?.objectTypes.length);
}

const callKey = (connectionId: string, runId: string, toolCallId: string) =>
  JSON.stringify([connectionId, runId, toolCallId]);

export async function requestPresentation(
  service: AgentHostService, host: AgentPresentationHost, owner: AgentHostOwner,
  call: PresentationBinding & Pick<PresentationFrame, "sessionId" | "runId" | "toolCallId"> & { input: PresentRequest | ObserveDisplayRequest | FillFormRequest | PageActionRequest },
  signal: AbortSignal,
): Promise<PresentationResult> {
  const { viewId, sessionId, runId, toolCallId, input } = call;
  const route = viewKey(host, owner, viewId);
  const connection = views.get(route);
  const isObserve = "mode" in input && input.mode === "observe";
  const isFillForm = "mode" in input && input.mode === "fill_form";
  const isPageAction = "mode" in input && input.mode === "page_action";
  const unavailable = (): PresentationResult =>
    isObserve
      ? { status: "observed", reason: "view_unavailable", current: { known: false, reason: "view_unavailable" } }
      : isFillForm
        ? notFilled("view_unavailable")
        : isPageAction
          ? notExecuted("view_unavailable")
          : notOpened("view_unavailable");
  if (!connection) return unavailable();

  const gone = AbortSignal.any([connection.signal, signal]);
  let target: PresentationFrame["target"];
  try {
    if ("mode" in input && input.mode === "observe") {
      await service.ownRun(sessionId, runId, owner);
      target = { kind: "observe" };
    } else if ("mode" in input && input.mode === "fill_form") {
      await service.ownRun(sessionId, runId, owner);
      target = {
        kind: "fill_form",
        ...(input.member === undefined ? {} : { member: input.member }),
        ...(input.memberPath === undefined ? {} : { memberPath: input.memberPath }),
        values: input.values,
        ...(input.overwriteUnsaved ? { overwriteUnsaved: true } : {}),
        ...(input.expectedPageInstanceId === undefined ? {} : { expectedPageInstanceId: input.expectedPageInstanceId }),
        ...(input.expectedMemberInstanceId === undefined ? {} : { expectedMemberInstanceId: input.expectedMemberInstanceId }),
        ...(input.expectedTarget === undefined ? {} : { expectedTarget: input.expectedTarget }),
      };
    } else if ("mode" in input && input.mode === "page_action") {
      await service.ownRun(sessionId, runId, owner);
      target = {
        kind: "page_action",
        operation: input.operation,
        ...(input.memberPath === undefined ? {} : { memberPath: input.memberPath }),
        ...(input.rowKey === undefined ? {} : { rowKey: input.rowKey }),
        ...(input.input === undefined ? {} : { input: input.input }),
        ...(input.expectedPageInstanceId === undefined ? {} : { expectedPageInstanceId: input.expectedPageInstanceId }),
        ...(input.expectedMemberInstanceId === undefined ? {} : { expectedMemberInstanceId: input.expectedMemberInstanceId }),
        ...(input.expectedTarget === undefined ? {} : { expectedTarget: input.expectedTarget }),
        ...(input.expectedCheckedKeys === undefined ? {} : { expectedCheckedKeys: input.expectedCheckedKeys }),
      };
    } else if (input.target.startsWith("outputs/")) {
      const { artifact } = await service.resolve(sessionId, runId, input.target, owner);
      if (!artifact) return notOpened("not_found");
      target = { kind: "artifact", artifact };
    } else {
      await service.ownRun(sessionId, runId, owner);
      target = {
        kind: "page",
        address: input.target,
        ...(input.state === undefined ? {} : { state: input.state }),
      };
    }
  } catch (error) {
    if (!(error instanceof HttpError) || (error.status !== 403 && error.status !== 404)) throw error;
    const reason = error.status === 403 ? "forbidden" : "not_found";
    const err = { code: error.code ?? reason.toUpperCase(), message: error.message };
    return isFillForm ? notFilled(reason, err) : isPageAction ? notExecuted(reason, err) : notOpened(reason, err);
  }
  if (gone.aborted || views.get(route) !== connection) return unavailable();

  const key = callKey(connection.id, runId, toolCallId);
  const deadline = AbortSignal.any([gone, AbortSignal.timeout(30_000)]);
  return new Promise(resolve => {
    const finish = (result: PresentationResult) => {
      pendingCalls.delete(key);
      deadline.removeEventListener("abort", abandon);
      resolve(result);
    };
    const abandon = () => {
      if (!isPageAction) {
        finish(receiptMissing);
        return;
      }
      // Recover the authoritative server intent status when a page_action receipt is lost so the agent never retries.
      void panelOperationStore.findByAgentToolCall(owner, runId, toolCallId).then((stored) => {
        if (stored?.kind === "current") {
          const { intent } = stored;
          if (intent.source.kind === "agent-page") {
            if (intent.dispatched) {
              const { outcome } = intent;
              if (outcome === null) {
                finish({
                  status: "unknown",
                  reason: "receipt_missing",
                  intentId: intent.intentId,
                  current: { known: false, reason: "receipt_missing" },
                  error: {
                    code: "ACTION_OUTCOME_UNKNOWN",
                    message: `Operation was dispatched, but its outcome is not yet recorded. Check /api/panel-operation-intents/${intent.intentId} without retrying.`,
                  },
                });
                return;
              }
              if (outcome.kind === "unknown") {
                finish({
                  status: "unknown",
                  reason: "receipt_missing",
                  intentId: intent.intentId,
                  current: { known: false, reason: "receipt_missing" },
                  error: { code: "ACTION_OUTCOME_UNKNOWN", message: outcome.message },
                });
                return;
              }
              if ((outcome.kind === "refusal" || outcome.kind === "failure") && !hasRecordedPanelWrites(outcome)) {
                finish({
                  status: "not_executed",
                  reason: "failed",
                  operation: intent.operation.id,
                  intentId: intent.intentId,
                  current: { known: false, reason: "receipt_missing" },
                  error: { code: outcome.code, message: outcome.message },
                });
                return;
              }
              if (outcome.kind === "batch") {
                if (outcome.items.some(item => item.outcome.kind === "unknown")) {
                  finish({
                    status: "unknown",
                    reason: "receipt_missing",
                    intentId: intent.intentId,
                    current: { known: false, reason: "receipt_missing" },
                    error: {
                      code: "ACTION_OUTCOME_UNKNOWN",
                      message: `Batch operation was dispatched with an unknown item outcome. Check /api/panel-operation-intents/${intent.intentId} without retrying.`,
                    },
                  });
                  return;
                }
                const firstProblem = outcome.items.map(item => item.outcome).find(
                  item => item.kind === "refusal" || item.kind === "failure",
                );
                if (firstProblem && !outcome.items.some(item => hasRecordedPanelWrites(item.outcome))) {
                  finish({
                    status: "not_executed",
                    reason: "failed",
                    operation: intent.operation.id,
                    intentId: intent.intentId,
                    current: { known: false, reason: "receipt_missing" },
                    error: { code: firstProblem.code, message: firstProblem.message },
                  });
                  return;
                }
              }
              finish({
                status: "executed",
                reason: "action_completed",
                operation: intent.operation.id,
                intentId: intent.intentId,
                outcome,
                current: { known: false, reason: "receipt_missing" },
              });
              return;
            }
            if (intent.invalidated) {
              finish({
                status: "not_executed",
                reason: intent.invalidated.code === "FORM_CONFIRMATION_STALE" ? "stale" : "cancelled",
                operation: intent.operation.id,
                intentId: intent.intentId,
                current: { known: false, reason: "receipt_missing" },
                error: intent.invalidated,
              });
              return;
            }
            if (intent.source.questionId) {
              finish({
                status: "awaiting_confirmation",
                reason: "confirmation_required",
                operation: intent.operation.id,
                intentId: intent.intentId,
                questionId: intent.source.questionId,
                label: intent.operation.label,
                current: { known: false, reason: "receipt_missing" },
              });
              return;
            }
            finish({ ...receiptMissing, intentId: intent.intentId });
            return;
          }
        }
        finish(receiptMissing);
      }, () => finish(receiptMissing));
    };
    pendingCalls.set(key, { connection, sessionId, runId, finish });
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
