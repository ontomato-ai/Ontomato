import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelFormField, PanelFormValues } from "@ontomato/contracts/panel-projection";

/** Editable field key of a single test case entry inside `TestcaseWorkbench`. */
export type TestcaseFieldKey = "caseId" | "question" | "expectedAnswer" | "expectedLogic" | "judgment";

/** Normalized editable representation of one test case in a case set. */
export interface TestcaseEntry {
  readonly caseId: string;
  readonly question: string;
  readonly expectedAnswer: string;
  readonly expectedLogic: string;
  readonly judgment: string;
}

/** Resolved display metadata for one test case field, derived from the owner's `/cases` itemFields when present. */
export interface TestcaseFieldMeta {
  readonly label: string;
  readonly placeholder: string;
  readonly help: string | null;
  readonly readOnly: boolean;
}

export type TestcaseFieldMetaMap = Readonly<Record<TestcaseFieldKey, TestcaseFieldMeta>>;

const DEFAULT_FIELD_LABELS: Readonly<Record<TestcaseFieldKey, string>> = {
  caseId: "Case ID",
  question: "Question",
  expectedAnswer: "Expected answer",
  expectedLogic: "Expected logic",
  judgment: "Judgment",
};

function toEditableString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Extracts the owner-declared default judgment string from `/cases` `object-array` metadata when available. */
export function extractDefaultJudgment(fields: readonly PanelFormField[]): string {
  const casesField = fields.find((field) => field.path === "/cases");
  if (casesField?.control.kind === "object-array") {
    const rawDefault = casesField.control.defaultItem?.judgment;
    if (typeof rawDefault === "string" && rawDefault.trim()) return rawDefault.trim();
    const judgmentItem = casesField.control.itemFields.find((item) => item.path === "/judgment");
    if (judgmentItem?.control.kind === "text" && typeof judgmentItem.control.placeholder === "string" && judgmentItem.control.placeholder.trim()) {
      return judgmentItem.control.placeholder.trim();
    }
  }
  return "";
}

/** Extracts localized field labels, placeholders, help text, and read-only flags from the owner's form description. */
export function extractTestcaseFieldMeta(fields: readonly PanelFormField[]): TestcaseFieldMetaMap {
  const casesField = fields.find((field) => field.path === "/cases");
  const itemFields = casesField?.control.kind === "object-array" ? casesField.control.itemFields : [];
  const casesReadOnly = casesField?.readOnly === true;

  const metaFor = (key: TestcaseFieldKey): TestcaseFieldMeta => {
    const found = itemFields.find((item) => item.path === `/${key}`);
    const placeholder = found?.control.kind === "text" && typeof found.control.placeholder === "string"
      ? found.control.placeholder
      : "";
    return {
      label: found?.label || DEFAULT_FIELD_LABELS[key],
      placeholder,
      help: found?.help ?? null,
      readOnly: casesReadOnly || found?.readOnly === true,
    };
  };

  return {
    caseId: metaFor("caseId"),
    question: metaFor("question"),
    expectedAnswer: metaFor("expectedAnswer"),
    expectedLogic: metaFor("expectedLogic"),
    judgment: metaFor("judgment"),
  };
}

/** Normalizes an arbitrary record into a `TestcaseEntry` with string fields. */
export function normalizeTestcaseEntry(raw: unknown, defaultJudgment = ""): TestcaseEntry {
  const record = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const rawJudgment = toEditableString(record.judgment);
  return {
    caseId: toEditableString(record.caseId),
    question: toEditableString(record.question),
    expectedAnswer: toEditableString(record.expectedAnswer),
    expectedLogic: toEditableString(record.expectedLogic),
    judgment: rawJudgment.trim() ? rawJudgment : (record.judgment === "" ? "" : defaultJudgment),
  };
}

/** Extracts normalized test case entries from owner form values. */
export function extractTestcases(values: PanelFormValues, defaultJudgment = ""): TestcaseEntry[] {
  const rawCases = values.cases;
  if (!Array.isArray(rawCases)) return [];
  return rawCases.map((entry) => normalizeTestcaseEntry(entry, defaultJudgment));
}

/** Serializes the case set name and normalized cases back into canonical `PanelFormValues`. */
export function toCaseSetFormValues(
  name: string,
  cases: readonly TestcaseEntry[],
  baseValues?: PanelFormValues,
): PanelFormValues {
  const serializedCases: RuntimeJsonValue[] = cases.map((item) => ({
    caseId: item.caseId,
    question: item.question,
    expectedAnswer: item.expectedAnswer,
    expectedLogic: item.expectedLogic,
    judgment: item.judgment,
  }));
  return {
    ...(baseValues ?? {}),
    name,
    cases: serializedCases,
  };
}

/** Formats test cases as indented JSON for the right-hand live JSON editor. */
export function serializeTestcasesJson(cases: readonly TestcaseEntry[]): string {
  const formatted = cases.map((item) => {
    const out: Record<string, string> = {
      caseId: item.caseId,
      question: item.question,
    };
    if (item.expectedAnswer) out.expectedAnswer = item.expectedAnswer;
    if (item.expectedLogic) out.expectedLogic = item.expectedLogic;
    if (item.judgment) out.judgment = item.judgment;
    return out;
  });
  return JSON.stringify(formatted, null, 2);
}

/**
 * Parses user-edited JSON text into test cases. Accepts either a top-level array of case objects
 * or an object containing a `cases` array. Returns an error message without mutating state when invalid.
 */
export function parseTestcasesJson(
  text: string,
  defaultJudgment = "",
): { readonly ok: true; readonly cases: TestcaseEntry[] } | { readonly ok: false; readonly error: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "JSON cannot be empty; expected an array of test cases." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (reason) {
    return {
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
  const rawList = Array.isArray(parsed)
    ? parsed
    : (parsed !== null && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).cases))
      ? (parsed as { cases: unknown[] }).cases
      : null;

  if (!rawList) {
    return { ok: false, error: "Expected a JSON array of cases or an object with a \"cases\" array." };
  }

  const cases: TestcaseEntry[] = [];
  for (let i = 0; i < rawList.length; i += 1) {
    const entry = rawList[i];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, error: `Case #${i + 1} must be a JSON object.` };
    }
    cases.push(normalizeTestcaseEntry(entry, defaultJudgment));
  }
  return { ok: true, cases };
}

/** Generates the next non-colliding case ID (for example `case-001`, `case-002`). */
export function generateNextCaseId(cases: readonly TestcaseEntry[]): string {
  const existing = new Set(cases.map((item) => item.caseId.trim()).filter(Boolean));
  let sequence = cases.length + 1;
  while (true) {
    const candidate = `case-${String(sequence).padStart(3, "0")}`;
    if (!existing.has(candidate)) return candidate;
    sequence += 1;
  }
}

/** Returns `true` when at least one case has a non-empty `question`. */
export function hasValidTestcases(cases: readonly TestcaseEntry[]): boolean {
  return cases.some((item) => item.question.trim().length > 0);
}

/** Produces a concise single-line summary for a case row in the left list pane. */
export function testcaseSummary(item: TestcaseEntry, emptyFallback: string): string {
  const trimmed = item.question.trim();
  if (!trimmed) return emptyFallback;
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}...` : trimmed;
}

/** Clamps a resizable pane width within `[min, max]`. */
export function clampPaneWidth(width: number, min: number, max: number): number {
  return Math.min(Math.max(width, min), max);
}
