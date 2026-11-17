import { describe, expect, it } from "vitest";
import type { PageDraft } from "@ontomato/contracts/page-draft";
import type { DashboardDetail } from "@ontomato/contracts/dashboard";
import { acceptDraft, applyDraft, boardIdentity, DraftRejected } from "../draft";

/**
 * One draft is one of the dashboard's six save actions. It is filled only when its page, its action, its board and
 * every object it names are this board's own; its changes are laid over the saved board as the reader sees them, and
 * nothing is posted. A rename names the board itself, a card may be a number card, and a layout that names the file the
 * board already saved changes nothing.
 */
const chartFile = {
  name: "revenue.chart.json",
  content: {
    dataset: [{ id: "metric" as const, dimensions: ["region", "revenue"], source: [] }],
    series: [{ id: "revenue", type: "bar", datasetId: "metric" as const, encode: { x: "region", y: "revenue" } }],
    ontomato: {},
  },
};

const board: DashboardDetail = {
  id: "d1",
  ownerId: "u1",
  name: "Sales",
  createdAt: 0,
  updatedAt: 0,
  groups: [
    {
      id: "g1",
      title: "Sales",
      charts: [{ id: "c1", name: "Revenue by region", query: { kind: "metric", metricId: "m-1", parameters: {} }, chartFile, layout: { colSpan: 12, rowSpan: 1 } }],
      metrics: [{ id: "n1", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total", unit: "CNY" }],
    },
  ],
};

const identity = () => boardIdentity(board);
const draft = (operation: string, form: unknown, target: { id?: string } = { id: "d1" }): PageDraft<Record<string, unknown>> =>
  ({ pageKey: "dashboard", operation, target, form: form as Record<string, unknown> });

describe("dashboard.rename", () => {
  it("accepts a board's own name, addresses the board, and shows both names", () => {
    const accepted = acceptDraft(draft("dashboard.rename", { id: "d1", name: "Revenue" }), identity());
    expect(accepted.address).toEqual({ kind: "board" });
    const applied = applyDraft(board, accepted);
    expect(applied.boardName).toBe("Revenue");
    expect(applied.cards.size).toBe(0);
  });

  it("rejects a name for another board or with no name", () => {
    expect(() => acceptDraft(draft("dashboard.rename", { id: "d2", name: "Revenue" }), identity())).toThrow(DraftRejected);
    expect(() => acceptDraft(draft("dashboard.rename", { id: "d1", name: "" }), identity())).toThrow(/body is invalid/);
  });
});

describe("dashboard.group.rename", () => {
  it("accepts a group of this board and shows its new title", () => {
    const accepted = acceptDraft(draft("dashboard.group.rename", { id: "d1", groupId: "g1", dimensionName: "Revenue" }), identity());
    expect(accepted.address).toEqual({ kind: "group", id: "g1" });
    const applied = applyDraft(board, accepted);
    expect(applied.groups[0]!.title).toBe("Revenue");
    expect(applied.groupsRenamed.get("g1")).toBe("Revenue");
  });

  it("rejects a group this board does not have", () => {
    expect(() => acceptDraft(draft("dashboard.group.rename", { id: "d1", groupId: "gone", dimensionName: "Revenue" }), identity())).toThrow(/no group gone/);
  });
});

describe("dashboard.chart.rename", () => {
  it("accepts a chart of this board and shows it under the new name", () => {
    const accepted = acceptDraft(draft("dashboard.chart.rename", { id: "d1", chartId: "c1", resultSetName: "Revenue by province" }), identity());
    expect(accepted.address).toEqual({ kind: "chart", id: "c1" });
    const applied = applyDraft(board, accepted);
    expect(applied.cards.get("c1")).toEqual({ name: "Revenue by province" });
    expect(applied.groups[0]!.charts[0]!.name).toBe("Revenue by province");
  });

  it("rejects a chart this board does not have, and a number card named as a chart", () => {
    expect(() => acceptDraft(draft("dashboard.chart.rename", { id: "d1", chartId: "gone", resultSetName: "x" }), identity())).toThrow(/no chart gone/);
    expect(() => acceptDraft(draft("dashboard.chart.rename", { id: "d1", chartId: "n1", resultSetName: "x" }), identity())).toThrow(/no chart n1/);
  });
});

describe("dashboard.metric.rename", () => {
  it("accepts a number card of this board and shows it under the new name", () => {
    const accepted = acceptDraft(draft("dashboard.metric.rename", { id: "d1", metricId: "n1", metricName: "Revenue" }), identity());
    expect(accepted.address).toEqual({ kind: "metric", id: "n1" });
    expect(applyDraft(board, accepted).groups[0]!.metrics[0]!.name).toBe("Revenue");
  });

  it("rejects a number card this board does not have, and a chart named as a number card", () => {
    expect(() => acceptDraft(draft("dashboard.metric.rename", { id: "d1", metricId: "gone", metricName: "x" }), identity())).toThrow(/no number card gone/);
    expect(() => acceptDraft(draft("dashboard.metric.rename", { id: "d1", metricId: "c1", metricName: "x" }), identity())).toThrow(/no number card c1/);
  });
});

describe("dashboard.card.parameters", () => {
  it("accepts a chart card and a number card, and keeps the kind it found", () => {
    expect(acceptDraft(draft("dashboard.card.parameters", { dashboardId: "d1", cardId: "c1", revision: "r1", values: { year: "2024" } }), identity()).address)
      .toEqual({ kind: "chart", id: "c1" });
    expect(acceptDraft(draft("dashboard.card.parameters", { dashboardId: "d1", cardId: "n1", revision: "r1", values: { year: "2024" } }), identity()).address)
      .toEqual({ kind: "metric", id: "n1" });
  });

  it("rejects a card of neither kind", () => {
    expect(() => acceptDraft(draft("dashboard.card.parameters", { dashboardId: "d1", cardId: "gone", revision: "r1", values: {} }), identity())).toThrow(/no card gone/);
  });
});

describe("dashboard.layout", () => {
  it("accepts the board's own groups and marks only the file that changed", () => {
    const changed = { name: "province.chart.json", content: { ...chartFile.content, title: { text: "By province" } } as unknown as typeof chartFile.content };
    const accepted = acceptDraft(
      draft("dashboard.layout", {
        id: "d1",
        groups: [{ id: "g1", title: "Sales", charts: [{ id: "c1", name: "Revenue by region", chartFile: changed }], metrics: [{ id: "n1" }] }],
      }),
      identity(),
    );
    const applied = applyDraft(board, accepted);
    expect(applied.cards.get("c1")).toEqual({ chartFile: changed });
    expect(applied.groups[0]!.charts[0]!.chartFile).toEqual(changed);
  });

  it("marks nothing for the file the board already saved, key order aside", () => {
    const same = { ...chartFile, content: { ontomato: {}, series: chartFile.content.series, dataset: chartFile.content.dataset } };
    const accepted = acceptDraft(
      draft("dashboard.layout", {
        id: "d1",
        groups: [{ id: "g1", title: "Sales", charts: [{ id: "c1", name: "Revenue by region", chartFile: same, layout: { colSpan: 12, rowSpan: 1 } }], metrics: [{ id: "n1" }] }],
      }),
      identity(),
    );
    const applied = applyDraft(board, accepted);
    expect(applied.cards.size).toBe(0);
    expect(applied.groups[0]!.charts[0]!.chartFile).toEqual(chartFile);
  });

  it("rejects a layout naming another board's group or card", () => {
    const layout = (groupId: string, chartId: string) =>
      draft("dashboard.layout", { id: "d1", groups: [{ id: groupId, title: "Sales", charts: [{ id: chartId }], metrics: [] }] });
    expect(() => acceptDraft(layout("gone", "c1"), identity())).toThrow(/no group gone/);
    expect(() => acceptDraft(layout("g1", "gone"), identity())).toThrow(/no chart gone/);
    expect(() => acceptDraft(draft("dashboard.layout", { id: "d1", groups: [{ id: "g1", title: "Sales", charts: [], metrics: [{ id: "gone" }] }] }), identity())).toThrow(/no number card gone/);
  });
});

describe("the draft envelope", () => {
  it("is not filled for another page, an unknown action, or two different boards", () => {
    expect(() => acceptDraft({ ...draft("dashboard.rename", { id: "d1", name: "Revenue" }), pageKey: "agent-settings" }, identity())).toThrow(/not dashboard/);
    expect(() => acceptDraft(draft("assistant.delete", { id: "d1" }), identity())).toThrow(/Unknown dashboard action/);
    expect(() => acceptDraft(draft("dashboard.rename", { id: "d1", name: "Revenue" }, { id: "d2" }), identity())).toThrow(/two different dashboards/);
    expect(() => acceptDraft(draft("dashboard.rename", { id: "d2", name: "Revenue" }, {}), identity())).toThrow(/another dashboard/);
  });
});
