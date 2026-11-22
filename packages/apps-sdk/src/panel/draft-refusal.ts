/*
 * A draft the page cannot use (panelisation lead, 2026-11-22): the platform could not read it, it was written for another
 * page, or no form here takes it. It is that draft's problem, never the panel's: the panel opens as it is, and the reader
 * is told in one sentence, in their own words, which file it was and what it lacks — the field's own name kept beside it.
 */

/** Why a draft cannot be used: the envelope's fields the platform found missing or wrong, or another reason it gives. */
export class PanelDraftUnusable extends Error {
  constructor(
    /** The draft file, as its link names it. */
    readonly file: string,
    readonly cause:
      | { kind: "fields"; fields: readonly string[] }
      | { kind: "read"; reason: DraftReadReason | null; message: string }
      | { kind: "otherPage"; pageKey: string },
  ) {
    super(cause.kind === "fields" ? `${file}: ${cause.fields.join(", ")}` : cause.kind === "read" ? `${file}: ${cause.message}` : `${file}: page ${cause.pageKey}`);
    this.name = "PanelDraftUnusable";
  }
}

/** Why the platform could not read a draft, by the code it answered with: its run is gone, its file is not there, or the reader may not read it. */
type DraftReadReason = "run" | "file" | "fileInAnotherRun" | "forbidden";
const READ_REASONS: Readonly<Record<string, DraftReadReason>> = {
  NOT_FOUND: "run",
  PAGE_DRAFT_NOT_FOUND: "file",
  FORBIDDEN: "forbidden",
};

/**
 * The platform's answer when it could not read a draft: the fields its check names, when the payload carries them, else
 * the reason its code gives, with its own text for a code the page does not know.
 */
export function unreadableDraft(file: string, failure: unknown): PanelDraftUnusable {
  const payload = (failure as { payload?: { error?: { code?: string }; details?: {
    issues?: { path?: readonly (string | number)[] }[]; samePathInAnotherRun?: boolean;
  } } } | null)?.payload;
  const fields = (payload?.details?.issues ?? []).map(({ path }) => (path ?? []).join(".")).filter(Boolean);
  if (fields.length) return new PanelDraftUnusable(file, { kind: "fields", fields: [...new Set(fields)] });
  const code = payload?.error?.code;
  const reason = code === "PAGE_DRAFT_NOT_FOUND" && payload?.details?.samePathInAnotherRun === true
    ? "fileInAnotherRun" : code === undefined ? null : READ_REASONS[code] ?? null;
  return new PanelDraftUnusable(file, {
    kind: "read",
    reason,
    message: failure instanceof Error ? failure.message : String(failure),
  });
}

const READ_WORDS: Readonly<Record<DraftReadReason, string>> = {
  run: "platform.draftRunMissing",
  file: "platform.draftFileMissing",
  fileInAnotherRun: "platform.draftFileInAnotherRun",
  forbidden: "platform.draftForbidden",
};

type Translate = (key: string, params?: Readonly<Record<string, string>>) => string;

/** The envelope's fields in the reader's words; any other path as it is. */
const FIELD_WORDS: Readonly<Record<string, string>> = {
  "target.objectType": "platform.draftFieldObjectType",
  "target.id": "platform.draftFieldId",
  "operation": "platform.draftFieldOperation",
  "pageKey": "platform.draftFieldPageKey",
  "form": "platform.draftFieldForm",
};

/** The sentence the reader is shown for a draft the page cannot use. */
export function draftRefusalText(refusal: PanelDraftUnusable, t: Translate): string {
  const { file, cause } = refusal;
  if (cause.kind === "otherPage") return t("platform.draftOtherPage", { file });
  if (cause.kind === "read") return cause.reason ? t(READ_WORDS[cause.reason], { file }) : t("platform.draftUnreadable", { file, reason: cause.message });
  const fields = cause.fields.map((field) => (FIELD_WORDS[field] ? `${t(FIELD_WORDS[field])} (${field})` : field)).join(", ");
  return t("platform.draftUnusableFields", { file, fields });
}
