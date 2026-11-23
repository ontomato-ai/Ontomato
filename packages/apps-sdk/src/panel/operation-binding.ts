import type {
  ExpectedPageTarget,
  PageActionConfirmedDispatchResult,
  PendingPageActionConfirmation,
} from "@ontomato/contracts/agent-presentation";
import type { PanelFormTarget, PanelOperationCall } from "@ontomato/contracts/panel-manifest";

/**
 * Single universal verification mechanism for "is this still the exact submission prepared earlier?"
 * (product-layer standard detail 3.8).
 *
 * Every mounted remote-control entry — forms, list row actions, operation buttons, batch actions,
 * header overflow actions, nested panels, and dirty form discard — supplies a `SubmissionEvaluator`
 * that recomputes the live 4-tuple `(instanceId, operationId, target, payload)` together with
 * mounted/ready/valid checks. Both default confirmation and full-auto pre-dispatch verify through
 * this single function.
 */

export type SubmissionCheckPhase = "prepare" | "auto-dispatch" | "confirm";

export interface FrozenSubmission {
  /** Unique ID of the mounted panel instance (including nested panel member instance). */
  readonly instanceId: string;
  /** Named operation ID (e.g. "form.save", "detail.form.save", "list.delete", "form.discard"). */
  readonly operationId: string;
  /** Exact target bound to this submission (object identity, draft, batch targets, or null). */
  readonly target: unknown;
  /** Exact payload clicking this UI entry right now would submit. */
  readonly payload: unknown;
}

export type EvaluatedSubmission =
  | ({ readonly ok: true } & FrozenSubmission)
  | { readonly ok: false; readonly message: string };

export type SubmissionEvaluator = (phase: SubmissionCheckPhase) => EvaluatedSubmission;

export type SubmissionCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "stale"; readonly message: string };

/** Thrown when a prepared submission became stale before dispatch (including full-auto pre-dispatch check). */
export class PanelSubmissionStaleError extends Error {
  readonly intentId?: string;
  constructor(message: string, intentId?: string) {
    super(message);
    this.name = "PanelSubmissionStaleError";
    if (intentId !== undefined) this.intentId = intentId;
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = canonicalValue(entry);
    }
    return sorted;
  }
  return value;
}

/** Canonical deep equality for frozen vs. freshly recomputed submission targets and payloads. */
export function sameSubmissionValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b));
}

/**
 * Re-evaluates what clicking this UI entry right now would submit and compares the four binding
 * pillars (`instanceId`, `operationId`, `target`, `payload`) plus mounted/ready/valid state against
 * the snapshot frozen before preparation.
 */
export function verifySubmissionUnchanged(
  frozen: FrozenSubmission,
  evaluate: SubmissionEvaluator,
  phase: "auto-dispatch" | "confirm",
): SubmissionCheckResult {
  const current = evaluate(phase);
  if (!current.ok) {
    return { ok: false, reason: "stale", message: current.message };
  }
  if (current.instanceId !== frozen.instanceId) {
    return {
      ok: false,
      reason: "stale",
      message: "The page or nested panel instance changed before execution.",
    };
  }
  if (current.operationId !== frozen.operationId) {
    return {
      ok: false,
      reason: "stale",
      message: "The bound operation changed before execution.",
    };
  }
  if (!sameSubmissionValue(current.target, frozen.target)) {
    return {
      ok: false,
      reason: "stale",
      message: "The target object or batch selection changed before execution.",
    };
  }
  if (!sameSubmissionValue(current.payload, frozen.payload)) {
    return {
      ok: false,
      reason: "stale",
      message: "The pending submission content changed before execution.",
    };
  }
  return { ok: true };
}

/** Builds a conversation confirmation handle backed by the single universal staleness check. */
export function createDeferredConfirmation(input: {
  readonly intentId: string;
  readonly questionId: string;
  readonly operationId: string;
  readonly label: string;
  readonly staleCode?: string;
  readonly isStillValid: () => SubmissionCheckResult;
  readonly cancel: (reason: { readonly code: string; readonly message: string }) => Promise<void>;
  readonly dispatchVerified: () => Promise<PageActionConfirmedDispatchResult>;
}): PendingPageActionConfirmation {
  return {
    intentId: input.intentId,
    questionId: input.questionId,
    operationId: input.operationId,
    label: input.label,
    isStillValid: input.isStillValid,
    async dispatch(): Promise<PageActionConfirmedDispatchResult> {
      const check = input.isStillValid();
      if (!check.ok) {
        await input.cancel({ code: input.staleCode ?? "ACTION_CONFIRMATION_STALE", message: check.message }).catch(() => undefined);
        return { ok: false, intentId: input.intentId, reason: "stale", message: check.message };
      }
      return input.dispatchVerified();
    },
    cancel: input.cancel,
  };
}

/** Checks whether a live operation/form target matches the agent's observed `expectedTarget`. */
export function matchesExpectedTarget(
  actual: PanelOperationCall["target"] | PanelFormTarget | null | undefined,
  expected: ExpectedPageTarget,
): boolean {
  if (!actual) return false;
  if (expected.kind === "object") {
    return (
      actual.kind === "object"
      && actual.objectType === expected.objectType
      && actual.primaryKey === expected.primaryKey
    );
  }
  if (actual.kind !== "draft") return false;
  return "objectType" in actual ? actual.objectType === expected.objectType : true;
}

/**
 * Checks whether the current checked batch targets match the agent's observed `expectedCheckedKeys`.
 * Supports canonical composite keys (`<className>:<primaryKey>`) and unambiguous plain `primaryKey`s
 * (when no two checked targets share a `primaryKey` across different object types).
 */
export function matchesExpectedCheckedKeys(
  checkedTargets: readonly { readonly objectType: string; readonly primaryKey: string }[],
  expectedCheckedKeys: readonly string[],
): boolean {
  if (checkedTargets.length !== expectedCheckedKeys.length) return false;
  const remainingComposite = new Set(
    checkedTargets.map((target) => `${target.objectType}:${target.primaryKey}`),
  );
  const plainKeys = checkedTargets.map((target) => target.primaryKey);
  const plainUnique = new Set(plainKeys).size === plainKeys.length;
  const compositeByPlain = new Map<string, string>();
  if (plainUnique) {
    for (const target of checkedTargets) {
      compositeByPlain.set(target.primaryKey, `${target.objectType}:${target.primaryKey}`);
    }
  }
  for (const expectedKey of expectedCheckedKeys) {
    if (remainingComposite.delete(expectedKey)) continue;
    if (plainUnique) {
      const composite = compositeByPlain.get(expectedKey);
      if (composite && remainingComposite.delete(composite)) continue;
    }
    return false;
  }
  return remainingComposite.size === 0;
}
