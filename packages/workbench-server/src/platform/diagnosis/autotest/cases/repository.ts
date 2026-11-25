import type { CaseSet, CaseSetListItem, TestCase } from "@ontomato/contracts/autotest";
/**
 * CaseSet file-based repository.
 *
 * Stores each case set as a JSON file under
 * `{dataDir}/case-sets/{id}.json`.
 *
 * Supports importing from legacy ragchat-server JSON format.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../../../logging/logger";
import { autotestConfig } from "../config";

const logger = createLogger("autotest:cases");

function caseSetsDir(): string {
  return path.join(autotestConfig.dataDir, "case-sets");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Whether a case or case-set identifier is non-empty and path-safe. */
export function isValidCaseId(id: string): boolean {
  const trimmed = id.trim();
  return Boolean(trimmed) && !/[/\\:*?"<>|]/.test(trimmed) && !trimmed.includes("..");
}

/** Validate id to prevent path traversal attacks. */
function validateId(id: string): void {
  if (!isValidCaseId(id)) {
    throw new Error(`Invalid id: ${id}`);
  }
}

function caseSetPath(id: string): string {
  validateId(id);
  return path.join(caseSetsDir(), `${id}.json`);
}

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

/** Case sets are visible and writable only inside the domain that owns them. */
function belongsTo(cs: CaseSet, domainId: string): boolean {
  return cs.domainId === domainId;
}

export function listCaseSets(domainId: string): CaseSetListItem[] {
  ensureDir(caseSetsDir());
  const dir = caseSetsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

  const results: CaseSetListItem[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8");
      const cs = JSON.parse(raw) as CaseSet;
      if (!belongsTo(cs, domainId)) continue;
      results.push({
        id: cs.id,
        name: cs.name,
        domainId: cs.domainId,
        caseCount: cs.cases.length,
        createdAt: cs.createdAt,
        updatedAt: cs.updatedAt,
      });
    } catch (err) {
      logger.warn("Skipping corrupt case-set file", { file, error: String(err) });
    }
  }

  return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getCaseSet(id: string, domainId: string): CaseSet | null {
  const fp = caseSetPath(id);
  if (!fs.existsSync(fp)) return null;
  try {
    const cs = JSON.parse(fs.readFileSync(fp, "utf-8")) as CaseSet;
    return belongsTo(cs, domainId) ? cs : null;
  } catch {
    return null;
  }
}

export function saveCaseSet(cs: CaseSet): void {
  ensureDir(caseSetsDir());
  fs.writeFileSync(caseSetPath(cs.id), JSON.stringify(cs, null, 2), "utf-8");
  logger.info("Case set saved", { id: cs.id, name: cs.name, caseCount: cs.cases.length });
}

/**
 * Update an existing case set belonging to `domainId` and persist it.
 * Returns `null` when the case set does not exist or belongs to another domain.
 */
export function updateCaseSet(
  id: string,
  domainId: string,
  patch: { name?: string; cases?: TestCase[] },
): CaseSet | null {
  const cs = getCaseSet(id, domainId);
  if (!cs) return null;
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed) cs.name = trimmed;
  }
  if (patch.cases !== undefined) {
    cs.cases = patch.cases;
  }
  cs.updatedAt = new Date().toISOString();
  saveCaseSet(cs);
  return cs;
}

export function deleteCaseSet(id: string, domainId: string): boolean {
  if (!getCaseSet(id, domainId)) return false;
  const fp = caseSetPath(id);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  logger.info("Case set deleted", { id });
  return true;
}

/** Generate a short, path-safe case set id. */
function generateCaseSetId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

function normalizeCaseIdText(raw: unknown, fallback: string): string {
  const text = raw == null ? "" : String(raw).trim();
  const base = text || fallback;
  const safe = base
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\.\./g, ".")
    .trim();
  return safe || fallback;
}

export function makeUniqueCaseId(
  raw: unknown,
  index: number,
  used: Set<string>
): { caseId: string; changed: boolean } {
  const fallback = `case-${index + 1}`;
  const base = normalizeCaseIdText(raw, fallback);
  let candidate = base;
  let suffix = 2;

  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }

  used.add(candidate);
  return { caseId: candidate, changed: candidate !== String(raw ?? "").trim() };
}

export function ensureUniqueCaseIds(cases: TestCase[]): TestCase[] {
  const used = new Set<string>();
  return cases.map((testCase, index) => {
    const { caseId } = makeUniqueCaseId(testCase.caseId, index, used);
    return caseId === testCase.caseId ? testCase : { ...testCase, caseId };
  });
}

/**
 * Create and persist an empty case set.
 *
 * Used when the user explicitly creates a new (empty) set to fill in later.
 * Unlike {@link importCaseSet}, this intentionally allows zero cases.
 */
export function createEmptyCaseSet(name: string, domainId: string): CaseSet {
  const now = new Date().toISOString();
  const caseSet: CaseSet = {
    id: generateCaseSetId(),
    name,
    domainId,
    cases: [],
    createdAt: now,
    updatedAt: now,
  };
  saveCaseSet(caseSet);
  return caseSet;
}

/**
 * Whether a create-case-set payload represents "no cases" (a new empty set).
 *
 * Matches: omitted/null, an empty array, or an object with an empty `cases`
 * array. Malformed shapes (non-array, object without a `cases` array) are NOT
 * treated as empty so they still hit {@link importCaseSet}'s format validation.
 */
