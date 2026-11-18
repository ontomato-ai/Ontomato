import { z } from "zod";
import { runtimeArtifactSchema } from "./agent-runtime-artifacts";
import {
  runtimeIdSchema,
  runtimeJsonObjectSchema,
  runtimeKeySchema,
  runtimeRelativePathSchema,
  runtimeTimestampSchema,
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
    pageContextSchema.extend({ kind: z.literal("page"), state: runtimeJsonObjectSchema.optional() }),
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
const unknownResultSchema = z.object({
  status: z.literal("unknown"),
  reason: z.literal("receipt_missing"),
  current: unobservedDisplaySchema,
  error: displayErrorSchema.optional(),
}).strict();

const observedResultSchema = z.discriminatedUnion("status", [openedResultSchema, notOpenedResultSchema]).refine(
  (result) => result.status !== "opened" || (result.reason === "load_error") === (result.current.load.status === "error"),
  { path: ["reason"], message: "An opened result reports load_error exactly when the selected target failed to load" },
);
export const presentationResultSchema = z.union([observedResultSchema, unknownResultSchema]);
export type PresentationResult = z.infer<typeof presentationResultSchema>;

/** The host issues a fresh ID for each authenticated session-run stream that requests presentation. */
export const presentationBindingSchema = z.object({ connectionId: runtimeIdSchema }).strict();
export type PresentationBinding = z.infer<typeof presentationBindingSchema>;

/** Live-only payload on the host's session-run stream, carried as event: presentation. */
export const presentationFrameSchema = z.object({
  type: z.literal("presentation"),
  sessionId: runtimeIdSchema,
  runId: runtimeIdSchema,
  toolCallId: runtimeKeySchema,
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("artifact"), artifact: runtimeArtifactSchema }).strict(),
    z.object({ kind: z.literal("page"), address: pageAddressSchema, state: runtimeJsonObjectSchema.optional() }).strict(),
  ]),
}).strict();
export type PresentationFrame = z.infer<typeof presentationFrameSchema>;

/** Body of POST /sessions/:sessionId/runs/:runId/presentation-result. */
export const presentationReceiptSchema = presentationBindingSchema.extend({
  toolCallId: runtimeKeySchema,
  result: observedResultSchema,
});
export type PresentationReceipt = z.infer<typeof presentationReceiptSchema>;
