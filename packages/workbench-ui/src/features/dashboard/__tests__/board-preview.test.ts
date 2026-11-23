import { describe, expect, it } from "vitest";
import {
  boardPreviewModifiedCards,
  computeDashboardBoardFingerprint,
  findBoardInlineEditConflicts,
  findMissingPreviewTargets,
  mergeBoardPreview,
  parseBoardPreviewFill,
  summarizeBoardPreview,
  type BoardPreviewState,
} from "../board-preview";

const barChartFile = {
  name: "revenue-bar.chart.json",
  content: {
    dataset: [{ id: "metric" as const, dimensions: ["region", "revenue"], source: [] }],
    series: [{ id: "revenue", type: "bar", datasetId: "metric" as const, encode: { x: "region", y: "revenue" } }],
    ontomato: {},
  },
};

const lineChartFile = {
  name: "revenue-line.chart.json",
  content: {
    dataset: [{ id: "metric" as const, dimensions: ["region", "revenue"], source: [] }],
    series: [{ id: "revenue", type: "line", datasetId: "metric" as const, encode: { x: "region", y: "revenue" } }],
    ontomato: {},
  },
};

const savedGroups = [
  {
    id: "g1",
    title: "Overview",
    charts: [
      {
        id: "c1",
        name: "Revenue by region",
        query: { kind: "metric" as const, metricId: "m-1", parameters: {} },
        chartFile: barChartFile,
        layout: { colSpan: 12, rowSpan: 1 },
      },
      {
        id: "c2",
        name: "Margin trend",
        query: { kind: "metric" as const, metricId: "m-2", parameters: {} },
        chartFile: barChartFile,
        layout: { colSpan: 12, rowSpan: 1 },
      },
    ],
    metrics: [
      {
        id: "n1",
        name: "Total revenue",
        query: { kind: "metric" as const, metricId: "m-3", parameters: {} },
        valueField: "total",
        unit: "CNY",
        displayLimit: 10,
        layout: { colSpan: 4, rowSpan: 1 },
      },
    ],
  },
  {
    id: "g2",
    title: "Details",
    charts: [],
    metrics: [
      {
        id: "n2",
        name: "Active customers",
        query: { kind: "metric" as const, metricId: "m-4", parameters: {} },
        valueField: "count",
        unit: "users",
        layout: { colSpan: 4, rowSpan: 1 },
      },
    ],
  },
];

