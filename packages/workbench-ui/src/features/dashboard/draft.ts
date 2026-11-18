import { changedFields, type PageDraft } from "@ontomato/contracts/page-draft";
import {
  dashboardAuthoring,
  dashboardOperationSchema,
  type DashboardAuthoringForm,
  type DashboardDetail,
  type DashboardLayout,
  type DashboardOperation,
  type DashboardParameterForm,
  type DashboardReplaceLayout,
} from "@ontomato/contracts/dashboard";

/*
 * What the dashboard page does with a draft an agent wrote: it checks the draft against the board the reader owns,
 * lays it over a copy of that board for the reader to see, and saves it through the same request a reader's own edit
 * sends. The envelope belongs to the platform and each save action's body to `dashboardAuthoring`, so this page only
 * resolves what a draft addresses and what the reader is shown.
 */

/** The dashboard page's registration key; a draft for another page is not filled here. */
export const DASHBOARD_PAGE_KEY = "dashboard";

/** The board one draft addresses, by the operation's own dashboard field. */
function dashboardIdOf(form: unknown): string {
  const body = form as { id?: string; dashboardId?: string };
  return String(body.dashboardId ?? body.id ?? "");
}

/**
 * The object a draft changes inside the board: a group, a card by its own kind, or the board itself. A layout names
 * the whole board and so addresses no single object.
 */
export type DraftAddress =
  | { kind: "board" }
  | { kind: "group" | "chart" | "metric"; id: string };

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
 * The object one operation changes, resolved against the board: a rename names one object, a parameter edit names a
 * card of either kind, and the board's own rename or a layout names no card.
 */
function addressOf(operation: DashboardOperation, form: unknown, board: BoardIdentity): DraftAddress {
  const body = form as { chartId?: string; metricId?: string; groupId?: string; cardId?: string };
  switch (operation) {
    case "dashboard.rename":
      return { kind: "board" };
    case "dashboard.group.rename":
      if (!board.groups.has(body.groupId!)) throw new DraftRejected(`This dashboard has no group ${body.groupId}`);
      return { kind: "group", id: body.groupId! };
    case "dashboard.chart.rename":
      if (!board.charts.has(body.chartId!)) throw new DraftRejected(`This dashboard has no chart ${body.chartId}`);
      return { kind: "chart", id: body.chartId! };
    case "dashboard.metric.rename":
      if (!board.metrics.has(body.metricId!)) throw new DraftRejected(`This dashboard has no number card ${body.metricId}`);
      return { kind: "metric", id: body.metricId! };
    // A number card carries parameters too, so a card is looked up among both kinds and keeps the kind it is.
    case "dashboard.card.parameters":
      if (board.charts.has(body.cardId!)) return { kind: "chart", id: body.cardId! };
      if (board.metrics.has(body.cardId!)) return { kind: "metric", id: body.cardId! };
      throw new DraftRejected(`This dashboard has no card ${body.cardId}`);
    case "dashboard.layout":
      return { kind: "board" };
  }
}

/**
 * A draft the page accepted: its save action, the board it addresses, the object it changes, and its body once this
 * operation's own schema has read it. The body is the page's save request, so the page posts it as it is.
 */
export type AcceptedDraft = {
  operation: DashboardOperation;
  id: string;
  form: unknown;
  address: DraftAddress;
};

/**
 * Checks a draft against the page and the board before anything is filled: its page key, one of this page's save
 * actions, a body that action accepts, the same board in the envelope and the body, and an object this board has.
 */
