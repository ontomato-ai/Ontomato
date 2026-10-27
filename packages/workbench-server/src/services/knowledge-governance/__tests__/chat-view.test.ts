import { expect, it } from "vitest";
import type { RuntimeMessage } from "@ontomato/contracts/agent-runtime-messages";
import { governanceChatMessages } from "../chat-view";

it("projects the same tool facts without exposing system instructions or model thinking", () => {
  const messages: RuntimeMessage[] = [
    { role: "system", content: "private instructions", timestamp: 0 },
    { role: "user", content: "Review", timestamp: 1 },
    {
      role: "assistant",
      api: "openai-completions",
      provider: "fixture",
      model: "fixture",
      timestamp: 2,
      stopReason: "toolUse",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      content: [
        { type: "thinking", thinking: "hidden reasoning" },
        { type: "text", text: "Reading" },
        {
          type: "toolCall",
          id: "c",
          name: "read_knowledge",
          arguments: { offset: 0 },
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "c",
      toolName: "read_knowledge",
      timestamp: 3,
      isError: false,
      content: [{ type: "text", text: "original" }],
    },
  ];
  const view = governanceChatMessages(messages);
  expect(JSON.stringify(view)).not.toContain("private instructions");
  expect(JSON.stringify(view)).not.toContain("hidden reasoning");
  expect(view[1]?.segments?.[1]).toMatchObject({
    type: "tool_call",
    toolCallId: "c",
    status: "done",
    isError: false,
    result: { content: [{ type: "text", text: "original" }] },
  });
  expect(
    governanceChatMessages(messages.slice(0, -1), [
      {
        toolCallId: "c",
        toolName: "read_knowledge",
        args: { offset: 0 },
        status: "completed",
        result: {
          content: [{ type: "text", text: "original" }],
          details: { artifactIds: [] },
        },
      },
    ]),
  ).toEqual(view);
});
