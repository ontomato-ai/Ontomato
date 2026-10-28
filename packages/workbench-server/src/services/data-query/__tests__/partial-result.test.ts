import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ResultTruncation } from "@ontomato/contracts/query-execution";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installWorkbenchProduct } from "../../../product/installed";
import type { WorkbenchProduct } from "../../../product/types";

/**
 * A partial result from the data engine (`truncated` + `rowLimit` + `truncationHint`) keeps its
 * marker from the wire through dataset creation, model inputs and the analysis replay, and its zero
 * rows are never reported as "no data". Doubles: the model and its agent name, prompt rendering,
 * and the backend GET boundary of saved MetricView snapshots.
 */
const io = vi.hoisted(() => ({
  prompts: [] as string[],
  cardBody: "" as string,
}));

vi.mock("../../../config/model-factory", () => ({
  createModel: async () => ({
    invoke: async () => ({ content: "{}" }),
    stream: async (prompt: string) => {
      io.prompts.push(prompt);
      return (async function* () {
        yield { content: "Only the processed part was read." };
      })();
    },
  }),
}));

vi.mock("../../../logging/model-agents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  modelAgentName: (key: string) => key,
}));

vi.mock("../../../core/prompts/loader", () => ({
  renderPrompt: (name: string, vars: Record<string, unknown>) =>
    JSON.stringify({ name, vars }),
}));

vi.mock("../../charts/chart-generator", () => ({
  generateChartsFromCandidates: vi.fn(),
}));
vi.mock("../../analysis-agent/dimension/skill-executor", () => ({
  analysisSkillExecutor: { executeMultipleSkills: vi.fn() },
}));

vi.mock("../../../utils/backend-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  backendGet: async () => ({ text: io.cardBody }),
}));

import type { Dataset } from "../adapter";

// Several subjects translate fixed text at import time, so they load after i18n is configured.
const load = async () => ({
  ...(await import("../protocol")),
  ...(await import("../../data-retrieval/projection")),
  ...(await import("../hot-data/hot-data-fetcher")),
  ...(await import("../conclusion")),
  ...(await import("../../../utils/model-data-view")),
  ...(await import("../../analysis-agent/dimension/abc-replay")),
  ...(await import("../../analysis-agent/runtime/query-result")),
  ...(await import("../../analysis-agent/dimension/report-generator")),
  ...(await import("../../analysis-agent/dimension/summary")),
});
let m: Awaited<ReturnType<typeof load>>;

const MARKER: ResultTruncation = {
  truncated: true,
  rowLimit: 100000,
  truncationHint: "Intermediate rows reached the processing cap.",
};

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en",
    languageSwitchEnabled: false,
    appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  installWorkbenchProduct({
    groupColumnHeader: "group",
    primaryDimensionHeaders: { exact: [], contains: [] },
  } as unknown as WorkbenchProduct);
  m = await load();
});

beforeEach(() => {
  io.prompts = [];
});

