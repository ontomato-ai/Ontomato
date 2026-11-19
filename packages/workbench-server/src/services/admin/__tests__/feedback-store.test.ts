import { beforeEach, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    async run() {
      return { messages: [] };
    }
  },
}));

import { feedbackTurnKey, listFeedback } from "../feedback-store";

const thread = "11111111-1111-4111-8111-111111111111";

it("uses a target that is itself a turn", () => {
  expect(feedbackTurnKey({ targetId: "turn.thread.2", threadId: thread, requestSeq: 1 })).toBe("turn.thread.2");
});

it("builds the key from the conversation and its turn number", () => {
  expect(feedbackTurnKey({ threadId: thread, requestSeq: 3 })).toBe(`turn.${thread}.3`);
});

it("is empty when the record names no turn", () => {
  expect(feedbackTurnKey({ targetId: "target", threadId: thread })).toBe("");
});

beforeEach(() => query.mockReset());

it("reads every record unpaged and takes turnKey from the joined turn", async () => {
  query.mockResolvedValue({
    rows: [{
      id: "feedback-1",
      session_id: thread,
      run_id: "22222222-2222-4222-8222-222222222222",
      target_id: "33333333-3333-4333-8333-333333333333",
      rating: "like",
      text: "",
      updated_at: "2026-11-19T08:00:00.000Z",
      owner_id: "user-1",
      domain_id: "domain-1",
      kind: "regular",
      request_seq: 9,
      total: 1,
    }],
  });

  const page = await listFeedback({ domainId: "domain-1", all: true });

  expect(page.records[0]?.turnKey).toBe(`turn.${thread}.9`);
  const [sql, params] = query.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain("t.request_seq");
  expect(sql).not.toContain("LIMIT");
  expect(params).toHaveLength(8);
});
