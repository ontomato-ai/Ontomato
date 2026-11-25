import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLocalDateStamp,
  PENDING_GRAPH_EDGE_ID,
  resolveGraphExportFilename,
} from "../object-graph-export.ts";

test("formatLocalDateStamp formats local calendar dates as YYYY-MM-DD", () => {
  const sample = new Date(2026, 10, 5, 14, 30, 0);
  assert.equal(formatLocalDateStamp(sample), "2026-11-05");
});

test("resolveGraphExportFilename expands {date}, normalizes .png suffix, and falls back to projection name", () => {
  const sample = new Date(2026, 10, 25, 9, 0, 0);
  assert.equal(resolveGraphExportFilename(undefined, "Ontology Graph", sample), "Ontology Graph.png");
  assert.equal(resolveGraphExportFilename("   ", "Model", sample), "Model.png");
  assert.equal(resolveGraphExportFilename("ontology-graph-{date}.png", "Model", sample), "ontology-graph-2026-11-25.png");
  assert.equal(resolveGraphExportFilename("ontology-graph-{date}", "Model", sample), "ontology-graph-2026-11-25.png");
  assert.equal(resolveGraphExportFilename("snapshot.PNG", "Model", sample), "snapshot.PNG");
  assert.equal(typeof PENDING_GRAPH_EDGE_ID, "string");
});
