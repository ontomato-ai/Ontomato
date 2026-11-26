import { describe, expect, it, vi } from "vitest";
import { configureI18n } from "../../../../../i18n";
import { appTextEn } from "../../../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../../../i18n/locales/en";
import { installNoDataVisualization } from "../visualization-no-data";

configureI18n({
  defaultLocale: "en",
  languageSwitchEnabled: false,
  appTextLocale: "en",
  packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
});
installNoDataVisualization(null);

vi.mock("../../../../charts/chart-generator", () => ({
  generateChartsFromCandidates: vi.fn(),
  partialSourceNoticeHtml: (source: string) => `<div>partial notice of ${source}</div>`,
}));

vi.mock("../../utils/data-resolver", () => ({
  resolveVisualizationData: vi.fn().mockResolvedValue({
    success: true,
    data: [{ count: 1 }],
    source: "mock",
  }),
}));

vi.mock("../../utils/query-artifact-cache", () => ({
  createRuntimeArtifactRef: vi.fn(),
  getQueryArtifactCache: vi.fn().mockReturnValue(null),
  resolveAnalysisData: vi.fn().mockResolvedValue(null),
}));

describe("visualizationNode", () => {
  it("uses diagnostic message as error when chart generation produces no charts", async () => {
    const { visualizationNode } = await import("../visualization-node");
    const { generateChartsFromCandidates } = await import("../../../../charts/chart-generator");
    vi.mocked(generateChartsFromCandidates).mockResolvedValueOnce({
      charts: [],
      diagnostics: [
        {
          scopeId: "scope-1",
          reason: "invalid_plan",
          message: "Field 'service_count' bound to yField does not exist in data (existing fields: service_type, count)",
          severity: "info",
        },
      ],
    });

    const state: any = {
      userQuestion: "Count by type",
      plan: {
        steps: [{ type: "visualization", instruction: "Count by type" }],
      },
    };

    const result = await visualizationNode(state, {
      configurable: { domainId: "domain-1", requestSeq: 1 },
    });

    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toBe(
      "Field 'service_count' bound to yField does not exist in data (existing fields: service_type, count)"
    );
  });

  it("shows the source's partial notice, not 'no data', for a partial result without rows", async () => {
    const { visualizationNode } = await import("../visualization-node");
    const cache = await import("../../utils/query-artifact-cache");
    const { generateChartsFromCandidates } = await import("../../../../charts/chart-generator");
    const results: any[] = [];
    vi.mocked(cache.getQueryArtifactCache).mockReturnValueOnce({
      setVisualizationResult: (_ref: string, value: unknown) => results.push(value),
    } as any);
    vi.mocked(cache.resolveAnalysisData).mockResolvedValueOnce({
      datasets: [
        {
          data: [],
          truncation: {
            truncated: true,
            rowLimit: 100000,
            truncationHint: "Intermediate rows reached the processing cap.",
          },
        },
      ],
      source: "historical",
    });
    vi.mocked(generateChartsFromCandidates).mockClear();

    await visualizationNode(
      {
        userQuestion: "Count by type",
        threadId: "t1",
        plan: { steps: [{ type: "visualization", instruction: "Count by type" }] },
      } as any,
      { configurable: { domainId: "domain-1", requestSeq: 1 } }
    );

    expect(generateChartsFromCandidates).not.toHaveBeenCalled();
    expect(results[0].result).toEqual({
      html: "<div>partial notice of Count by type</div>",
      chartType: "none",
      title: en["query.display.emptyPartial"],
    });
    expect(results[0].thinking).toContain(
      "a 100000-row cap was reached, so this may not cover all matching data. Intermediate rows reached the processing cap."
    );
  });

  it("passes all non-empty datasets as distinct chart candidates", async () => {
    const { visualizationNode } = await import("../visualization-node");
    const cache = await import("../../utils/query-artifact-cache");
    const { generateChartsFromCandidates } = await import("../../../../charts/chart-generator");
    vi.mocked(cache.resolveAnalysisData).mockResolvedValueOnce({
      datasets: [
        { title: "Papers (2023-2026)", data: [{ paper_count: 347 }] },
        { title: "Think tank (2023-2026)", data: [{ thinktank_count: 56 }] },
        { title: "Empty set", data: [] },
      ],
      source: "current_query",
    });
    vi.mocked(generateChartsFromCandidates).mockResolvedValueOnce({
      charts: [{ chartType: "bar", title: "Comparison", skillId: "bar", html: "<svg/>" } as any],
      diagnostics: [],
    });

    await visualizationNode(
      {
        userQuestion: "Compare outputs",
        threadId: "t1",
        plan: { steps: [{ type: "visualization", instruction: "Compare outputs" }] },
      } as any,
      { configurable: { domainId: "domain-1", requestSeq: 1 } }
    );

    expect(generateChartsFromCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [
          { sourceSubQuestion: "Papers (2023-2026)", data: [{ paper_count: 347 }], truncation: undefined },
          { sourceSubQuestion: "Think tank (2023-2026)", data: [{ thinktank_count: 56 }], truncation: undefined },
        ],
      })
    );
  });
});
