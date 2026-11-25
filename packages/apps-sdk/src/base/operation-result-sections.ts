import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type {
  PanelReadOperationRecordCell,
  PanelReadOperationResult,
  PanelReadOperationSection,
} from "@ontomato/contracts/panel-operations";

export type OperationCodeEditorLanguage = "python" | "text" | "html" | "json" | "markdown" | "javascript";

const CODE_EDITOR_LANGUAGE_ALIASES: Readonly<Record<string, OperationCodeEditorLanguage>> = {
  python: "python",
  py: "python",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  markdown: "markdown",
  md: "markdown",
  html: "html",
  text: "text",
  plaintext: "text",
};

/** Maps any section language identifier to a CodeEditor-supported language, falling back to plain text. */
export function resolveOperationCodeLanguage(language: string): OperationCodeEditorLanguage {
  return CODE_EDITOR_LANGUAGE_ALIASES[language.trim().toLowerCase()] ?? "text";
}

/** Formats one scalar record cell for tabular display without dropping booleans or zeros. */
export function formatOperationRecordCell(value: PanelReadOperationRecordCell | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Formats a JSON result value with consistent two-space indentation. */
export function formatOperationJson(value: RuntimeJsonValue): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

/** Returns the sections list when a read operation result carries multi-section output. */
export function operationResultSections(
  result: PanelReadOperationResult,
): readonly PanelReadOperationSection[] {
  return result.kind === "sections" ? result.sections : [];
}

/** Picks the first section ID for a multi-section result, or an empty string for other kinds. */
export function defaultOperationSectionId(result: PanelReadOperationResult): string {
  return result.kind === "sections" ? result.sections[0]?.id ?? "" : "";
}
