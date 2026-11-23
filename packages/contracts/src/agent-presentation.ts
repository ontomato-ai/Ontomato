import { z } from "zod";
import { runtimeArtifactSchema } from "./agent-runtime-artifacts";
import {
  runtimeIdSchema,
  runtimeHttpUrlSchema,
  runtimeJsonObjectSchema,
  runtimeKeySchema,
  runtimeRelativePathSchema,
  runtimeTimestampSchema,
  type RuntimeJsonValue,
} from "./agent-runtime-values";
import { pageContextSchema } from "./page-context";

const outputPathSchema = runtimeRelativePathSchema.refine(
  (path) => path.startsWith("outputs/"),
  "Expected a workspace path inside outputs/",
);
const pageAddressSchema = z.string().regex(/^\/(?!\/)[^\\\s\p{Cc}]*$/u, "Expected a site-relative page address");

function hasStateQuery(address: string): boolean {
  const search = /^[^?#]*\?([^#]*)/.exec(address)?.[1];
  return new URLSearchParams(search).has("state");
}

/** Route registration, access and declared page state belong to the page resolver. */
export const presentRequestSchema = z.object({
  target: z.union([outputPathSchema, pageAddressSchema]),
  state: runtimeJsonObjectSchema.optional(),
}).strict().refine(
  ({ target, state }) => state === undefined ||
    (target.startsWith("/") && !hasStateQuery(target)),
  { path: ["state"], message: "State requires a page address that provides no state query" },
);
export type PresentRequest = z.infer<typeof presentRequestSchema>;

/** Read-only mid-round observation request for the user's current conversation display. */
export const observeDisplayRequestSchema = z.object({
  mode: z.literal("observe"),
}).strict();
export type ObserveDisplayRequest = z.infer<typeof observeDisplayRequestSchema>;

/** Target object or create-draft identity an agent observed and expects a live form or page action to bind to. */
export const expectedPageTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("object"),
    objectType: runtimeKeySchema,
    primaryKey: runtimeKeySchema,
  }).strict(),
  z.object({
    kind: z.literal("draft"),
    objectType: runtimeKeySchema,
  }).strict(),
]);
export type ExpectedPageTarget = z.infer<typeof expectedPageTargetSchema>;

/** Fill explicit fields in a live form currently displayed beside the conversation. */
export const fillFormRequestSchema = z.object({
  mode: z.literal("fill_form"),
  /** Form member key matching pageContext.forms[].member; optional when exactly one form is open. */
  member: runtimeKeySchema.optional(),
  /** Optional nested panel member path keys matching pageContext.forms[].memberPath[].member. */
  memberPath: z.array(runtimeKeySchema).min(1).optional(),
  /** Field values keyed by JSON Pointer path (e.g. "/name") or top-level field name ("name"). */
  values: runtimeJsonObjectSchema.refine(
    (values) => Object.keys(values).length > 0,
    { message: "values must include at least one field" },
  ),
  /** Explicitly allow modifying a form that already has unsaved edits after the user confirms. */
  overwriteUnsaved: z.boolean().optional(),
  /** Expected mounted page instance ID observed from `observe_display`/`present`; rejects as `stale` on mismatch. */
  expectedPageInstanceId: runtimeKeySchema.optional(),
  /** Expected mounted nested panel member instance ID observed from `memberInstances`; rejects as `stale` on mismatch. */
  expectedMemberInstanceId: runtimeKeySchema.optional(),
  /** Expected form target (object or create-draft) observed on screen; rejects as `stale` if the form switched target. */
  expectedTarget: expectedPageTargetSchema.optional(),
}).strict();
export type FillFormRequest = z.infer<typeof fillFormRequestSchema>;

/** Execute a declared or local page action on the currently displayed page through its own UI entry. */
export const pageActionRequestSchema = z.object({
  mode: z.literal("page_action"),
  /** Declared operation ID (e.g. "form.save", "list.delete", "detail.form.save") or local action ("page.refresh", "<form>.discard"). */
  operation: runtimeKeySchema,
  /** Optional nested panel member path keys when disambiguating nested panel actions. */
  memberPath: z.array(runtimeKeySchema).min(1).optional(),
  /**
   * For row actions on a list member: the composite `<className>:<primaryKey>` key (required to disambiguate
   * mixed-type lists) or the plain `<primaryKey>` on single-type lists.
   */
  rowKey: runtimeKeySchema.optional(),
  /** Optional unbound action parameters (never form save field values). */
  input: runtimeJsonObjectSchema.optional(),
  /** Expected mounted page instance ID observed from `observe_display`/`present`; rejects as `stale` on mismatch. */
  expectedPageInstanceId: runtimeKeySchema.optional(),
  /** Expected mounted nested panel member instance ID observed from `memberInstances`; rejects as `stale` on mismatch. */
  expectedMemberInstanceId: runtimeKeySchema.optional(),
  /** Expected target object or create-draft observed on screen; rejects as `stale` on mismatch. */
  expectedTarget: expectedPageTargetSchema.optional(),
  /** Expected checked row keys (`<className>:<primaryKey>`, or plain `<primaryKey>` for single-type lists) for batch actions. */
  expectedCheckedKeys: z.array(runtimeKeySchema).optional(),
}).strict();
export type PageActionRequest = z.infer<typeof pageActionRequestSchema>;

