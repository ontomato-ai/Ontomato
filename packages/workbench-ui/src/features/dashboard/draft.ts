import { z } from "zod";
import type { PageDraft } from "@ontomato/contracts/page-draft";
import {
  dashboardGroupSchema,
  dashboardReplaceLayoutSchema,
  dashboardSaveParametersSchema,
  type DashboardDetail,
  type DashboardLayout,
} from "@ontomato/contracts/dashboard";

/*
 * What the dashboard page does with a draft an agent wrote: it checks the draft against the board the reader owns,
 * lays it over a copy of that board for the reader to see, and saves it through the same request a reader's own edit
 * sends. The envelope belongs to the platform; each operation's form is this page's own save body.
 */

/** The dashboard page's registration key; a draft for another page is not filled here. */
export const DASHBOARD_PAGE_KEY = "dashboard";

const renameSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict();
const chartRenameSchema = z.object({ id: z.string().min(1), chartId: z.string().min(1), resultSetName: z.string().min(1) }).strict();
const metricRenameSchema = z.object({ id: z.string().min(1), metricId: z.string().min(1), metricName: z.string().min(1) }).strict();
const groupRenameSchema = z.object({ id: z.string().min(1), groupId: z.string().min(1), dimensionName: z.string().min(1) }).strict();

/**
 * The page's save actions and the body each one sends: the same bodies the page's own edit actions post, so a draft
 * never invents a second save path.
 */
export const dashboardDraftOperations = {
  "dashboard.layout": dashboardReplaceLayoutSchema,
  "dashboard.rename": renameSchema,
  "dashboard.chart.rename": chartRenameSchema,
  "dashboard.metric.rename": metricRenameSchema,
  "dashboard.group.rename": groupRenameSchema,
  "dashboard.card.parameters": dashboardSaveParametersSchema,
} as const;

export type DashboardDraftOperation = keyof typeof dashboardDraftOperations;

/** The board one draft addresses, by the operation's own dashboard field. */
function dashboardIdOf(operation: DashboardDraftOperation, form: unknown): string {
  const body = form as { id?: string; dashboardId?: string };
  return String(body.dashboardId ?? body.id ?? "");
}

/** The card, group or metric a draft addresses; a layout addresses every card of the board at once. */
export type DraftAddress = { kind: "chart" | "metric"; id: string } | { kind: "group"; id: string };

function addressOf(operation: DashboardDraftOperation, form: unknown): DraftAddress | null {
  const body = form as { chartId?: string; metricId?: string; groupId?: string; groups?: { id: string; charts: { id: string }[]; metrics: { id: string }[] }[] };
  switch (operation) {
    case "dashboard.chart.rename": return { kind: "chart", id: body.chartId! };
    case "dashboard.metric.rename": return { kind: "metric", id: body.metricId! };
    case "dashboard.group.rename": return { kind: "group", id: body.groupId! };
    case "dashboard.layout": return null;
    case "dashboard.rename":
    case "dashboard.card.parameters": return { kind: "chart", id: (body as { cardId?: string }).cardId ?? "" };
  }
}

/** The board as the page reads it: every group, chart and number card the draft may name. */
export type BoardIdentity = {
  id: string;
  groups: Map<string, string>;
  charts: Map<string, string>;
  metrics: Map<string, string>;
};

export function boardIdentity(detail: DashboardDetail): BoardIdentity {
  return {
    id: detail.id,
    groups: new Map(detail.groups.map((group) => [group.id, group.title])),
    charts: new Map(detail.groups.flatMap((group) => group.charts).map((card) => [card.id, card.name])),
    metrics: new Map(detail.groups.flatMap((group) => group.metrics).map((card) => [card.id, card.name])),
  };
}

/** Why a draft cannot be filled: its page, its action, the board it names, or an object this board does not have. */
export class DraftRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftRejected";
  }
}

/**
 * A draft the page accepted: its save action, the board it addresses, and its body once this operation's own schema
 * has read it. The body is the page's save request, so the page posts it as it is.
 */
export type AcceptedDraft = {
  operation: DashboardDraftOperation;
  id: string;
  form: unknown;
  address: DraftAddress | null;
};

/**
 * Checks a draft against the page and the board before anything is filled: its page key, one of this page's save
 * actions, a body that action accepts, the same board in the envelope and the body, and an object this board has.
 */