export function acceptDraft(draft: PageDraft<Record<string, unknown>>, board: BoardIdentity): AcceptedDraft {
  if (draft.pageKey !== DASHBOARD_PAGE_KEY) throw new DraftRejected(`This draft is for ${draft.pageKey}, not ${DASHBOARD_PAGE_KEY}`);
  const known = dashboardOperationSchema.safeParse(draft.operation);
  if (!known.success) throw new DraftRejected(`Unknown dashboard action: ${draft.operation}`);
  const operation = known.data;
  const parsed = dashboardAuthoring[operation].schema.safeParse(draft.form);
  if (!parsed.success) throw new DraftRejected(`This draft's ${operation} body is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  const form = parsed.data as DashboardAuthoringForm<typeof operation>;
  const id = dashboardIdOf(form);
  if (draft.target.id !== undefined && draft.target.id !== id) throw new DraftRejected("This draft names two different dashboards");
  if (id !== board.id) throw new DraftRejected("This draft is for another dashboard");
  const address = addressOf(operation, form, board);
  if (operation === "dashboard.layout") {
    // A layout names the whole board: every group, card and number card it lists must be this board's own.
    const layout = form as { groups: { id: string; charts: { id: string }[]; metrics: { id: string }[] }[] };
    for (const group of layout.groups) {
      if (!board.groups.has(group.id)) throw new DraftRejected(`This dashboard has no group ${group.id}`);
      for (const card of group.charts) if (!board.charts.has(card.id)) throw new DraftRejected(`This dashboard has no chart ${card.id}`);
      for (const card of group.metrics) if (!board.metrics.has(card.id)) throw new DraftRejected(`This dashboard has no number card ${card.id}`);
    }
  }
  return { operation, id, form, address };
}

/** A draft's parameter values as the card's form writes them, in text; its read-only keys stay out, the metric owns those. */
export function parameterText(readOnly: readonly string[], values: Record<string, unknown> | undefined): Record<string, string> {
  const text: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (readOnly.includes(key)) continue;
    text[key] = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  }
  return text;
}

/**
 * Whether saving a draft would write only what is already saved, which leaves the reader nothing to see or save: a
 * draft saved before and opened again is one. A rename gives the name the object already has; a layout keeps every
 * group and card in its place and writes each field as the board holds it, a chart file being the same file when it
 * reads the same. A card's parameters are not part of the board, so their draft is compared with that card's form.
 */
export function changesNothing(detail: DashboardDetail, draft: AcceptedDraft, parameters: DashboardParameterForm | null): boolean {
  const board = boardIdentity(detail);
  const form = draft.form as {
    name?: string; groupId?: string; dimensionName?: string; chartId?: string; resultSetName?: string; metricId?: string; metricName?: string;
    values?: Record<string, unknown>; groups?: DashboardReplaceLayout["groups"];
  };
  switch (draft.operation) {
    case "dashboard.rename":
      return form.name === detail.name;
    case "dashboard.group.rename":
      return board.groups.get(form.groupId!) === form.dimensionName;
    case "dashboard.chart.rename":
      return board.charts.get(form.chartId!) === form.resultSetName;
    case "dashboard.metric.rename":
      return board.metrics.get(form.metricId!) === form.metricName;
    case "dashboard.card.parameters":
      return changedFields(parameters!.values, parameterText(parameters!.readOnly, form.values)).size === 0;
    case "dashboard.layout":
      return form.groups!.length === detail.groups.length && form.groups!.every((entry, index) => {
        const group = detail.groups[index]!;
        return entry.id === group.id && entry.title === group.title && keepsCards(entry.charts, group.charts) && keepsCards(entry.metrics, group.metrics);
      });
  }
}

/** Every card a layout lists is the board's card in that place, holding each field the layout writes. */
function keepsCards(entries: readonly object[], cards: readonly object[]): boolean {
  return entries.length === cards.length && entries.every((entry, index) => {
    const card = cards[index] as Record<string, unknown>;
    return Object.entries(entry).every(([key, value]) =>
      key === "chartFile"
        ? sameJson((value as { content: unknown }).content, (card.chartFile as { content: unknown }).content)
        : sameJson(value, card[key]),
    );
  });
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

/** A draft's changes to the board as the reader sees them; nothing here is saved. */
export type DraftBoard = {
  /** The board's name as the draft has it, when the draft renames the board. */
  boardName?: string;
  groups: DashboardDetail["groups"];
  cards: Map<string, CardDraft>;
  groupsRenamed: Map<string, string>;
};

/**
 * The board as the reader sees it while a draft is open: the saved board with the draft's own changes laid over it.
 * Nothing here is saved, and the saved board stays as the server returned it.
 */
export function applyDraft(detail: DashboardDetail, draft: AcceptedDraft): DraftBoard {
  const cards = new Map<string, CardDraft>();
  const groupsRenamed = new Map<string, string>();
  const form = draft.form as {
    name?: string; dimensionName?: string; resultSetName?: string; chartId?: string; groupId?: string; metricId?: string; metricName?: string;
    groups?: { id: string; title: string; charts: { id: string; name?: string; layout?: DashboardLayout; chartFile?: { name: string; content: unknown } }[]; metrics: { id: string; name?: string; layout?: DashboardLayout }[] }[];
  };
  switch (draft.operation) {
    case "dashboard.rename":
      return { boardName: form.name, groups: detail.groups, cards, groupsRenamed };
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
        // A file this board already saved is not a change, however many times a layout names it.
        if (saved.chartFile && !sameJson(saved.chartFile.content, card.chartFile.content)) change.chartFile = { name: saved.chartFile.name, content: saved.chartFile.content };
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
            const file = next.chartFile && !sameJson(next.chartFile.content, card.chartFile.content) ? next.chartFile : card.chartFile;
            return { ...card, name: next.name ?? card.name, layout: next.layout ?? card.layout, chartFile: file as typeof card.chartFile };
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

/** Two chart files are the same file when they read the same, wherever their keys stand. */
function sameJson(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function withCardChanges(groups: DashboardDetail["groups"], cards: Map<string, CardDraft>) {
  const rename = <T extends { id: string; name: string }>(card: T): T => {
    const change = cards.get(card.id);
    return change?.name ? { ...card, name: change.name } : card;
  };
  return groups.map((group) => ({ ...group, charts: group.charts.map(rename), metrics: group.metrics.map(rename) }));
}