export function isEmptyCasePayload(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") {
    const inner = (data as Record<string, unknown>).cases;
    if (Array.isArray(inner)) return inner.length === 0;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */

const CSV_HEADER_MAP: Readonly<Record<string, keyof TestCase>> = {
  caseid: "caseId",
  id: "caseId",
  question: "question",
  query: "question",
  expectedanswer: "expectedAnswer",
  answer: "expectedAnswer",
  expectedlogic: "expectedLogic",
  logic: "expectedLogic",
  judgment: "judgment",
  judgement: "judgment",
};

/** Parse RFC 4180 CSV text into rows of string cells (handles BOM, CRLF/LF, and quoted fields). */
export function parseCsvRows(content: string): string[][] {
  const source = content.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === "\"") {
        if (source[i + 1] === "\"") {
          field += "\"";
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === "\"" && field.length === 0) {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new Error("Invalid CSV: unterminated quoted field");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

/** Parse CSV text with a header row into raw case objects consumable by {@link importCaseSet}. */
export function parseCaseSetCsv(content: string): Record<string, string>[] {
  const rows = parseCsvRows(content);
  if (rows.length < 2) {
    throw new Error("CSV must include a header row and at least one case row");
  }
  const headerKeys = rows[0]!.map((cell) => {
    const normalized = cell.trim().toLowerCase().replace(/[\s_-]+/g, "");
    return CSV_HEADER_MAP[normalized] ?? null;
  });
  if (!headerKeys.includes("question")) {
    throw new Error("CSV header must include a 'question' column");
  }

  const parsed: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]!;
    const item: Record<string, string> = {};
    for (let col = 0; col < headerKeys.length; col++) {
      const key = headerKeys[col];
      if (!key) continue;
      const value = cells[col];
      if (value !== undefined && value.length > 0) {
        item[key] = value;
      }
    }
    parsed.push(item);
  }
  return parsed;
}

/**
 * Parse raw import text in JSON or CSV format into a payload accepted by {@link importCaseSet}.
 * In `"auto"` mode, text starting with `[` or `{` is parsed as JSON; otherwise it is parsed as CSV.
 */
export function parseCaseSetImportPayload(
  content: string,
  format: "auto" | "json" | "csv" = "auto",
): unknown {
  const cleaned = content.replace(/^\uFEFF/, "").trim();
  if (!cleaned) {
    throw new Error("Import content is empty");
  }
  const effectiveFormat = format === "auto"
    ? (cleaned.startsWith("[") || cleaned.startsWith("{") ? "json" : "csv")
    : format;

  if (effectiveFormat === "json") {
    try {
      return JSON.parse(cleaned);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSON: ${detail}`);
    }
  }
  return parseCaseSetCsv(cleaned);
}

/**
 * Create a CaseSet from a raw JSON payload.
 *
 * Accepts either:
 *   1. An array of case objects (legacy ragchat-server format).
 *   2. An object with a `cases` array and optional metadata.
 *
 * Legacy ragchat-server case fields:
 *   - case_id / caseId
 *   - question
 *   - answer / expectedAnswer
 *   - judgment
 *   - logic / expectedLogic
 */
export function importCaseSet(
  name: string,
  payload: unknown,
  domainId: string
): { caseSet: CaseSet; warnings: string[] } {
  const warnings: string[] = [];

  /** Maximum number of cases per import to prevent resource exhaustion. */
  const MAX_IMPORT_CASES = 10_000;

  let rawCases: unknown[];
  if (Array.isArray(payload)) {
    rawCases = payload;
  } else if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as Record<string, unknown>).cases)
  ) {
    rawCases = (payload as Record<string, unknown>).cases as unknown[];
  } else {
    throw new Error("Payload must be an array of cases or an object with a cases array");
  }

  if (rawCases.length > MAX_IMPORT_CASES) {
    throw new Error(`Too many cases (${rawCases.length}). Maximum is ${MAX_IMPORT_CASES}.`);
  }

  const cases: TestCase[] = [];
  const usedCaseIds = new Set<string>();
  for (let i = 0; i < rawCases.length; i++) {
    const item = rawCases[i];
    if (!item || typeof item !== "object") {
      warnings.push(`Item at index ${i} is not an object, skipped`);
      continue;
    }

    const obj = item as Record<string, unknown>;
    const rawCaseId = obj.case_id ?? obj.caseId;
    const { caseId, changed: caseIdChanged } = makeUniqueCaseId(rawCaseId, i, usedCaseIds);
    const question = String(obj.question ?? "").trim();

    if (!question) {
      warnings.push(`Item at index ${i} (caseId: ${caseId}) has no question, skipped`);
      continue;
    }

    if (rawCaseId != null && caseIdChanged) {
      warnings.push(`Item at index ${i} caseId normalized to ${caseId}`);
    }

    const expectedAnswer =
      obj.expectedAnswer != null
        ? String(obj.expectedAnswer)
        : obj.answer != null
          ? String(obj.answer)
          : undefined;

    const expectedLogic =
      obj.expectedLogic != null
        ? String(obj.expectedLogic)
        : obj.logic != null
          ? String(obj.logic)
          : undefined;

    const judgment = obj.judgment != null ? String(obj.judgment) : undefined;

    cases.push({ caseId, question, expectedAnswer, expectedLogic, judgment });
  }

  if (cases.length === 0) {
    throw new Error("No valid cases found in payload");
  }

  const now = new Date().toISOString();
  const caseSet: CaseSet = {
    id: generateCaseSetId(),
    name,
    domainId,
    cases,
    createdAt: now,
    updatedAt: now,
  };

  saveCaseSet(caseSet);

  return { caseSet, warnings };
}