describe("saved report completeness", () => {
  it("writes a fixed notice into dimension reports and summaries even if the model omits it", async () => {
    const generator = new m.ReportGenerator();
    const dimension = {
      dimensionName: "Sites",
      dimensionValue: "all",
      datasetSchema: "",
      summarizerPrompt: "summarize",
      evidence: [
        {
          questionId: "q",
          questionText: "Sites",
          status: "completed",
          data: [],
          dataCount: 0,
          ...MARKER,
        },
      ],
    } as never;
    const summary = {
      dimensionReports: [],
      originalQuestion: "Sites",
      conclusionMakerPrompt: "summarize",
      truncation: MARKER,
    };
    expect(
      (await generator.generateDimensionReport(dimension)).report,
    ).toContain(MARKER.truncationHint);
    expect(
      (await generator.generateMultiDimensionSummary(summary)).summary,
    ).toContain(MARKER.truncationHint);
    for (const stream of [
      generator.generateDimensionReportStream(dimension),
      generator.generateMultiDimensionSummaryStream(summary),
    ]) {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(chunks.join("")).toContain(MARKER.truncationHint);
    }
    expect(
      (
        await generator.generateMultiDimensionSummary({
          ...summary,
          truncation: undefined,
        })
      ).summary,
    ).not.toContain(MARKER.truncationHint);
  });

  it("summary evidence keeps a partial empty source even when charts are disabled", async () => {
    const sections: { markdown?: string }[] = [];
    const result = await m.runSummaryStage(
      {
        userQuestion: "Sites",
        enabledVisualizationSkillIds: [],
        enabledSkillIds: [],
        conclusionMakerPrompt: "summarize",
      } as never,
      {
        start: () => "activity",
        settle: () => {},
        section: (value: { markdown?: string }) => sections.push(value),
        current: () => ({ sections: [] }),
      } as never,
      {
        dimensionReports: [
          {
            success: true,
            dimensionName: "Sites",
            dimensionValue: "all",
            report: "Report",
          },
        ],
        plannedDimensions: [
          {
            subQuestions: [
              {
                id: "q",
                subQuestion: "Sites",
                datasets: [{ id: "d", data: [], ...MARKER }],
              },
            ],
          },
        ],
      } as never,
    );
    expect(result.errors).toEqual([]);
    expect(sections.at(-1)?.markdown).toContain(MARKER.truncationHint);
  });
});

describe("answer protocol", () => {
  it("accepts row arrays and rejects a non-array answer or an empty pack list", () => {
    expect(m.parseQueryAnswerPayload({ answer: [1] }).answer).toEqual([1]);
    expect(() => m.parseQueryAnswerPayload({ answer: "no" })).toThrow();
    expect(() => m.parseQueryAnswerPayloads([])).toThrow();
  });
  it("keeps a partial pack's marker and leaves complete packs unmarked", () => {
    const [partial, complete] = m.parseQueryAnswerPayloads([
      { answer: [{ a: 1 }], ...MARKER },
      { answer: [{ a: 2 }] },
    ]);
    expect(partial).toMatchObject(MARKER);
    expect(complete).not.toHaveProperty("truncated");
    expect(m.combineResultTruncation([partial!, complete!])).toEqual(MARKER);
    expect(m.combineResultTruncation([complete!])).toBeUndefined();
  });

  it("rejects an incomplete or contradictory marker instead of guessing", () => {
    for (const marker of [
      { truncated: false },
      { truncated: true, rowLimit: 100000 },
      { truncated: true, truncationHint: "cap" },
      { rowLimit: 100000, truncationHint: "cap" },
      { truncated: true, rowLimit: 0, truncationHint: "cap" },
    ]) {
      expect(() =>
        m.parseQueryAnswerPayload({ answer: [], ...marker }),
      ).toThrow(/partial result/);
    }
  });
});

describe("datasets keep the marker where they are created", () => {
  it("runtime datasets retain source completeness, including zero rows", () => {
    const payload = {
      title: "Sites",
      question: "Sites",
      columns: [],
      rows: [],
      recipe: { kind: "dsl", dsl: {} },
      outKeyRefs: [],
      truncation: MARKER,
    } as unknown as import("@ontomato/contracts/data-retrieval").DatasetPayload;
    const ref = {
      retrievalId: "r",
      runtimeSessionId: "s",
      runtimeRunId: "run",
    };
    const dataset = m.projectDataset("artifact", payload, ref);
    expect(dataset).toMatchObject({ id: "artifact", data: [], ...MARKER });
    expect(
      m.projectDataset("complete", { ...payload, truncation: null }, ref),
    ).not.toHaveProperty("truncated");
  });

  it("saved MetricView snapshot: a marked result.data entry marks the card's dataset", async () => {
    io.cardBody = JSON.stringify({
      data: [{ answer: [{ site: "A" }], ...MARKER }],
      abcProgram: {
        title: "Sites",
        code: "print(1)",
        outKeyRefs: [{ key: "k" }],
        parameters: [],
      },
    });
    const [card] = await m.fetchHotCards({
      cards: [{ atomicAsk: "Sites", url: "http://engine/metricView/getData" }],
      question: "Sites",
    });
    expect(card!.dataset).toMatchObject(MARKER);
  });
});

