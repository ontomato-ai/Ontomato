import { expect, it } from "vitest";
import { continuationMessage, splitContinuationMessage } from "../continuation-message";

it("separates generated context without removing any runtime input", () => {
  const message = continuationMessage("按学院拆分", 'Keep scope.\n{"sourceRunId":"run"}');
  expect(splitContinuationMessage(message)).toEqual({ text: "按学院拆分", context: 'Keep scope.\n{"sourceRunId":"run"}' });
  expect(message).toContain('"sourceRunId":"run"');
});
it("supports historical continuation messages and preserves ordinary user text", () => {
  expect(splitContinuationMessage("问题\n\nContinue from this answer using the referenced datasets.\n{}").text).toBe("问题");
  expect(splitContinuationMessage("普通问题\n\n第二段")).toEqual({ text: "普通问题\n\n第二段", context: "" });
});
