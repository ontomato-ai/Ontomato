import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../../../i18n";
import { appTextEn } from "../../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../../i18n/locales/en";
import { installModelAgentCatalog } from "../../../../../logging/model-agents";
import type { QueryRun } from "../../../../data-query/query-run-store";

const mocks = vi.hoisted(() => ({
  llmMessages: [] as Array<Array<{ role: string; content: string }>>,
  historicalRun: undefined as QueryRun | undefined,
}));

vi.mock("../../../../../core/skills/registry/manager", () => ({
  skillRegistryManager: { forDomain: vi.fn() },
}));

vi.mock("../../../../../core/skills/execution/runtime", () => ({
  skillRuntime: { execute: vi.fn() },
}));

vi.mock("../../../../../config/model-factory", () => ({
  createModel: async () => ({
    stream: async (messages: Array<{ role: string; content: string }>) => {
      mocks.llmMessages.push(messages);
      async function* gen() {
        yield { content: "Comparison complete" };
      }
      return gen();
    },
  }),
}));

vi.mock("../../../../../core/prompts/loader", () => ({
  renderPrompt: (key: string, vars: Record<string, string>) =>
    key.endsWith(".system")
      ? `SYS:${vars.methodologyContent || ""}`
      : `USER:${vars.userQuestion}\n${vars.dataContext}${vars.computedContext || ""}`,
}));

vi.mock("../../../../data-query/query-run-store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQueryRunBySource: async () => mocks.historicalRun,
}));

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  installModelAgentCatalog({
    roles: {
      analysis: { agentName: "Analysis", displayName: "Analysis" },
    } as any,
    otherDisplayNames: {},
    backendDisplayNames: {},
  });
});

beforeEach(() => {
  mocks.llmMessages = [];
  mocks.historicalRun = undefined;
});

describe("analysisNode multi-dataset evidence", () => {
  it("passes all current-query datasets with their subQuestion titles and fieldDisplayPlans", async () => {
    const { analysisNode } = await import("../analysis-node");
    const { QueryArtifactCache, createQueryArtifactRef } = await import("../../utils/query-artifact-cache");

    const cache = new QueryArtifactCache();
    const ref = createQueryArtifactRef({ threadId: "t-hot", requestSeq: 0 });
    cache.setQueryResult(ref, {
      datasets: [
        {
          id: "ds-1",
          name: "dataset_1",
          description: "A-class papers (2023-2026)",
          subQuestion: "A-class papers (2023-2026)",
          columns: ["paper_count"],
          data: [{ paper_count: 347 }],
          fieldDisplayPlan: { paper_count: { displayName: "Paper Count", kind: "none" } },
        },
        {
          id: "ds-2",
          name: "dataset_1",
          description: "A-class think tank outputs (2023-2026)",
          subQuestion: "A-class think tank outputs (2023-2026)",
          columns: ["thinktank_count"],
          data: [{ thinktank_count: 56 }],
          fieldDisplayPlan: { thinktank_count: { displayName: "Think Tank Count", kind: "none" } },
        },
      ],
    });

    await analysisNode(
      {
        threadId: "t-hot",
        userQuestion: "Compare papers and think tank outputs",
        queryArtifactRef: ref,
        plan: {
          nodes: ["query", "analysis"],
          steps: [{ type: "analysis", instruction: "Compare papers vs think tank outputs" }],
        },
        messages: [],
      } as any,
      { configurable: { queryArtifactCache: cache, requestSeq: 0 } }
    );

    expect(mocks.llmMessages).toHaveLength(1);
    const userPrompt = mocks.llmMessages[0].at(-1)!.content;
    expect(userPrompt).toContain('datasetTitle="A-class papers (2023-2026)"');
    expect(userPrompt).toContain('"paper_count":347');
    expect(userPrompt).toContain('datasetTitle="A-class think tank outputs (2023-2026)"');
    expect(userPrompt).toContain('"thinktank_count":56');
  });

  it("distinguishes multi-dataset hot cards that share identical column names via subQuestion", async () => {
    const { analysisNode } = await import("../analysis-node");
    const { QueryArtifactCache, createQueryArtifactRef } = await import("../../utils/query-artifact-cache");

    const cache = new QueryArtifactCache();
    const ref = createQueryArtifactRef({ threadId: "t-yoy", requestSeq: 0 });
    cache.setQueryResult(ref, {
      datasets: [
        {
          id: "ds-this-year",
          name: "dataset_1",
          description: "2026 YTD major projects",
          subQuestion: "2026 YTD major projects",
          columns: ["major_project_count"],
          data: [{ major_project_count: 3 }],
        },
        {
          id: "ds-last-year",
          name: "dataset_1",
          description: "2025 same-period major projects",
          subQuestion: "2025 same-period major projects",
          columns: ["major_project_count"],
          data: [{ major_project_count: 1 }],
        },
      ],
    });

    await analysisNode(
      {
        threadId: "t-yoy",
        userQuestion: "Compare this year vs last year",
        queryArtifactRef: ref,
        plan: {
          nodes: ["query", "analysis"],
          steps: [{ type: "analysis", instruction: "Compare 2026 YTD vs 2025 same period" }],
        },
        messages: [],
      } as any,
      { configurable: { queryArtifactCache: cache, requestSeq: 0 } }
    );

    const userPrompt = mocks.llmMessages[0].at(-1)!.content;
    expect(userPrompt).toContain('datasetTitle="2026 YTD major projects"');
    expect(userPrompt).toContain('"major_project_count":3');
    expect(userPrompt).toContain('datasetTitle="2025 same-period major projects"');
    expect(userPrompt).toContain('"major_project_count":1');
  });

  it("loads all datasets from a historical query run", async () => {
    const { analysisNode } = await import("../analysis-node");
    const { QueryArtifactCache } = await import("../../utils/query-artifact-cache");

    mocks.historicalRun = {
      id: "query:hist-1",
      status: "completed",
      sourceKind: "query_stage",
      sourceRef: "query",
      question: "Compare papers and think tank",
      datasetsPayload: [
        { subQuestion: "Papers", data: [{ paper_count: 347 }] },
        { subQuestion: "Think tank", data: [{ thinktank_count: 56 }] },
      ],
    } as unknown as QueryRun;

    const cache = new QueryArtifactCache();
    await analysisNode(
      {
        threadId: "t-hist",
        userQuestion: "Re-analyze previous results",
        historicalQueryRef: {
          threadId: "t-hist",
          requestSeq: 0,
          sourceKind: "query_stage",
          sourceRef: "query",
        },
        plan: {
          nodes: ["analysis"],
          steps: [{ type: "analysis", instruction: "Compare papers and think tank" }],
        },
        messages: [],
      } as any,
      { configurable: { queryArtifactCache: cache, requestSeq: 1 } }
    );

    const userPrompt = mocks.llmMessages[0].at(-1)!.content;
    expect(userPrompt).toContain('datasetTitle="Papers"');
    expect(userPrompt).toContain('"paper_count":347');
    expect(userPrompt).toContain('datasetTitle="Think tank"');
    expect(userPrompt).toContain('"thinktank_count":56');
  });
});