/** Private transport from the runtime display tools to the host bound to this call. */
export const presentationCallRequestSchema = z.object({
  toolCallId: runtimeKeySchema,
  input: z.union([presentRequestSchema, observeDisplayRequestSchema, fillFormRequestSchema, pageActionRequestSchema]),
}).strict();

/** Private to admission and the active runtime tool, outside the definition and sandbox environment. */
export const runtimePresentationCallbackSchema = z.object({
  url: runtimeHttpUrlSchema,
  credential: runtimeKeySchema,
}).strict();
export type RuntimePresentationCallback = z.infer<typeof runtimePresentationCallbackSchema>;

/** A panel's explicit open request and its current instance's state report have different effects. */
export const displayPageAddressInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), address: pageAddressSchema }).strict(),
  z.object({ kind: z.literal("state"), address: pageAddressSchema }).strict(),
]);
export type DisplayPageAddressInput = z.infer<typeof displayPageAddressInputSchema>;

export const PANEL_LOAD_ERROR_CODES = {
  panelUnavailable: "panel_unavailable",
  fileUnavailable: "panel_file_unavailable",
  scriptThrew: "panel_script_threw",
  scriptRejected: "panel_script_rejected",
} as const;

const displayErrorSchema = z.object({ code: runtimeKeySchema, message: runtimeKeySchema }).strict();
export const displayLoadSchema = z.object({
  status: z.enum(["loading", "ready", "error"]),
  error: displayErrorSchema.optional(),
}).strict();
export type DisplayLoad = z.infer<typeof displayLoadSchema>;

const unobservedDisplaySchema = z.object({ known: z.literal(false), reason: runtimeKeySchema }).strict();
const observedDisplaySchema = z.object({
  known: z.literal(true),
  observedAt: runtimeTimestampSchema,
}).strict();
const selectedDisplaySchema = observedDisplaySchema.extend({
  placement: z.enum(["side", "overlay", "full-page"]),
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("artifact"),
      runId: runtimeIdSchema,
      path: outputPathSchema,
      title: z.string(),
    }).strict(),
    pageContextSchema.extend({
      kind: z.literal("page"),
      state: runtimeJsonObjectSchema.optional(),
      /** Unique ID of this mounted page instance; changes on remount or switching pages. */
      pageInstanceId: runtimeKeySchema.optional(),
      /** Unique instance IDs of mounted nested panel members keyed by dotted member path. */
      memberInstances: z.record(runtimeKeySchema, runtimeKeySchema).optional(),
      /** Current checked row keys (`<className>:<primaryKey>`) per list-of-object state field. */
      checkedKeys: z.record(runtimeKeySchema, z.array(runtimeKeySchema)).optional(),
    }),
  ]),
  load: displayLoadSchema,
});
export const displaySnapshotSchema = z.union([
  unobservedDisplaySchema,
  observedDisplaySchema.extend({ target: z.null() }),
  selectedDisplaySchema,
]);
export type DisplaySnapshot = z.infer<typeof displaySnapshotSchema>;

const openedResultSchema = z.object({
  status: z.literal("opened"),
  reason: z.enum(["target_selected", "load_error"]),
  current: selectedDisplaySchema,
  error: displayErrorSchema.optional(),
}).strict();
const notOpenedResultSchema = z.object({
  status: z.literal("not_opened"),
  reason: z.enum([
    "view_unavailable", "not_viewing_session", "sidebar_unavailable",
    "forbidden", "not_found", "unsupported_target", "blocked_unsaved", "superseded",
  ]),
  current: displaySnapshotSchema,
  error: displayErrorSchema.optional(),
}).strict();
const observedDisplayResultSchema = z.object({
  status: z.literal("observed"),
  reason: z.enum(["current_display", "view_unavailable", "not_viewing_session"]),
  current: displaySnapshotSchema,
}).strict();
export const formFieldRejectionSchema = z.object({
  path: runtimeKeySchema,
  reason: z.enum(["unknown_field", "read_only", "fixed", "invalid_value"]),
  message: runtimeKeySchema,
}).strict();
export type FormFieldRejection = z.infer<typeof formFieldRejectionSchema>;

