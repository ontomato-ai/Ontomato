import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";

const { query, runMessages, assertPermission } = vi.hoisted(() => ({
  query: vi.fn(),
  runMessages: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query }),
  qualifiedTable: (name: string) => name,
}));

vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    async run(runId: string) {
      return { messages: runMessages(runId) };
    }
  },
}));

vi.mock("../../../identity/installed", () => ({
  assertPermission,
}));

import { createFeedbackReadAdapter } from "../feedback-panel-reads";

const owner = { domainId: "domain-1", userId: "reader-1" };
const viewer = { token: "viewer-token", locale: "en" };
const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const session1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const run1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const target1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function feedbackDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: id1,
    session_id: session1,
    run_id: run1,
    target_id: target1,
    rating: "like",
    text: "Helpful answer",
    updated_at: "2026-11-20T08:00:00.000Z",
    owner_id: "user-1",
    domain_id: "domain-1",
    kind: "regular",
    request_seq: 4,
    total: 2,
    ...overrides,
  };
}

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: true,
    appTextLocale: "en",
    packs: {
      en: { messages: en, ...enLocaleMeta },
      "zh-CN": {
        ...enLocaleMeta,
        messages: {
          ...en,
          "panels.feedback.all": "全部",
          "api.feedback.sources.qa": "问答",
          "api.feedback.sources.analysis_task": "分析任务",
          "api.feedback.ratings.like": "点赞",
          "api.feedback.ratings.dislike": "点踩",
        } as typeof en,
      },
    },
  });
});

beforeEach(() => {
  query.mockReset();
  runMessages.mockReset();
  assertPermission.mockReset();
  assertPermission.mockResolvedValue(undefined);
  runMessages.mockReturnValue([
    { id: "msg-user", message: { role: "user", content: "Total sales?" } },
    { id: target1, message: { role: "assistant", content: "Total sales are 100." } },
  ]);
});

it("queries feedback with search, treats 'all' as unfiltered, pages by cursor/size, and localizes labels", async () => {
  query.mockResolvedValueOnce({ rows: [feedbackDbRow({ total: 3 })] });

  const reads = createFeedbackReadAdapter(owner, viewer);
  const result = panelReadResultSchemas.panelRecordQuery.parse(await reads.query({
    search: "Helpful",
    sourceType: "all",
    rating: "like",
    cursor: "1",
    size: 1,
  }));

  expect(assertPermission).toHaveBeenCalledWith(viewer, ["user-feedback"]);
  const [, params] = query.mock.calls[0] as [string, unknown[]];
  expect(params).toEqual([
    "domain-1",
    null,
    "like",
    null,
    "Helpful",
    null,
    null,
    null,
    null,
    1,
    1,
  ]);
  expect(result).toEqual({
    rows: [
      {
        primaryKey: id1,
        label: "Helpful answer",
        subtitle: "Query · Like",
        fieldLabels: {
          sourceType: "Source",
          rating: "Rating",
          userId: "User",
          userInput: "Question",
          assistantOutput: "Answer",
          feedbackText: "Comment",
          turnKey: "Turn key",
          updatedAt: "Last updated",
        },
        fields: {
          sourceType: "Query",
          rating: "Like",
          userId: "user-1",
          userInput: "Total sales?",
          assistantOutput: "Total sales are 100.",
          feedbackText: "Helpful answer",
          turnKey: `turn.${session1}.4`,
          updatedAt: "2026-11-20T08:00:00.000Z",
        },
      },
    ],
    nextCursor: "2",
    total: 3,
  });

  query.mockResolvedValueOnce({ rows: [feedbackDbRow({ id: id2, total: 2 })] });
  const lastPage = await reads.query({ cursor: "1", size: 1 });
  expect(lastPage.nextCursor).toBeUndefined();
});

it("counts by sourceType or rating in fixed order while applying search and only the other filter", async () => {
  query.mockResolvedValueOnce({
    rows: [
      { key: "analysis_task", count: "2" },
      { key: "qa", count: "5" },
    ],
  });

  const reads = createFeedbackReadAdapter(owner, { token: "viewer-token", locale: "zh-CN" });
  const bySource = panelReadResultSchemas.panelGroupCounts.parse(await reads.counts({
    by: "sourceType",
    search: "chart",
    sourceType: "qa",
    rating: "dislike",
  }));

  expect(bySource).toEqual([
    { key: "all", label: "全部", count: 7 },
    { key: "qa", label: "问答", count: 5 },
    { key: "analysis_task", label: "分析任务", count: 2 },
  ]);
  const [, sourceParams] = query.mock.calls[0] as [string, unknown[]];
  expect(sourceParams[2]).toBe("dislike");
  expect(sourceParams[4]).toBe("chart");
  expect(sourceParams[5]).toBeNull();

  query.mockResolvedValueOnce({
    rows: [{ key: "dislike", count: "1" }],
  });
  const byRating = panelReadResultSchemas.panelGroupCounts.parse(await reads.counts({
    by: "rating",
    sourceType: "analysis_task",
    rating: "like",
  }));

  expect(byRating).toEqual([
    { key: "all", label: "全部", count: 1 },
    { key: "like", label: "点赞", count: 0 },
    { key: "dislike", label: "点踩", count: 1 },
  ]);
  const [, ratingParams] = query.mock.calls[1] as [string, unknown[]];
  expect(ratingParams[2]).toBeNull();
  expect(ratingParams[5]).toBe("analysis_task");
});

it("reads one feedback record by UUID and enforces the user-feedback permission", async () => {
  const reads = createFeedbackReadAdapter(owner, viewer);
  await expect(reads.record("not-a-uuid")).rejects.toMatchObject({
    status: 400,
    code: "INVALID_REQUEST",
  });

  query.mockResolvedValueOnce({ rows: [] });
  await expect(reads.record(id1)).rejects.toMatchObject({
    status: 404,
    code: "NOT_FOUND",
  });

  query.mockResolvedValueOnce({ rows: [feedbackDbRow({ total: 1 })] });
  const single = panelReadResultSchemas.panelRecord.parse(await reads.record(id1));
  expect(single.primaryKey).toBe(id1);

  assertPermission.mockRejectedValueOnce(new HttpError(403, "Forbidden", "PERMISSION_DENIED"));
  await expect(reads.query({})).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
});
