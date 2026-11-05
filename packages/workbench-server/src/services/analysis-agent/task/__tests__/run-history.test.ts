import { expect, it } from "vitest";
import { isCurrentAnalysisRun, planAnalysisRunUpdate } from "../run-history";

it("keeps late completion attributed to its old run without accepting it as the current writer", () => {
  const history = [{ id: "old", status: "running" as const }, { id: "new", status: "running" as const }];
  expect(isCurrentAnalysisRun(history, { runId: "old" })).toBe(false);
  expect(isCurrentAnalysisRun(history, { runId: "new" })).toBe(true);
  const update = planAnalysisRunUpdate(history, { runId: "old" }, { status: "failed", resultSummary: "late" })!;
  const next = history.map((run, index) => index === update.index ? { ...run, ...update.patch } : run);
  expect(next).toEqual([{ id: "old", status: "failed", resultSummary: "late" }, { id: "new", status: "running" }]);
});

it("keeps a terminal run monotonic while allowing its same-status completion to add facts", () => {
  const history = [{ id: "run", status: "completed" as const }];
  expect(planAnalysisRunUpdate(history, { runId: "run" }, { status: "failed" })).toBeUndefined();
  const update = planAnalysisRunUpdate(history, { runId: "run" }, { status: "completed", resultSummary: "saved" })!;
  expect({ ...history[update.index], ...update.patch }).toEqual({ id: "run", status: "completed", resultSummary: "saved" });
});
