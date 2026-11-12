import { expect, it } from "vitest";
import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
import { answerMessageId } from "../answer";

const assistant = (content: unknown[], extra: Record<string, unknown> = {}) =>
  ({ role: "assistant", content, stopReason: "stop", ...extra }) as unknown as RuntimeMessage;
const text = (value: string) => ({ type: "text", text: value });
const call = { type: "toolCall", id: "call", name: "bash", arguments: {} };

it("names the last model message of a normal stop, and nothing else", () => {
  const progress = { id: "progress", message: assistant([text("Checking the data"), call], { stopReason: "toolUse" }) };
  const final = { id: "final", message: assistant([{ type: "thinking", thinking: "done" }, text("Answer")]) };
  expect(answerMessageId("stop", [progress, final])).toBe("final");
  // A last message without text or with a tool call has no answer; an earlier message never stands in.
  expect(answerMessageId("stop", [final, { id: "empty", message: assistant([text("  ")]) }])).toBeNull();
  expect(answerMessageId("stop", [final, { id: "calls", message: assistant([text("Next"), call]) }])).toBeNull();
  // Runtime-originated notices are not model messages.
  expect(answerMessageId("stop", [final, { id: "notice", message: assistant([], { origin: "runtime" }) }])).toBe("final");
  for (const reason of ["length", "error", "aborted", "toolUse", null] as const)
    expect(answerMessageId(reason, [final])).toBeNull();
});