export function acceptDraft(draft: PageDraft<Record<string, unknown>>, board: BoardIdentity): AcceptedDraft {
  if (draft.pageKey !== DASHBOARD_PAGE_KEY) throw new DraftRejected(`This draft is for ${draft.pageKey}, not ${DASHBOARD_PAGE_KEY}`);
  if (!(draft.operation in dashboardDraftOperations)) throw new DraftRejected(`Unknown dashboard action: ${draft.operation}`);
  const operation = draft.operation as DashboardDraftOperation;
  const parsed = dashboardDraftOperations[operation].safeParse(draft.form);
  if (!parsed.success) throw new DraftRejected(`This draft's ${operation} body is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const id = dashboardIdOf(operation, parsed.data);
  if (draft.target.id !== undefined && draft.target.id !== id) throw new DraftRejected("This draft names two different dashboards");
  if (id !== board.id) throw new DraftRejected("This draft is for another dashboard");
  const address = addressOf(operation, parsed.data);
  if (address) {
    const known = address.kind === "group" ? board.groups : address.kind === "chart" ? board.charts : board.metrics;
    if (!known.has(address.id)) throw new DraftRejected(`This dashboard has no ${address.kind} ${address.id}`);
  }
  if (operation === "dashboard.layout") {
    // A layout names the whole board: every group, card and number card it lists must be this board's own.
    const layout = parsed.data as { groups: { id: string; charts: { id: string }[]; metrics: { id: string }[] }[] };
    for (const group of layout.groups) {
      if (!board.groups.has(group.id)) throw new DraftRejected(`This dashboard has no group ${group.id}`);
      for (const card of group.charts) if (!board.charts.has(card.id)) throw new DraftRejected(`This dashboard has no chart ${card.id}`);
      for (const card of group.metrics) if (!board.metrics.has(card.id)) throw new DraftRejected(`This dashboard has no number card ${card.id}`);
    }
  }
  return { operation, id, form: parsed.data, address };
}

/**
 * The draft's effect on one card: the name it gives, the chart file it draws, the layout it moves the card to. A
 * field the draft leaves out is unchanged.
 */
export type CardDraft = {
  name?: string;
  chartFile?: { name: string; content: unknown };
  layout?: DashboardLayout;
};

/**
 * The board as the reader sees it while a draft is open: the saved board with the draft's own changes laid over it.
 * Nothing here is saved, and the saved board stays as the server returned it.
 */
export function applyDraft(detail: DashboardDetail, draft: AcceptedDraft): { groups: DashboardDetail["groups"]; cards: Map<string, CardDraft>; groupsRenamed: Map<string, string> } {
  const cards = new Map<string, CardDraft>();
  const groupsRenamed = new Map<string, string>();
  const form = draft.form as {
    name?: string; dimensionName?: string; resultSetName?: string; chartId?: string; groupId?: string; metricId?: string; metricName?: string;
    groups?: { id: string; title: string; charts: { id: string; name?: string; layout?: DashboardLayout; chartFile?: { name: string; content: unknown } }[]; metrics: { id: string; name?: string; layout?: DashboardLayout }[] }[];
  };
  switch (draft.operation) {
    case "dashboard.rename":
      return { groups: detail.groups, cards, groupsRenamed };
    case "dashboard.group.rename":
      groupsRenamed.set(form.groupId!, form.dimensionName!);
      return { groups: detail.groups.map((group) => (group.id === form.groupId ? { ...group, title: form.dimensionName! } : group)), cards, groupsRenamed };
    case "dashboard.chart.rename":
      cards.set(form.chartId!, { name: form.resultSetName });
      return { groups: withCardChanges(detail.groups, cards), cards, groupsRenamed };
    case "dashboard.metric.rename":
      cards.set(form.metricId!, { name: form.metricName });
      return { groups: withCardChanges(detail.groups, cards), cards, groupsRenamed };
    case "dashboard.card.parameters":
      return { groups: detail.groups, cards, groupsRenamed };
    case "dashboard.layout": {
      // A layout names every group and card of the board it saves; only the cards it changes carry a change.
      const layout = form.groups!;
      for (const group of detail.groups) groupsRenamed.set(group.id, layout.find((entry) => entry.id === group.id)?.title ?? group.title);
      for (const card of detail.groups.flatMap((group) => group.charts)) {
        const saved = layout.flatMap((group) => group.charts).find((entry) => entry.id === card.id);
        if (!saved) continue;
        const change: CardDraft = {};
        if (saved.name !== undefined && saved.name !== card.name) change.name = saved.name;
        if (saved.chartFile) change.chartFile = { name: saved.chartFile.name, content: saved.chartFile.content };
        if (saved.layout && (saved.layout.colSpan !== card.layout?.colSpan || saved.layout.rowSpan !== card.layout?.rowSpan)) change.layout = saved.layout;
        if (Object.keys(change).length) cards.set(card.id, change);
      }
      for (const card of detail.groups.flatMap((group) => group.metrics)) {
        const saved = layout.flatMap((group) => group.metrics).find((entry) => entry.id === card.id);
        if (!saved) continue;
        const change: CardDraft = {};
        if (saved.name !== undefined && saved.name !== card.name) change.name = saved.name;
        if (saved.layout && (saved.layout.colSpan !== card.layout?.colSpan || saved.layout.rowSpan !== card.layout?.rowSpan)) change.layout = saved.layout;
        if (Object.keys(change).length) cards.set(card.id, change);
      }
      const groups: DashboardDetail["groups"] = layout.map((entry) => {
        const saved = detail.groups.find((group) => group.id === entry.id)!;
        return {
          ...saved,
          title: entry.title,
          charts: saved.charts.map((card) => {
            const next = entry.charts.find((chart) => chart.id === card.id)!;
            return { ...card, name: next.name ?? card.name, layout: next.layout ?? card.layout, ...(next.chartFile ? { chartFile: next.chartFile as unknown as typeof card.chartFile } : {}) };
          }),
          metrics: saved.metrics.map((card) => {
            const next = entry.metrics.find((metric) => metric.id === card.id)!;
            return { ...card, name: next.name ?? card.name, layout: next.layout ?? card.layout };
          }),
        };
      });
      return { groups, cards, groupsRenamed };
    }
  }
}

function withCardChanges(groups: DashboardDetail["groups"], cards: Map<string, CardDraft>) {
  const rename = <T extends { id: string; name: string }>(card: T): T => {
    const change = cards.get(card.id);
    return change?.name ? { ...card, name: change.name } : card;
  };
  return groups.map((group) => ({ ...group, charts: group.charts.map(rename), metrics: group.metrics.map(rename) }));
}

/** The board a layout draft would save, so the reader's own drag can be checked against the same groups. */
export function layoutGroups(groups: DashboardDetail["groups"]) {
  return dashboardGroupSchema.array().parse(groups);
}
