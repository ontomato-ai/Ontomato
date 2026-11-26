import { beforeAll, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../../../i18n";
import { appTextEn } from "../../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../../i18n/locales/en";
import type { QueryRun } from "../../../../data-query/query-run-store";

/**
 * A saved partial result with zero rows stays a result: the history artifacts keep it with its
 * marker, a later analysis can reuse it as historical data, and the planner history names it as
 * partial instead of an empty answer. Double: the query run store.
 */
const MARKER = {
  truncated: true as const,
  rowLimit: 100000,
  truncationHint: "Intermediate rows reached the processing cap.",
};
const PARTIAL_RUN = {
  id: "run-1",
  status: "completed",
  sourceRef: "stage",
  question: "Matching sites",
  datasetsPayload: [{ subQuestion: "Matching sites", data: [], ...MARKER }],
} as unknown as QueryRun;
const EMPTY_RUN = {
  ...PARTIAL_RUN,
  datasetsPayload: [{ subQuestion: "Matching sites", data: [] }],
} as unknown as QueryRun;

const store = vi.hoisted(() => ({ run: undefined as unknown }));
vi.mock("../../../../data-query/query-run-store", () => ({
  getQueryRunBySource: async () => store.run,
  getPrimaryQueryRun: async () => store.run,
}));
vi.mock("../../../../../infrastructure/connection", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCheckpointer: () => ({ verifyThreadAccess: async () => {}, getThreadMessages: async () => [{ role: "user", content: "Sites" }] }),
}));

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
});

const ref = { threadId: "t1", requestSeq: 1, sourceKind: "k", sourceRef: "stage" } as never;

describe("a saved partial result without rows", () => {
  it("the server data download preserves the marker inside the file; complete data stays CSV", async () => {
    const { getThreadDataDownload } = await import("../../../thread-service");
    store.run = PARTIAL_RUN;
    const partial = await getThreadDataDownload("thread", 0, "user", "domain");
    expect(partial.fileName).toMatch(/\.json$/);
    expect(partial.contentType).toContain("application/json");
    expect(JSON.parse(partial.body)).toEqual({ answer: [], ...MARKER });
    store.run = { ...EMPTY_RUN, datasetsPayload: [{ data: [{ count: 3 }] }] };
    const complete = await getThreadDataDownload("thread", 0, "user", "domain");
    expect(complete.fileName).toMatch(/\.csv$/);
    expect(complete.body).toContain("count");
    expect(complete.body).not.toContain("truncated");
  });
  it("history artifacts keep it with its marker; a complete empty dataset is still dropped", async () => {
    const { extractDatasetsFromQueryRun } = await import("../../../../data-query/query-run-artifacts");
    expect(extractDatasetsFromQueryRun(PARTIAL_RUN)).toEqual([
      expect.objectContaining({ title: "Matching sites", rows: [], ...MARKER }),
    ]);
    expect(extractDatasetsFromQueryRun(EMPTY_RUN)).toEqual([]);
  });

  it("is reusable historical analysis data that keeps its marker and all datasets", async () => {
    const { hasUsableQueryRun, resolveAnalysisData } = await import("../query-artifact-cache");
    expect(hasUsableQueryRun(PARTIAL_RUN)).toBe(true);
    expect(hasUsableQueryRun(EMPTY_RUN)).toBe(false);

    store.run = PARTIAL_RUN;
    expect(await resolveAnalysisData({ historicalQueryRef: ref } as never)).toEqual({
      datasets: [
        {
          title: "Matching sites",
          data: [],
          fieldDisplayPlan: undefined,
          truncation: MARKER,
        },
      ],
      source: "historical",
    });
    store.run = EMPTY_RUN;
    expect(await resolveAnalysisData({ historicalQueryRef: ref } as never)).toBeUndefined();

    const multiRun = {
      ...PARTIAL_RUN,
      datasetsPayload: [
        { subQuestion: "Papers", data: [{ paper_count: 347 }] },
        { subQuestion: "Think tank", data: [{ thinktank_count: 56 }] },
      ],
    } as unknown as QueryRun;
    expect(hasUsableQueryRun(multiRun)).toBe(true);
    store.run = multiRun;
    expect(await resolveAnalysisData({ historicalQueryRef: ref } as never)).toEqual({
      datasets: [
        {
          title: "Papers",
          data: [{ paper_count: 347 }],
          fieldDisplayPlan: undefined,
          truncation: undefined,
        },
        {
          title: "Think tank",
          data: [{ thinktank_count: 56 }],
          fieldDisplayPlan: undefined,
          truncation: undefined,
        },
      ],
      source: "historical",
    });
  });
});
