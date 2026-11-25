import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultOperationSectionId,
  formatOperationJson,
  formatOperationRecordCell,
  operationResultSections,
  resolveOperationCodeLanguage,
} from "../operation-result-sections.ts";

test("maps section code languages safely with plain-text fallback", () => {
  assert.equal(resolveOperationCodeLanguage("javascript"), "javascript");
  assert.equal(resolveOperationCodeLanguage("JS"), "javascript");
  assert.equal(resolveOperationCodeLanguage("json"), "json");
  assert.equal(resolveOperationCodeLanguage("python"), "python");
  assert.equal(resolveOperationCodeLanguage("sql"), "text");
});

test("formats scalar record cells without dropping falsy values", () => {
  assert.equal(formatOperationRecordCell(null), "");
  assert.equal(formatOperationRecordCell(undefined), "");
  assert.equal(formatOperationRecordCell(false), "false");
  assert.equal(formatOperationRecordCell(true), "true");
  assert.equal(formatOperationRecordCell(0), "0");
  assert.equal(formatOperationRecordCell("alpha"), "alpha");
});

test("formats JSON values cleanly with two-space indentation", () => {
  assert.equal(formatOperationJson({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(formatOperationJson(null), "null");
});

test("extracts sections and picks the first section id for multi-section read results", () => {
  const multi = {
    kind: "sections",
    sections: [
      { id: "table", label: "Data table", kind: "records", columns: [], rows: [] },
      { id: "code", label: "Query", kind: "code", language: "javascript", content: "x()" },
      { id: "raw", label: "Raw JSON", kind: "json", value: { ok: true } },
    ],
  };
  assert.equal(operationResultSections(multi).length, 3);
  assert.equal(defaultOperationSectionId(multi), "table");

  const markdown = { kind: "markdown", markdown: "hello" };
  assert.deepEqual(operationResultSections(markdown), []);
  assert.equal(defaultOperationSectionId(markdown), "");
});
