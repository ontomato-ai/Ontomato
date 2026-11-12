import { describe, expect, it } from "vitest";
import { recentUserMessages } from "../user-quotes";

describe("host user quotes", () => {
  it("keeps the last ten user messages in order and includes the current one", () => {
    const previous = Array.from({ length: 12 }, (_, index) => ({
      runId: `run-${index}`,
      message: {
        role: "user",
        content: `user-${index + 1}`,
        timestamp: index + 1,
      },
    }));
    const messages = [
      ...previous,
      {
        runId: "assistant-run",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "answer" }],
          timestamp: 0,
        },
      },
      {
        runId: "current-run",
        message: { role: "user", content: "stale copy", timestamp: 13 },
      },
    ];

    expect(
      recentUserMessages(messages, "current-run", "current question", 13),
    ).toEqual([
      "user-4",
      "user-5",
      "user-6",
      "user-7",
      "user-8",
      "user-9",
      "user-10",
      "user-11",
      "user-12",
      "current question",
    ]);
  });

  it("keeps text parts from structured user content", () => {
    expect(
      recentUserMessages(
        [
          {
            runId: "previous",
            message: {
              role: "user",
              content: [
                { type: "text", text: "first line" },
                { type: "text", text: "second line" },
                { type: "image", data: "a", mimeType: "image/png" },
              ],
              timestamp: 1,
            },
          },
        ],
        "current",
        "current",
        2,
      ),
    ).toEqual(["first line\nsecond line", "current"]);
  });
});


it("keeps pending notifications and the current agent input out of user quotes", () => {
  const messages = [
    { runId: "earlier", message: { role: "user", content: "The user's actual request", timestamp: 1 } },
    { runId: null, message: { role: "notification", content: "An agent's assumption", timestamp: 2 } },
  ];
  expect(recentUserMessages(messages,"current",null,3)).toEqual(["The user's actual request"]);
});