describe("model inputs", () => {
  it("the model data view of partial rows is never complete and carries the marker", () => {
    expect(m.buildModelDataView([{ a: 1 }], { truncation: MARKER })).toEqual({
      totalRows: 1,
      includedRows: 1,
      omittedRows: 0,
      isComplete: false,
      headRows: [{ a: 1 }],
      tailRows: [],
      ...MARKER,
    });
    const complete = m.buildModelDataView([{ a: 1 }], { truncation: {} });
    expect(complete.isComplete).toBe(true);
    expect(complete).not.toHaveProperty("truncated");
  });

  it("a partial result with zero rows is not concluded as 'no data'", async () => {
    const dataset: Dataset = {
      id: "d1",
      name: "sites",
      description: "Sites",
      columns: [],
      data: [],
      ...MARKER,
    };
    const content = await m.streamConclusion(
      "How many sites?",
      [dataset],
      "",
      () => {},
    );

    expect(content).not.toContain(en["query.conclusion.noDataFound"] as string);
    expect(io.prompts).toHaveLength(1);
    expect(io.prompts[0]).toContain(MARKER.truncationHint);
  });

  it("analysis evidence keeps a partial dataset without rows and drops a complete empty one", () => {
    const entries = m.expandQueryResultDatasetEntries({
      datasets: [
        {
          id: "p",
          name: "p",
          description: "p",
          columns: [],
          data: [],
          ...MARKER,
        },
        { id: "c", name: "c", description: "c", columns: [], data: [] },
      ],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ dataCount: 0, ...MARKER });
  });
});

describe("analysis replay of a saved ABC plan", () => {
  let replayRootDir: string;
  beforeAll(async () => {
    replayRootDir = await mkdtemp(path.join(tmpdir(), "partial-replay-"));
  });
  afterAll(async () => {
    await rm(replayRootDir, { recursive: true, force: true });
  });

  it("completes a partial empty step and marks the after-calculation built on it", async () => {
    const result = await m.executeAbcReplayPlan({
      plan: {
        version: 1,
        source: "streamchatV1-final",
        queryCount: 1,
        rawChunkCount: 1,
        steps: [
          { index: 0, subQuestion: "Matching sites", dsl: { from: "Site" } },
        ],
        afterCalculations: [
          {
            index: 1,
            subQuestion: "Site count",
            code: "print(open('/old/0.json').read())",
            dependencySubQueryIndexes: [0],
            pathBindings: [
              { subQueryIndex: 0, originalFilePath: "/old/0.json" },
            ],
          },
        ],
      },
      question: {
        id: "q1",
        dimensionId: "d1",
        dimensionName: "Town",
        dimensionValue: "all",
        subQuestion: "Sites",
        originalQuestion: "Sites",
      },
      executeDsl: async (params) => ({
        questionId: params.questionId,
        dimensionId: params.dimensionId,
        dimensionName: params.dimensionName,
        dimensionValue: params.dimensionValue,
        subQuestion: params.subQuestion,
        status: "completed",
        data: [],
        datasets: [
          {
            id: "s",
            name: "s",
            description: "s",
            columns: [],
            data: [],
            ...MARKER,
          },
        ],
      }),
      replayRootDir,
      replayId: "r1",
      pythonRunner: async () => ({
        ok: true,
        stdout: JSON.stringify({ answer: [{ count: 0 }] }),
        stderr: "",
      }),
    });

    expect(result.status).toBe("completed");
    expect(result.error).toBeUndefined();
    expect(result.datasets?.map((dataset) => dataset.truncated)).toEqual([
      true,
      true,
    ]);
    expect(result.datasets?.[1]).toMatchObject({
      data: [{ count: 0 }],
      ...MARKER,
    });
  });
});
