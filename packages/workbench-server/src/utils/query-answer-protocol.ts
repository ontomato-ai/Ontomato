import type { ResultTruncation } from "@ontomato/contracts/query-execution";
import { tApp } from "../i18n";
export interface QueryAnswerPayload extends Partial<ResultTruncation> {
  answer: unknown[];
  problem?: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads the data engine's partial-result marker from one result record. Complete results carry
 * none of the three fields; a partial result must carry all of them.
 */
export function parseResultTruncation(
  record: Record<string, unknown>,
  context: string
): ResultTruncation | undefined {
  const { truncated, rowLimit, truncationHint } = record;
  if (truncated === undefined && rowLimit === undefined && truncationHint === undefined) {
    return undefined;
  }
  if (
    truncated !== true ||
    typeof rowLimit !== "number" ||
    !Number.isSafeInteger(rowLimit) ||
    rowLimit <= 0 ||
    typeof truncationHint !== "string" ||
    !truncationHint.trim()
  ) {
    throw new Error(tApp("queryFixed.280", { v0: context }));
  }
  return { truncated, rowLimit, truncationHint };
}

/**
 * The marker of one result made of several result packs: partial when any pack is partial. The
 * first partial pack gives the row cap; every distinct hint is kept.
 */
export function combineResultTruncation(
  packs: Partial<ResultTruncation>[]
): ResultTruncation | undefined {
  const partial = packs.filter((pack): pack is ResultTruncation => pack.truncated === true);
  if (partial.length === 0) return undefined;
  return {
    truncated: true,
    rowLimit: partial[0].rowLimit,
    truncationHint: [...new Set(partial.map((pack) => pack.truncationHint))].join(" "),
  };
}

export function parseQueryAnswerPayload(
  value: unknown,
  context = tApp("queryFixed.263")
): QueryAnswerPayload {
  if (!isRecord(value) || !Array.isArray(value.answer)) {
    throw new Error(tApp("queryFixed.261", { v0: (context) }));
  }
  // Validated here; the payload keeps the marker fields as the data engine sent them.
  parseResultTruncation(value, context);

  return value as QueryAnswerPayload;
}

export function parseQueryAnswerPayloads(
  value: unknown,
  context = tApp("queryFixed.263")
): QueryAnswerPayload[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(tApp("queryFixed.262", { v0: (context) }));
  }

  return value.map((item, index) => parseQueryAnswerPayload(item, `${context}[${index}]`));
}
