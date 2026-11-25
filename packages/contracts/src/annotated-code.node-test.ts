import test from "node:test";
import assert from "node:assert/strict";
import { annotatedCodeSchema, type AnnotatedCode } from "./annotated-code";
import { panelReadResultIdSchema, panelReadResultSchemas } from "./panel-operations";

test("annotatedCodeSchema accepts empty segments without code or summary", () => {
  const parsed = annotatedCodeSchema.parse({ segments: [] });
  assert.deepEqual(parsed, { segments: [] });
});

test("annotatedCodeSchema accepts nested children, structured detail refs, tones, and summary blocks", () => {
  const payload: AnnotatedCode = {
    code: "const rows = fetch(input);\nif (rows.length > 0) {\n  save(rows[0]);\n}",
    segments: [
      {
        id: "seg-1",
        kind: "read",
        kindLabel: "Read",
        title: "Fetch input rows",
        lineRange: { start: 1, end: 1 },
        tone: "info",
        note: "Reads matching records",
        details: [
          {
            label: "Input",
            parts: [
              { text: "Uses " },
              { text: "input", refKey: "input" },
              { text: " filter" },
            ],
          },
        ],
      },
      {
        id: "seg-2",
        kind: "branch",
        kindLabel: "Branch",
        title: "Guard non-empty result",
        lineRange: { start: 2, end: 4 },
        tone: "warning",
        children: [
          {
            id: "seg-2-1",
            kind: "write",
            kindLabel: "Write",
            title: "Persist first row",
            lineRange: { start: 3, end: 3 },
            tone: "success",
            children: [
              {
                id: "seg-2-1-1",
                kind: "detail",
                kindLabel: "Detail",
                title: "Deep nested step",
                lineRange: { start: 3, end: 3 },
              },
            ],
          },
        ],
      },
    ],
    summary: [
      {
        title: "Key operations",
        kind: "list",
        items: ["Reads input records", "Saves the first matching row"],
      },
      {
        title: "Caution",
        kind: "text",
        text: "Overwrites the existing record when present.",
        tone: "warning",
      },
    ],
  };

  const parsed = annotatedCodeSchema.parse(payload);
  assert.deepEqual(parsed, payload);
  assert.equal(panelReadResultIdSchema.parse("annotatedCode"), "annotatedCode");
  assert.deepEqual(panelReadResultSchemas.annotatedCode.parse(payload), payload);

  const withLanguage = annotatedCodeSchema.parse({ ...payload, language: "python" });
  assert.equal(withLanguage.language, "python");
});

test("annotatedCodeSchema rejects invalid line ranges, missing required fields, bad tones, bad refs, and extra keys", () => {
  assert.throws(() => annotatedCodeSchema.parse({}));
  assert.throws(() => annotatedCodeSchema.parse({ segments: [], extra: true }));
  assert.throws(() => annotatedCodeSchema.parse({ segments: [], language: "" }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [{
      id: "",
      kind: "read",
      kindLabel: "Read",
      title: "Bad id",
      lineRange: { start: 1, end: 1 },
    }],
  }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [{
      id: "seg-1",
      kind: "read",
      kindLabel: "Read",
      title: "Zero start line",
      lineRange: { start: 0, end: 1 },
    }],
  }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [{
      id: "seg-1",
      kind: "read",
      kindLabel: "Read",
      title: "Inverted range",
      lineRange: { start: 5, end: 2 },
    }],
  }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [{
      id: "seg-1",
      kind: "read",
      kindLabel: "Read",
      title: "Fractional line",
      lineRange: { start: 1.5, end: 2 },
    }],
  }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [{
      id: "seg-1",
      kind: "read",
      kindLabel: "Read",
      title: "Unknown tone",
      lineRange: { start: 1, end: 1 },
      tone: "purple",
    }],
  }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [{
      id: "seg-1",
      kind: "read",
      kindLabel: "Read",
      title: "Empty detail refKey",
      lineRange: { start: 1, end: 1 },
      details: [{ label: "Param", parts: [{ text: "x", refKey: "" }] }],
    }],
  }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [{
      id: "seg-1",
      kind: "read",
      kindLabel: "Read",
      title: "Empty detail parts",
      lineRange: { start: 1, end: 1 },
      details: [{ label: "Param", parts: [] }],
    }],
  }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [],
    summary: [{ title: "Bad kind", kind: "table", items: [] }],
  }));

  assert.throws(() => annotatedCodeSchema.parse({
    segments: [],
    summary: [{ title: "Bad tone", kind: "text", text: "Hi", tone: "danger" }],
  }));
});