describe("mergeBoardPreview", () => {
  it("accumulates consecutive board name, group rename, and card rename fills without dropping earlier fields", () => {
    const first = parseBoardPreviewFill("d1", savedGroups, { name: "Q4 Sales" }, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = parseBoardPreviewFill("d1", savedGroups, { groupNames: { g1: "Q4 Overview" } }, 2);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const merged1 = mergeBoardPreview(first.preview, second.preview);
    expect(merged1.boardName).toBe("Q4 Sales");
    expect(merged1.groupRenames).toEqual({ g1: "Q4 Overview" });

    const third = parseBoardPreviewFill("d1", savedGroups, { cardNames: { c1: "Revenue Trend", n1: "Q4 Total" } }, 3);
    expect(third.ok).toBe(true);
    if (!third.ok) return;

    const merged2 = mergeBoardPreview(merged1, third.preview);
    expect(merged2.boardName).toBe("Q4 Sales");
    expect(merged2.groupRenames).toEqual({ g1: "Q4 Overview" });
    expect(merged2.chartRenames).toEqual({ c1: "Revenue Trend" });
    expect(merged2.metricRenames).toEqual({ n1: "Q4 Total" });
  });

  it("preserves boardName when a follow-up fill supplies full groups, and preserves layout/chartFile when a follow-up fill supplies groupNames/cardNames", () => {
    const first = parseBoardPreviewFill("d1", savedGroups, { name: "Q4 Sales" }, 1);
    if (!first.ok) throw new Error("expected ok");

    const layoutFill = parseBoardPreviewFill("d1", savedGroups, {
      groups: [
        {
          id: "g1",
          title: "Overview",
          charts: [{ id: "c1", layout: { colSpan: 24, rowSpan: 2 }, chartFile: lineChartFile }],
          metrics: [{ id: "n1", unit: "USD" }],
        },
        {
          id: "g2",
          title: "Details",
          charts: [{ id: "c2" }],
          metrics: [{ id: "n2" }],
        },
      ],
    }, 2);
    if (!layoutFill.ok) throw new Error("expected ok");

    const mergedLayout = mergeBoardPreview(first.preview, layoutFill.preview);
    expect(mergedLayout.boardName).toBe("Q4 Sales");
    expect(mergedLayout.layoutGroups?.[0]?.charts[0]?.chartFile).toEqual(lineChartFile);

    const renameFill = parseBoardPreviewFill("d1", savedGroups, {
      groupNames: { g1: "Executive Summary" },
      cardNames: { c1: "Revenue Line" },
    }, 3);
    if (!renameFill.ok) throw new Error("expected ok");

    const mergedRename = mergeBoardPreview(mergedLayout, renameFill.preview);
    expect(mergedRename.boardName).toBe("Q4 Sales");
    expect(mergedRename.groupRenames).toEqual({ g1: "Executive Summary" });
    expect(mergedRename.chartRenames).toEqual({ c1: "Revenue Line" });
    expect(mergedRename.layoutGroups?.[0]?.charts[0]?.chartFile).toEqual(lineChartFile);
    expect(mergedRename.layoutGroups?.[0]?.charts[0]?.layout).toEqual({ colSpan: 24, rowSpan: 2 });
  });

  it("preserves prior groupNames/cardNames renames and swapped chartFile when a follow-up groups layout repeats baseline values", () => {
    const renameFill = parseBoardPreviewFill("d1", savedGroups, {
      name: "Q4 Sales",
      groupNames: { g1: "Q4 Overview" },
      cardNames: { c1: "Revenue Trend", n1: "Q4 Total" },
    }, 1, "Sales");
    if (!renameFill.ok) throw new Error("expected ok");

    // Follow-up full layout carries stale baseline group/card names from an earlier board read while swapping c1's chartFile.
    const chartSwapFill = parseBoardPreviewFill("d1", savedGroups, {
      groups: [
        {
          id: "g1",
          title: "Overview",
          charts: [
            { id: "c1", name: "Revenue by region", chartFile: lineChartFile, layout: { colSpan: 12, rowSpan: 1 } },
            { id: "c2", name: "Margin trend", layout: { colSpan: 12, rowSpan: 1 } },
          ],
          metrics: [{ id: "n1", name: "Total revenue", layout: { colSpan: 4, rowSpan: 1 } }],
        },
        {
          id: "g2",
          title: "Details",
          charts: [],
          metrics: [{ id: "n2", name: "Active customers", layout: { colSpan: 4, rowSpan: 1 } }],
        },
      ],
    }, 2, "Sales");
    if (!chartSwapFill.ok) throw new Error("expected ok");

    const merged = mergeBoardPreview(renameFill.preview, chartSwapFill.preview, savedGroups);
    expect(merged.baselineFingerprint).toBe(renameFill.preview.baselineFingerprint);
    expect(merged.boardName).toBe("Q4 Sales");
    expect(merged.layoutGroups?.[0]?.title).toBe("Q4 Overview");
    expect(merged.layoutGroups?.[0]?.charts[0]?.name).toBe("Revenue Trend");
    expect(merged.layoutGroups?.[0]?.charts[0]?.chartFile).toEqual(lineChartFile);
    expect(merged.layoutGroups?.[0]?.metrics[0]?.name).toBe("Q4 Total");

    // A third groups layout repeating baseline chartFile and names still preserves prior renames and swapped chartFile,
    // while an explicit non-baseline name overrides the earlier rename.
    const thirdFill = parseBoardPreviewFill("d1", savedGroups, {
      groups: [
        {
          id: "g1",
          title: "Final Overview",
          charts: [
            { id: "c1", name: "Revenue by region", chartFile: barChartFile, layout: { colSpan: 24, rowSpan: 2 } },
            { id: "c2", name: "Margin trend" },
          ],
          metrics: [{ id: "n1", name: "Total revenue" }],
        },
        {
          id: "g2",
          title: "Details",
          charts: [],
          metrics: [{ id: "n2", name: "Active customers" }],
        },
      ],
    }, 3, "Sales");
    if (!thirdFill.ok) throw new Error("expected ok");

    const mergedThird = mergeBoardPreview(merged, thirdFill.preview, savedGroups);
    expect(mergedThird.layoutGroups?.[0]?.title).toBe("Final Overview");
    expect(mergedThird.layoutGroups?.[0]?.charts[0]?.name).toBe("Revenue Trend");
    expect(mergedThird.layoutGroups?.[0]?.charts[0]?.chartFile).toEqual(lineChartFile);
    expect(mergedThird.layoutGroups?.[0]?.charts[0]?.layout).toEqual({ colSpan: 24, rowSpan: 2 });
    expect(mergedThird.layoutGroups?.[0]?.metrics[0]?.name).toBe("Q4 Total");
  });
});

describe("computeDashboardBoardFingerprint and findBoardInlineEditConflicts", () => {
  it("ignores transient render fields and detects persisted structural changes", () => {
    const withRenderFields = savedGroups.map((group) => ({
      ...group,
      charts: group.charts.map((chart) => ({
        ...chart,
        title: chart.name,
        state: "ready",
        rows: [{ region: "East", revenue: 100 }],
        columns: [{ key: "region", label: "Region", type: null }],
        truncation: undefined,
      })),
      metrics: group.metrics.map((metric) => ({
        ...metric,
        state: "ready",
        rows: [{ total: 100 }],
        error: undefined,
      })),
    }));

    const base = computeDashboardBoardFingerprint("Sales", savedGroups);
    expect(computeDashboardBoardFingerprint("Sales", withRenderFields)).toBe(base);
    expect(computeDashboardBoardFingerprint("Sales Updated", savedGroups)).not.toBe(base);

    const reordered = [savedGroups[1]!, savedGroups[0]!];
    expect(computeDashboardBoardFingerprint("Sales", reordered)).not.toBe(base);

    const addedCard = [
      {
        ...savedGroups[0]!,
        charts: [
          ...savedGroups[0]!.charts,
          {
            id: "c-added",
            name: "New Card",
            query: { kind: "metric" as const, metricId: "m-9", parameters: {} },
            chartFile: lineChartFile,
            layout: { colSpan: 12, rowSpan: 1 },
          },
        ],
      },
      savedGroups[1]!,
    ];
    expect(computeDashboardBoardFingerprint("Sales", addedCard)).not.toBe(base);
  });

  it("detects inline edit conflicts only on matching board/group/card targets", () => {
    const renameBoard = parseBoardPreviewFill("d1", savedGroups, { name: "New Board" }, 1, "Sales");
    const renameGroup = parseBoardPreviewFill("d1", savedGroups, { groupNames: { g1: "New Group" } }, 2, "Sales");
    const renameCard = parseBoardPreviewFill("d1", savedGroups, { cardNames: { c1: "New Chart" } }, 3, "Sales");
    const swapChartKeepingBaselineNames = parseBoardPreviewFill("d1", savedGroups, {
      groups: [
        {
          id: "g1",
          title: "Overview",
          charts: [{ id: "c1", name: "Revenue by region", chartFile: lineChartFile }, { id: "c2" }],
          metrics: [{ id: "n1" }],
        },
        { id: "g2", title: "Details", charts: [], metrics: [{ id: "n2" }] },
      ],
    }, 4, "Sales");
    if (!renameBoard.ok || !renameGroup.ok || !renameCard.ok || !swapChartKeepingBaselineNames.ok) {
      throw new Error("expected ok");
    }

    expect(findBoardInlineEditConflicts("Sales", savedGroups, renameBoard.preview, { boardName: true })).toHaveLength(1);
    expect(findBoardInlineEditConflicts("Sales", savedGroups, renameGroup.preview, { boardName: true })).toEqual([]);
    expect(findBoardInlineEditConflicts("Sales", savedGroups, renameGroup.preview, { groupId: "g1" })).toHaveLength(1);
    expect(findBoardInlineEditConflicts("Sales", savedGroups, renameCard.preview, { groupId: "g1" })).toEqual([]);
    expect(findBoardInlineEditConflicts("Sales", savedGroups, renameCard.preview, { cardId: "c1" })).toHaveLength(1);
    expect(findBoardInlineEditConflicts("Sales", savedGroups, renameCard.preview, { cardId: "n1" })).toEqual([]);
    // Layout swapping chartFile while leaving group/card names at baseline does not conflict with inline rename of g1 or c1.
    expect(findBoardInlineEditConflicts("Sales", savedGroups, swapChartKeepingBaselineNames.preview, { groupId: "g1", cardId: "c1" })).toEqual([]);
  });
});

describe("summarizeBoardPreview and boardPreviewModifiedCards", () => {
  it("reports removed cards and removed groups by name instead of hiding them under generic layout order", () => {
    const preview: BoardPreviewState = {
      version: 1,
      groupRenames: {},
      chartRenames: {},
      metricRenames: {},
      layoutGroups: [
        {
          id: "g1",
          title: "Overview",
          charts: [{ id: "c1" }], // c2 omitted!
          metrics: [{ id: "n1" }],
        },
        // g2 (containing n2) removed!
      ],
    };

    const summary = summarizeBoardPreview("Sales", savedGroups, preview);
    expect(summary.confirmImpactSummary).toContain("Removed groups: Details");
    expect(summary.confirmImpactSummary).toContain("Removed cards: Margin trend, Active customers");
    expect(summary.confirmImpactSummary).not.toContain("Layout order");
    expect(summary.displaySummary).toContain("Remove groups: Details");
    expect(summary.displaySummary).toContain("Remove cards: Margin trend, Active customers");
  });

  it("reports added groups and added cards when present in a preview", () => {
    const preview: BoardPreviewState = {
      version: 1,
      groupRenames: {},
      chartRenames: {},
      metricRenames: {},
      layoutGroups: [
        {
          id: "g1",
          title: "Overview",
          charts: [{ id: "c1" }, { id: "c2" }],
          metrics: [{ id: "n1" }],
        },
        {
          id: "g2",
          title: "Details",
          charts: [],
          metrics: [{ id: "n2" }],
        },
        {
          id: "g3",
          title: "New Section",
          charts: [{ id: "c3", name: "New Chart" }],
          metrics: [],
        },
      ],
    };

    const summary = summarizeBoardPreview("Sales", savedGroups, preview);
    expect(summary.confirmImpactSummary).toContain("Added groups: New Section");
    expect(summary.confirmImpactSummary).toContain("Added cards: New Chart");
  });

  it("reports metric card property edits (unit, formats, displayLimit, sort) without leaking new values", () => {
    const preview: BoardPreviewState = {
      version: 1,
      groupRenames: {},
      chartRenames: {},
      metricRenames: {},
      layoutGroups: [
        {
          id: "g1",
          title: "Overview",
          charts: [{ id: "c1" }, { id: "c2" }],
          metrics: [
            {
              id: "n1",
              unit: "USD-SECRET",
              displayLimit: 25,
              formats: { total: { kind: "currency", currency: "USD", decimals: 2 } },
            },
          ],
        },
        {
          id: "g2",
          title: "Details",
          charts: [],
          metrics: [{ id: "n2" }],
        },
      ],
    };

    const summary = summarizeBoardPreview("Sales", savedGroups, preview);
    expect(summary.confirmImpactSummary).toContain("Metrics: Total revenue (unit, formats, displayLimit)");
    expect(summary.confirmImpactSummary).not.toBe("Dashboard layout");
    expect(summary.confirmImpactSummary).not.toContain("USD-SECRET");
    expect(boardPreviewModifiedCards(savedGroups, preview).has("n1")).toBe(true);
  });
});

describe("findMissingPreviewTargets", () => {
  it("reports missing groups, charts, and metrics referenced by renames or layoutGroups", () => {
    const missingFromRenames = findMissingPreviewTargets(savedGroups, {
      version: 1,
      groupRenames: { "g-gone": "X" },
      chartRenames: { "c-gone": "Y" },
      metricRenames: { "n-gone": "Z" },
    });
    expect(missingFromRenames).toEqual(["group 'g-gone'", "chart 'c-gone'", "metric 'n-gone'"]);

    const missingFromLayout = findMissingPreviewTargets(savedGroups, {
      version: 2,
      groupRenames: {},
      chartRenames: {},
      metricRenames: {},
      layoutGroups: [
        {
          id: "g1",
          title: "Overview",
          charts: [{ id: "c1" }, { id: "c-deleted" }],
          metrics: [{ id: "n-deleted" }],
        },
      ],
    });
    expect(missingFromLayout).toEqual(["chart 'c-deleted'", "metric 'n-deleted'"]);
  });
});