/** In-browser request to fill explicit fields on a mounted live form. */
export interface FormFillRequestInput {
  readonly member?: string;
  readonly memberPath?: readonly string[];
  readonly values: Readonly<Record<string, RuntimeJsonValue>>;
  readonly overwriteUnsaved?: boolean;
  readonly expectedPageInstanceId?: string;
  readonly expectedMemberInstanceId?: string;
  readonly expectedTarget?: ExpectedPageTarget;
}

/** In-browser outcome returned by a mounted panel or form adapter for a `fill_form` request. */
export type FormFillOutcome =
  | {
      readonly ok: true;
      readonly member: string;
      readonly memberPath?: readonly string[];
      readonly filledFields: readonly string[];
      readonly rejectedFields?: readonly FormFieldRejection[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | "form_not_found"
        | "form_ambiguous"
        | "form_not_ready"
        | "blocked_unsaved"
        | "all_fields_rejected"
        | "stale";
      readonly member?: string;
      readonly memberPath?: readonly string[];
      readonly rejectedFields?: readonly FormFieldRejection[];
      readonly message?: string;
    };

const filledResultSchema = z.object({
  status: z.literal("filled"),
  reason: z.literal("form_updated"),
  member: runtimeKeySchema,
  memberPath: z.array(runtimeKeySchema).min(1).optional(),
  filledFields: z.array(runtimeKeySchema),
  rejectedFields: z.array(formFieldRejectionSchema).optional(),
  current: selectedDisplaySchema,
}).strict();
const notFilledResultSchema = z.object({
  status: z.literal("not_filled"),
  reason: z.enum([
    "view_unavailable",
    "not_viewing_session",
    "forbidden",
    "not_found",
    "no_page_shown",
    "unsupported_page",
    "form_not_found",
    "form_ambiguous",
    "form_not_ready",
    "blocked_unsaved",
    "all_fields_rejected",
    "stale",
  ]),
  member: runtimeKeySchema.optional(),
  memberPath: z.array(runtimeKeySchema).min(1).optional(),
  rejectedFields: z.array(formFieldRejectionSchema).optional(),
  current: displaySnapshotSchema,
  error: displayErrorSchema.optional(),
}).strict();
/** In-browser request to execute a declared or local page action on a mounted panel. */
export interface PageActionRequestInput {
  readonly operation: string;
  readonly memberPath?: readonly string[];
  readonly rowKey?: string;
  readonly input?: Readonly<Record<string, RuntimeJsonValue>>;
  readonly expectedPageInstanceId?: string;
  readonly expectedMemberInstanceId?: string;
  readonly expectedTarget?: ExpectedPageTarget;
  readonly expectedCheckedKeys?: readonly string[];
  readonly agentRun: {
    readonly sessionId: string;
    readonly runId: string;
    readonly toolCallId: string;
  };
}

/** Result of dispatching a live-bound page confirmation after the user approves it in chat. */
export type PageActionConfirmedDispatchResult =
  | {
      readonly ok: true;
      readonly intentId: string;
      readonly outcome: unknown;
      readonly summary: string;
    }
  | {
      readonly ok: false;
      readonly intentId: string;
      readonly reason: "stale" | "not_dispatched" | "failed" | "unknown";
      readonly message: string;
    };

/** Live confirmation handle bound to the mounted component instance, target, and edit version (no form snapshot copy). */
export interface PendingPageActionConfirmation {
  readonly intentId: string;
  readonly questionId: string;
  readonly operationId: string;
  readonly label: string;
  isStillValid(): { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly message: string };
  dispatch(): Promise<PageActionConfirmedDispatchResult>;
  cancel(reason: { readonly code: string; readonly message: string }): Promise<void>;
}

/** In-browser outcome returned by a mounted panel for a `page_action` request. */
export type PageActionOutcome =
  | {
      readonly ok: true;
      readonly kind: "executed";
      readonly operation: string;
      readonly intentId?: string;
      readonly outcome?: unknown;
    }
  | {
      readonly ok: true;
      readonly kind: "awaiting_confirmation";
      readonly operation: string;
      readonly intentId: string;
      readonly questionId: string;
      readonly label: string;
      readonly confirmation: PendingPageActionConfirmation;
    }
  | {
      readonly ok: false;
      readonly kind: "unknown";
      readonly reason: "outcome_unknown";
      readonly operation: string;
      readonly intentId?: string;
      readonly outcome?: unknown;
      readonly message?: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "action_not_found"
        | "action_unavailable"
        | "action_not_ready"
        | "input_required"
        | "validation_failed"
        | "cancelled"
        | "stale"
        | "failed";
      readonly operation?: string;
      readonly intentId?: string;
      readonly message?: string;
    };

const pageActionExecutedResultSchema = z.object({
  status: z.literal("executed"),
  reason: z.literal("action_completed"),
  operation: runtimeKeySchema,
  intentId: runtimeIdSchema.optional(),
  outcome: z.unknown().optional(),
  current: displaySnapshotSchema,
}).strict();
const pageActionAwaitingConfirmationResultSchema = z.object({
  status: z.literal("awaiting_confirmation"),
  reason: z.literal("confirmation_required"),
  operation: runtimeKeySchema,
  intentId: runtimeIdSchema,
  questionId: runtimeIdSchema,
  label: runtimeKeySchema,
  current: displaySnapshotSchema,
}).strict();
const pageActionNotExecutedResultSchema = z.object({
  status: z.literal("not_executed"),
  reason: z.enum([
    "view_unavailable",
    "not_viewing_session",
    "forbidden",
    "not_found",
    "no_page_shown",
    "unsupported_page",
    "action_not_found",
    "action_unavailable",
    "action_not_ready",
    "input_required",
    "validation_failed",
    "cancelled",
    "stale",
    "failed",
  ]),
  operation: runtimeKeySchema.optional(),
  intentId: runtimeIdSchema.optional(),
  current: displaySnapshotSchema,
  error: displayErrorSchema.optional(),
}).strict();
const pageActionUnknownResultSchema = z.object({
  status: z.literal("unknown"),
  reason: z.literal("outcome_unknown"),
  operation: runtimeKeySchema,
  intentId: runtimeIdSchema.optional(),
  outcome: z.unknown().optional(),
  current: displaySnapshotSchema,
  error: displayErrorSchema.optional(),
}).strict();
const unknownResultSchema = z.object({
  status: z.literal("unknown"),
  reason: z.literal("receipt_missing"),
  intentId: runtimeIdSchema.optional(),
  current: unobservedDisplaySchema,
  error: displayErrorSchema.optional(),
}).strict();

const observedResultSchema = z.discriminatedUnion("status", [
  openedResultSchema,
  notOpenedResultSchema,
  observedDisplayResultSchema,
  filledResultSchema,
  notFilledResultSchema,
  pageActionExecutedResultSchema,
  pageActionAwaitingConfirmationResultSchema,
  pageActionNotExecutedResultSchema,
  pageActionUnknownResultSchema,
]).refine(
  (result) => result.status !== "opened" || (result.reason === "load_error") === (result.current.load.status === "error"),
  { path: ["reason"], message: "An opened result reports load_error exactly when the selected target failed to load" },
);
export const presentationResultSchema = z.union([observedResultSchema, unknownResultSchema]);
export type PresentationResult = z.infer<typeof presentationResultSchema>;

/** A view keeps its ID for the lifetime of its mount, across session-run streams. */
export const presentationBindingSchema = z.object({ viewId: runtimeIdSchema }).strict();
export type PresentationBinding = z.infer<typeof presentationBindingSchema>;

/** Live-only payload on the host's session-run stream, carried as event: presentation. */
export const presentationFrameSchema = z.object({
  type: z.literal("presentation"),
  sessionId: runtimeIdSchema,
  runId: runtimeIdSchema,
  toolCallId: runtimeKeySchema,
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("artifact"), artifact: runtimeArtifactSchema }).strict(),
    z.object({
      kind: z.literal("page"),
      address: pageAddressSchema,
      state: runtimeJsonObjectSchema.optional(),
    }).strict(),
    z.object({ kind: z.literal("observe") }).strict(),
    z.object({
      kind: z.literal("fill_form"),
      member: runtimeKeySchema.optional(),
      memberPath: z.array(runtimeKeySchema).min(1).optional(),
      values: runtimeJsonObjectSchema,
      overwriteUnsaved: z.boolean().optional(),
      expectedPageInstanceId: runtimeKeySchema.optional(),
      expectedMemberInstanceId: runtimeKeySchema.optional(),
      expectedTarget: expectedPageTargetSchema.optional(),
    }).strict(),
    z.object({
      kind: z.literal("page_action"),
      operation: runtimeKeySchema,
      memberPath: z.array(runtimeKeySchema).min(1).optional(),
      rowKey: runtimeKeySchema.optional(),
      input: runtimeJsonObjectSchema.optional(),
      expectedPageInstanceId: runtimeKeySchema.optional(),
      expectedMemberInstanceId: runtimeKeySchema.optional(),
      expectedTarget: expectedPageTargetSchema.optional(),
      expectedCheckedKeys: z.array(runtimeKeySchema).optional(),
    }).strict(),
  ]),
}).strict();
export type PresentationFrame = z.infer<typeof presentationFrameSchema>;

/** Body of POST /sessions/:sessionId/runs/:runId/presentation-result. */
export const presentationReceiptSchema = z.object({
  connectionId: runtimeIdSchema,
  toolCallId: runtimeKeySchema,
  result: observedResultSchema,
}).strict();
export type PresentationReceipt = z.infer<typeof presentationReceiptSchema>;
