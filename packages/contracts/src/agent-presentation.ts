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
const pageAddressSchema = z.string().regex(
  /^\/(?!\/)[^\\\s\p{Cc}]*$/u,
  "Expected a site-relative page path starting with a single '/'",
);

function hasStateQuery(address: string): boolean {
  const search = /^[^?#]*\?([^#]*)/.exec(address)?.[1];
  return new URLSearchParams(search).has("state");
}

/** Route registration, access and declared page state belong to the page resolver. */
const presentTargetMessage = "Invalid present target: target must be either a registered site-relative page path starting with '/' "
  + "(such as an entrance path listed under Available entrances in the panel skill, e.g. '/ontology/assets/actions') "
  + "or an artifact file path under 'outputs/<relative-path>'.";
const presentFields = z.object({
  target: z.string({ required_error: presentTargetMessage, invalid_type_error: presentTargetMessage }).refine(
    target => pageAddressSchema.safeParse(target).success || outputPathSchema.safeParse(target).success,
    presentTargetMessage,
  ),
  state: runtimeJsonObjectSchema.optional(),
}).strict();
const validPresentState = ({ target, state }: z.infer<typeof presentFields>) =>
  state === undefined || (target.startsWith("/") && !hasStateQuery(target));
const presentStateIssue = { path: ["state"], message: "State requires a page path without a '?state=' query parameter" };
export const presentRequestSchema = presentFields.refine(validPresentState, presentStateIssue);
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
  /** Explicitly allow overwriting fields edited by the user after explicit user confirmation. */
  overwriteUnsaved: z.boolean().optional(),
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
   * For row actions on a list member: the composite `<className>:<primaryKey>` key (required on mixed-type or
   * dynamic-type lists) or the plain `<primaryKey>` on single-type lists.
   */
  rowKey: runtimeKeySchema.optional(),
  /** Optional unbound action parameters (never form save field values). */
  input: runtimeJsonObjectSchema.optional(),
}).strict();
export type PageActionRequest = z.infer<typeof pageActionRequestSchema>;

