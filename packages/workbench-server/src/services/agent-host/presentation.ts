import { randomUUID } from "node:crypto";
import type { AgentPrepareRequest, AgentRunContext } from "@ontomato/contracts/agent-channel";
import type { AgentHostObjectChangedFrame, AgentHostSessionLiveFrame } from "@ontomato/contracts/agent-host";
import { isDirectUserRun } from "@ontomato/contracts/agent-visibility";
import type {
  ExpectedPageTarget, FillFormRequest, ObservedPageTarget, ObserveDisplayRequest, PageActionRequest,
  PresentationBinding, PresentationFrame, PresentationReceipt, PresentationResult,
  PresentRequest, RuntimePresentationCallback,
} from "@ontomato/contracts/agent-presentation";
import { classifyPanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { environment } from "../../config/environment";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { callbackCredential, presentationHostPaths } from "../agent-runtime/callback-credential";
import { panelOperationStore } from "../product-panels/operation-store";
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
const lastPageSnapshots = new Map<string, ObservedPageTarget>();
const MAX_TRACKED_RUN_SNAPSHOTS = 1000;
const viewKey = (host: AgentPresentationHost, owner: AgentHostOwner, viewId: string) =>
  JSON.stringify([host, owner.domainId, owner.userId, viewId]);
const runViewKey = (host: AgentPresentationHost, owner: AgentHostOwner, runId: string) =>
  JSON.stringify([host, owner.domainId, owner.userId, runId]);
const runSnapshotKey = runViewKey;
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
 * direct user root run on the matching host, same initiator/recipient actor and domain, and live or preview authority.
 */
export function isLivePresentationEligibleRun(input: LivePresentationRunEligibility): boolean {
  const { host, owner, runId, sessionId, channel } = input;
  if (channel.requestedBy) return false;
  if (!isDirectUserRun(channel, sessionId)) return false;
  if (channel.root.runId !== runId || channel.root.session.sessionId !== sessionId) return false;
  if (channel.root.session.providerId !== host || channel.agent.providerId !== host) return false;
  if (channel.authority.executionKind !== "live" && channel.authority.executionKind !== "preview") return false;
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

/** Releases the run-to-view binding and cached page snapshot once a run settles or cancels. */
export function releasePresentationRun(
  host: AgentPresentationHost,
  owner: AgentHostOwner,
  runId: string,
): void {
  const key = runViewKey(host, owner, runId);
  runViews.delete(key);
  lastPageSnapshots.delete(key);
}

function storePageSnapshot(key: string, page: ObservedPageTarget): void {
  lastPageSnapshots.delete(key);
  lastPageSnapshots.set(key, page);
  while (lastPageSnapshots.size > MAX_TRACKED_RUN_SNAPSHOTS) {
    const oldest = lastPageSnapshots.keys().next().value;
    if (oldest === undefined) break;
    lastPageSnapshots.delete(oldest);
  }
}

function recordDeliveredSnapshot(key: string, result: PresentationResult): void {
  const current = result.current;
  if (!current.known) return;
  if (current.target?.kind === "page") {
    storePageSnapshot(key, current.target);
    return;
  }
  lastPageSnapshots.delete(key);
}

function formMemberPathKeys(
  memberPath: NonNullable<ObservedPageTarget["forms"]>[number]["memberPath"],
): string[] | undefined {
  return memberPath?.length ? memberPath.map((segment) => segment.member) : undefined;
}

function findMatchingForm(
  page: ObservedPageTarget,
  member: string | undefined,
  memberPath: readonly string[] | undefined,
) {
  const forms = page.forms ?? [];
  const pathKey = memberPath?.length ? memberPath.join(".") : undefined;
  const matches = forms.filter((form) => {
    const formPathKey = formMemberPathKeys(form.memberPath)?.join(".") ?? "";
    if (pathKey !== undefined && formPathKey !== pathKey) return false;
    if (member !== undefined && form.member !== member) return false;
    return true;
  });
  return matches.length === 1 ? matches[0]! : null;
}

function resolveMemberInstanceId(
  page: ObservedPageTarget,
  memberPath: readonly string[] | undefined,
  dottedCandidate?: string,
): string | undefined {
  const members = page.memberInstances;
  if (!members) return undefined;
  if (memberPath?.length) return members[memberPath.join(".")];
  if (!dottedCandidate) return undefined;
  const parts = dottedCandidate.split(".");
  for (let len = parts.length - 1; len >= 1; len -= 1) {
    const prefix = parts.slice(0, len).join(".");
    if (prefix in members) return members[prefix];
  }
  return undefined;
}

function buildFillFormBasis(page: ObservedPageTarget, input: FillFormRequest): {
  expectedPageInstanceId?: string;
  expectedPanelInstanceId?: string;
  expectedMemberInstanceId?: string;
  expectedFormInstanceId?: string;
  expectedTarget?: ExpectedPageTarget;
  expectedDashboardId?: string;
  expectedCardId?: string;
} {
  const matchedForm = findMatchingForm(page, input.member, input.memberPath);
  const expectedMemberInstanceId = resolveMemberInstanceId(
    page,
    input.memberPath ?? formMemberPathKeys(matchedForm?.memberPath),
  );
  const expectedFormInstanceId = matchedForm?.formInstanceId;
  const expectedTarget = matchedForm?.target;
  return {
    ...(page.pageInstanceId ? { expectedPageInstanceId: page.pageInstanceId } : {}),
    ...(page.panelInstanceId ? { expectedPanelInstanceId: page.panelInstanceId } : {}),
    ...(expectedMemberInstanceId ? { expectedMemberInstanceId } : {}),
    ...(expectedFormInstanceId ? { expectedFormInstanceId } : {}),
    ...(expectedTarget ? { expectedTarget } : {}),
    ...(page.dashboardId ? { expectedDashboardId: page.dashboardId } : {}),
    ...(page.cardId ? { expectedCardId: page.cardId } : {}),
  };
}

function buildPageActionBasis(page: ObservedPageTarget, input: PageActionRequest): {
  expectedPageInstanceId?: string;
  expectedPanelInstanceId?: string;
  expectedMemberInstanceId?: string;
  expectedEntryInstanceId?: string;
  expectedTarget?: ExpectedPageTarget;
  expectedCheckedKeys?: string[];
  expectedDashboardId?: string;
  expectedCardId?: string;
} {
  const prefix = input.memberPath?.length ? `${input.memberPath.join(".")}.` : "";
  const fullOp = prefix && !input.operation.startsWith(prefix)
    ? `${prefix}${input.operation}`
    : input.operation;
  const expectedMemberInstanceId = resolveMemberInstanceId(page, input.memberPath, fullOp);

  let expectedEntryInstanceId: string | undefined;
  let expectedTarget: ExpectedPageTarget | undefined;
  let isFormAction = false;

  if (input.rowKey !== undefined) {
    expectedEntryInstanceId = page.entryInstances?.[`row:${fullOp}`] ?? page.entryInstances?.[fullOp];
  } else {
    expectedEntryInstanceId = page.entryInstances?.[fullOp];
    const formSuffixMatch = /^(?:(.+)\.)?(save|discard)$/.exec(input.operation);
    if (formSuffixMatch) {
      const formMember = formSuffixMatch[1] === "form" ? undefined : formSuffixMatch[1];
      const matchedForm = findMatchingForm(page, formMember, input.memberPath);
      if (matchedForm) {
        isFormAction = true;
        expectedTarget = matchedForm.target;
        if (!expectedEntryInstanceId) {
          const formPath = formMemberPathKeys(matchedForm.memberPath);
          const formPrefix = formPath?.length ? `${formPath.join(".")}.` : "";
          const actionKey = `${formPrefix}${matchedForm.member}.${formSuffixMatch[2]}`;
          expectedEntryInstanceId = page.entryInstances?.[actionKey] ?? matchedForm.formInstanceId;
        }
      }
    }
  }

  let expectedCheckedKeys: string[] | undefined;
  if (input.rowKey === undefined && !isFormAction && page.checkedKeys) {
    const keys = Object.keys(page.checkedKeys);
    if (keys.length === 1) {
      expectedCheckedKeys = [...page.checkedKeys[keys[0]!]!];
    }
  }

  return {
    ...(page.pageInstanceId ? { expectedPageInstanceId: page.pageInstanceId } : {}),
    ...(page.panelInstanceId ? { expectedPanelInstanceId: page.panelInstanceId } : {}),
    ...(expectedMemberInstanceId ? { expectedMemberInstanceId } : {}),
    ...(expectedEntryInstanceId ? { expectedEntryInstanceId } : {}),
    ...(expectedTarget ? { expectedTarget } : {}),
    ...(expectedCheckedKeys ? { expectedCheckedKeys } : {}),
    ...(page.dashboardId ? { expectedDashboardId: page.dashboardId } : {}),
    ...(page.cardId ? { expectedCardId: page.cardId } : {}),
  };
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

export function publishObjectChanged(initiator: AgentHostOwner, frame: AgentHostObjectChangedFrame): void {
  for (const { host, owner, send } of views.values()) {
    if (host === frame.session.providerId && owner.domainId === initiator.domainId && owner.userId === initiator.userId) {
      send(frame);
    }
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
  const binding = body.presentationBinding;
  if (!binding || body.mode !== "run" || body.input.role !== "user" ||
      !isLivePresentationEligibleRun({ host, owner, runId: body.runId, sessionId: body.sessionId, channel: body }) ||
      !views.has(viewKey(host, owner, binding.viewId))) return;
  const { viewId, initialPage } = binding;
  runViews.set(runViewKey(host, owner, body.runId), { viewId, expiresAt });
  const snapshotKey = runSnapshotKey(host, owner, body.runId);
  if (initialPage) storePageSnapshot(snapshotKey, initialPage);
  else lastPageSnapshots.delete(snapshotKey);
  const path = `${presentationHostPaths[host]}/sessions/${body.sessionId}/runs/${body.runId}/presentation-call/${viewId}`;
  return {
    url: environment.agentRuntime().callbackUrl.replace(/\/$/, "") + path,
    credential: callbackCredential({
      scope: { purpose: "presentation", host, sessionId: body.sessionId, viewId }, runId: body.runId, expiresAt, token: credentials.token ?? "", apiKey: credentials.apiKey ?? "",
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

const callKey = (connectionId: string, runId: string, toolCallId: string) =>
  JSON.stringify([connectionId, runId, toolCallId]);

export async function requestPresentation(
  service: Pick<AgentHostService, "ownRun" | "resolve">, host: AgentPresentationHost, owner: AgentHostOwner,
  call: PresentationBinding & Pick<PresentationFrame, "sessionId" | "runId" | "toolCallId"> & { input: PresentRequest | ObserveDisplayRequest | FillFormRequest | PageActionRequest },
  signal: AbortSignal,
): Promise<PresentationResult> {
  const { viewId, sessionId, runId, toolCallId, input } = call;
  const route = viewKey(host, owner, viewId);
  const snapshotKey = runSnapshotKey(host, owner, runId);
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
      const lastSnapshot = lastPageSnapshots.get(snapshotKey);
      if (!lastSnapshot) {
        return {
          status: "not_filled",
          reason: "stale",
          ...(input.member === undefined ? {} : { member: input.member }),
          ...(input.memberPath === undefined ? {} : { memberPath: input.memberPath }),
          current: { known: false, reason: "no_prior_observation" },
          error: {
            code: "STALE",
            message: "No page snapshot has been observed in this run yet. Call observe_display or present first so the platform can bind this edit to the displayed page.",
          },
        };
      }
      target = {
        kind: "fill_form",
        ...(input.member === undefined ? {} : { member: input.member }),
        ...(input.memberPath === undefined ? {} : { memberPath: input.memberPath }),
        values: input.values,
        ...(input.overwriteUnsaved ? { overwriteUnsaved: true } : {}),
        ...buildFillFormBasis(lastSnapshot, input),
      };
    } else if ("mode" in input && input.mode === "page_action") {
      await service.ownRun(sessionId, runId, owner);
      const lastSnapshot = lastPageSnapshots.get(snapshotKey);
      if (!lastSnapshot) {
        return {
          status: "not_executed",
          reason: "stale",
          operation: input.operation,
          current: { known: false, reason: "no_prior_observation" },
          error: {
            code: "STALE",
            message: "No page snapshot has been observed in this run yet. Call observe_display or present first so the platform can bind this action to the displayed page.",
          },
        };
      }
      target = {
        kind: "page_action",
        operation: input.operation,
        ...(input.memberPath === undefined ? {} : { memberPath: input.memberPath }),
        ...(input.rowKey === undefined ? {} : { rowKey: input.rowKey }),
        ...(input.input === undefined ? {} : { input: input.input }),
        ...buildPageActionBasis(lastSnapshot, input),
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
      recordDeliveredSnapshot(snapshotKey, result);
      resolve(result);
    };
    const abandon = () => {
      if (!isPageAction && !isFillForm) {
        finish(receiptMissing);
        return;
      }
      // Recover the authoritative server intent status when a page write receipt is lost so the agent never retries.
      void panelOperationStore.findByAgentToolCall(owner, runId, toolCallId).then((stored) => {
        if (stored?.kind === "current") {
          const { intent } = stored;
          if (intent.source.kind === "agent-page") {
            if (intent.dispatched) {
              const classified = classifyPanelOperationOutcome(intent.outcome, intent.intentId);
              if (classified.kind === "unknown") {
                finish({
                  status: "unknown",
                  reason: "receipt_missing",
                  intentId: intent.intentId,
                  current: { known: false, reason: "receipt_missing" },
                  error: { code: classified.code, message: classified.message },
                });
                return;
              }
              if (classified.kind === "failed") {
                finish({
                  status: "not_executed",
                  reason: "failed",
                  operation: intent.operation.id,
                  intentId: intent.intentId,
                  current: { known: false, reason: "receipt_missing" },
                  error: { code: classified.code, message: classified.message },
                });
                return;
              }
              if (classified.kind === "partial") {
                finish({
                  status: "partially_executed",
                  reason: "partial_completion",
                  operation: intent.operation.id,
                  intentId: intent.intentId,
                  ...(classified.savedFields?.length ? { savedFields: [...classified.savedFields] } : {}),
                  outcome: classified.outcome,
                  current: { known: false, reason: "receipt_missing" },
                  error: { code: classified.code, message: classified.message },
                });
                return;
              }
              finish({
                status: "executed",
                reason: "action_completed",
                operation: intent.operation.id,
                intentId: intent.intentId,
                outcome: classified.outcome,
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