/** Private transport from the runtime display tools to the host bound to this call. */
export const presentationCallRequestSchema = z.object({
  toolCallId: runtimeKeySchema,
  input: z.discriminatedUnion("mode", [
    presentFields.extend({ mode: z.undefined() }),
    observeDisplayRequestSchema,
    fillFormRequestSchema,
    pageActionRequestSchema,
  ]).refine(input => input.mode !== undefined || validPresentState(input), presentStateIssue),
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
export const observedPageTargetSchema = pageContextSchema.extend({
  kind: z.literal("page"),
  /** Unique ID of this mounted page instance; changes on remount or switching pages. */
  pageInstanceId: runtimeKeySchema.optional(),
  /** Unique ID of the mounted top-level direct panel instance; changes when the panel definition is swapped in place. */
  panelInstanceId: runtimeKeySchema.optional(),
  /** Unique instance IDs of mounted nested panel members keyed by dotted member path. */
  memberInstances: z.record(runtimeKeySchema, runtimeKeySchema).optional(),
  /** Unique instance IDs of mounted action/list/form entries keyed by full operation ID (or `row:<opId>`). */
  entryInstances: z.record(runtimeKeySchema, runtimeKeySchema).optional(),
  /** Current checked row keys (`<className>:<primaryKey>`) per list-of-object state field. */
  checkedKeys: z.record(runtimeKeySchema, z.array(runtimeKeySchema)).optional(),
  /** Current dashboard board ID on dashboard pages. */
  dashboardId: runtimeKeySchema.optional(),
  /** Current selected or parameter-dialog card ID on dashboard pages. */
  cardId: runtimeKeySchema.optional(),
});
export type ObservedPageTarget = z.infer<typeof observedPageTargetSchema>;

const selectedDisplaySchema = observedDisplaySchema.extend({
  placement: z.enum(["side", "overlay", "full-page"]),
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("artifact"),
      runId: runtimeIdSchema,
      path: outputPathSchema,
      title: z.string(),
    }).strict(),
    observedPageTargetSchema,
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
export const blockedUnsavedFormSchema = z.object({
  member: runtimeKeySchema,
  memberPath: z.array(runtimeKeySchema).min(1).optional(),
  target: z.union([
    z.object({
      kind: z.literal("object"),
      objectType: runtimeKeySchema,
      primaryKey: runtimeKeySchema,
    }).strict(),
    z.object({
      kind: z.literal("draft"),
      id: z.string().min(1).max(200).optional(),
    }).strict(),
  ]).optional(),
}).strict();
export type BlockedUnsavedForm = z.infer<typeof blockedUnsavedFormSchema>;

const notOpenedResultSchema = z.object({
  status: z.literal("not_opened"),
  reason: z.enum([
    "view_unavailable", "not_viewing_session", "sidebar_unavailable",
    "forbidden", "not_found", "unsupported_target", "outside_embedded_host", "blocked_unsaved", "superseded", "previous_step_failed",
  ]),
  blockedForms: z.array(blockedUnsavedFormSchema).min(1).optional(),
  current: displaySnapshotSchema,
  error: displayErrorSchema.optional(),
}).strict();
const observedDisplayResultSchema = z.object({
  status: z.literal("observed"),
  reason: z.enum(["current_display", "view_unavailable", "not_viewing_session", "previous_step_failed"]),
  current: displaySnapshotSchema,
  error: displayErrorSchema.optional(),
}).strict();
export const formFieldRejectionSchema = z.object({
  path: runtimeKeySchema,
  reason: z.enum(["unknown_field", "read_only", "fixed", "invalid_value", "secret"]),
  message: runtimeKeySchema,
}).strict();
export type FormFieldRejection = z.infer<typeof formFieldRejectionSchema>;

/** In-browser request to fill explicit fields on a mounted live form. */
export interface FormFillRequestInput {
  readonly agentRun?: PageActionRequestInput["agentRun"];
  readonly member?: string;
  readonly memberPath?: readonly string[];
  readonly values: Readonly<Record<string, RuntimeJsonValue>>;
  readonly overwriteUnsaved?: boolean;
  readonly expectedPageInstanceId?: string;
  readonly expectedPanelInstanceId?: string;
  readonly expectedMemberInstanceId?: string;
  readonly expectedFormInstanceId?: string;
  readonly expectedTarget?: ExpectedPageTarget;
  readonly expectedDashboardId?: string;
  readonly expectedCardId?: string;
}

/** In-browser outcome returned by a mounted panel or form adapter for a `fill_form` request. */
export type FormFillOutcome =
  | {
      readonly ok: true;
      readonly member: string;
      readonly memberPath?: readonly string[];
      readonly filledFields: readonly string[];
      readonly write?: PageActionOutcome;
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
    "previous_step_failed",
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
  readonly expectedPanelInstanceId?: string;
  readonly expectedMemberInstanceId?: string;
  readonly expectedEntryInstanceId?: string;
  readonly expectedTarget?: ExpectedPageTarget;
  readonly expectedCheckedKeys?: readonly string[];
  readonly expectedDashboardId?: string;
  readonly expectedCardId?: string;
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
      readonly reason: "stale" | "not_dispatched" | "failed" | "partial" | "unknown";
      readonly code?: string;
      readonly savedFields?: readonly string[];
      readonly outcome?: unknown;
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
      readonly kind: "partially_executed";
      readonly reason: "partial_completion";
      readonly operation: string;
      readonly intentId?: string;
      readonly code: string;
      readonly message: string;
      readonly savedFields?: readonly string[];
      readonly outcome: unknown;
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
      readonly code?: string;
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
const pageActionPartiallyExecutedResultSchema = z.object({
  status: z.literal("partially_executed"),
  reason: z.literal("partial_completion"),
  operation: runtimeKeySchema,
  intentId: runtimeIdSchema.optional(),
  savedFields: z.array(runtimeKeySchema).optional(),
  outcome: z.unknown(),
  current: displaySnapshotSchema,
  error: displayErrorSchema,
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
    "previous_step_failed",
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
  pageActionPartiallyExecutedResultSchema,
  pageActionAwaitingConfirmationResultSchema,
  pageActionNotExecutedResultSchema,
  pageActionUnknownResultSchema,
]).refine(
  (result) => result.status !== "opened" || (result.reason === "load_error") === (result.current.load.status === "error"),
  { path: ["reason"], message: "An opened result reports load_error exactly when the selected target failed to load" },
);
export const presentationResultSchema = z.union([observedResultSchema, unknownResultSchema]);
export type PresentationResult = z.infer<typeof presentationResultSchema>;

/** The view ID lasts for the mount. The initial page belongs only to the run started by this message. */
export const presentationBindingSchema = z.object({
  viewId: runtimeIdSchema,
  initialPage: observedPageTargetSchema.optional(),
}).strict();
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
      expectedPanelInstanceId: runtimeKeySchema.optional(),
      expectedMemberInstanceId: runtimeKeySchema.optional(),
      expectedFormInstanceId: runtimeKeySchema.optional(),
      expectedTarget: expectedPageTargetSchema.optional(),
      expectedDashboardId: runtimeKeySchema.optional(),
      expectedCardId: runtimeKeySchema.optional(),
    }).strict(),
    z.object({
      kind: z.literal("page_action"),
      operation: runtimeKeySchema,
      memberPath: z.array(runtimeKeySchema).min(1).optional(),
      rowKey: runtimeKeySchema.optional(),
      input: runtimeJsonObjectSchema.optional(),
      expectedPageInstanceId: runtimeKeySchema.optional(),
      expectedPanelInstanceId: runtimeKeySchema.optional(),
      expectedMemberInstanceId: runtimeKeySchema.optional(),
      expectedEntryInstanceId: runtimeKeySchema.optional(),
      expectedTarget: expectedPageTargetSchema.optional(),
      expectedCheckedKeys: z.array(runtimeKeySchema).optional(),
      expectedDashboardId: runtimeKeySchema.optional(),
      expectedCardId: runtimeKeySchema.optional(),
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
