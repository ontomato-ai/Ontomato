import { beforeEach, expect, it, vi } from "vitest";
import type { HomeDashboardCards, HomeItemRef, HomePinnedObject } from "@ontomato/contracts/platform-home";
import {
  ADD_FAVORITE,
  AGENT_SESSION,
  DASHBOARD,
  FAVORITE,
  MOVE_FAVORITE,
  REMOVE_FAVORITE,
} from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost, PanelRecordTarget } from "../server-operations";

const state = vi.hoisted(() => ({
  favorites: [] as HomeItemRef[],
  dashboardIds: [] as string[],
  dashboardCards: {} as HomeDashboardCards,
  pinnedSessions: [] as string[],
  pinnedObjects: [] as HomePinnedObject[],
  dashboardsById: {} as Record<string, unknown>,
  metricDescribe: vi.fn(),
  metricExecute: vi.fn(),
}));

vi.mock("../../platform-home/store", () => ({
  platformHomeStore: {
    preferences: vi.fn(async () => ({ favorites: [...state.favorites], dashboardIds: [...state.dashboardIds] })),
    saveFavorites: vi.fn(async (_owner, items: HomeItemRef[]) => { state.favorites = [...items]; }),
    saveDashboards: vi.fn(async (_owner, ids: string[]) => { state.dashboardIds = [...ids]; }),
    dashboardCards: vi.fn(async () => ({ ...state.dashboardCards })),
    saveDashboardCards: vi.fn(async (_owner, cards: HomeDashboardCards) => { state.dashboardCards = { ...cards }; }),
    pinnedSessions: vi.fn(async () => [...state.pinnedSessions]),
    savePinnedSessions: vi.fn(async (_owner, ids: string[]) => { state.pinnedSessions = [...ids]; }),
    pinnedObjects: vi.fn(async () => [...state.pinnedObjects]),
    savePinnedObjects: vi.fn(async (_owner, items: HomePinnedObject[]) => { state.pinnedObjects = [...items]; }),
    allFavoriteState: vi.fn(async () => ({
      favorites: [...state.favorites],
      dashboardIds: [...state.dashboardIds],
      dashboardCards: { ...state.dashboardCards },
      pinnedSessions: [...state.pinnedSessions],
      pinnedObjects: [...state.pinnedObjects],
    })),
  },
}));

vi.mock("../../ontology-model/customer-reads", () => ({
  createCustomerOntologyReadAdapter: () => ({
    record: vi.fn(async (className: string, primaryKey: string) => ({
      className,
      primaryKey,
      label: `${className} #${primaryKey}`,
      fields: {},
    })),
  }),
}));

vi.mock("../../dashboard/access", () => ({
  getOwnedDashboard: vi.fn(async (_u, _d, id: string) => state.dashboardsById[id] ?? {
    id,
    name: `Board ${id}`,
    groups: [],
  }),
}));

vi.mock("../../dashboard/metric-client", () => ({
  DashboardMetricClient: class {
    describe(metricId: string) {
      return state.metricDescribe(metricId);
    }
    execute(query: unknown, revision: number) {
      return state.metricExecute(query, revision);
    }
  },
}));

vi.mock("../../dashboard/store", () => ({
  listDashboards: vi.fn(async () => [
    { id: "dash-1", name: "Board dash-1", createdAt: new Date(), updatedAt: new Date() },
    { id: "dash-2", name: "Board dash-2", createdAt: new Date(), updatedAt: new Date() },
  ]),
}));

vi.mock("../../assistant/store", () => ({
  assistantStore: {
    session: vi.fn(async (id: string) => ({
      id,
      agent_id: "11111111-1111-4111-8111-111111111111",
      title: `Session ${id}`,
      updated_at: new Date("2026-11-25T00:00:00Z"),
    })),
    ownedSessionsByIds: vi.fn(async (_owner, ids: readonly string[]) => new Map(
      ids.map(id => [id, {
        sessionId: id,
        agentId: "11111111-1111-4111-8111-111111111111",
        agentName: "Assistant",
        title: `Session ${id}`,
        updatedAt: "2026-11-25T00:00:00.000Z",
      }]),
    )),
  },
}));

import { createFavoriteReadAdapter, favoriteServerOperations } from "../favorite-panel";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "domain-1", userId: "user-1" };
const credentials = { token: "tok", locale: "en" };
const actor = { owner, credentials };
const host: PanelOperationHost = {
  initiator: actor,
  executor: actor,
  request: vi.fn(),
  requestWorkbench: vi.fn(),
  locale: "en",
};
const adapter = createFavoriteReadAdapter(owner, credentials);
const [addOp, removeOp, moveOp] = favoriteServerOperations;

beforeEach(() => {
  state.favorites = [];
  state.dashboardIds = [];
  state.dashboardCards = {};
  state.pinnedSessions = [];
  state.pinnedObjects = [];
  state.dashboardsById = {};
  state.metricDescribe.mockReset();
  state.metricExecute.mockReset();
});

it("lists real object identities, checks status, and adds/removes/reorders across target types", async () => {
  expect(addOp.handlerRef).toBe(ADD_FAVORITE);
  expect(removeOp.handlerRef).toBe(REMOVE_FAVORITE);
  expect(moveOp.handlerRef).toBe(MOVE_FAVORITE);

  const orderTarget: PanelRecordTarget = { kind: "object", objectType: "Order", primaryKey: "ord-1" };
  const sessionA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const sessionB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  expect(await adapter.list({ targetGroup: "objects" })).toEqual([]);
  expect((await adapter.status({ object: { className: "Order", primaryKey: "ord-1" } })).outputs).toMatchObject({
    favorited: false,
    className: "Order",
    primaryKey: "ord-1",
  });

  const added = await addOp.execute(host, orderTarget as never, { title: "Order #1" }, "intent-1");
  expect(added).toMatchObject({
    kind: "success",
    data: { favorited: true },
    affected: {
      objectTypes: [FAVORITE, "Order"],
      objects: [{ objectType: "Order", primaryKey: "ord-1" }],
    },
  });

  expect((await adapter.status({ objectType: "Order", primaryKey: "ord-1" })).outputs).toMatchObject({
    favorited: true,
    className: "Order",
    primaryKey: "ord-1",
    title: "Order #1",
  });

  const objectRows = await adapter.list({ targetGroup: "objects" });
  expect(objectRows).toMatchObject([
    {
      className: "Order",
      primaryKey: "ord-1",
      label: "Order #ord-1",
      outputs: {
        favorited: true,
        openPath: "/browser/views/Order?key=ord-1&from=workspace",
        canMoveUp: false,
        canMoveDown: false,
        unavailable: false,
      },
    },
  ]);

  // Add and reorder sessions
  await addOp.execute(host, { kind: "object", objectType: AGENT_SESSION, primaryKey: sessionA } as never, {}, "intent-2");
  await addOp.execute(host, { kind: "object", objectType: AGENT_SESSION, primaryKey: sessionB } as never, {}, "intent-3");
  await moveOp.execute(host, { kind: "object", objectType: AGENT_SESSION, primaryKey: sessionB } as never, { direction: "up" }, "intent-4");
  const sessionRows = await adapter.list({ targetGroup: "sessions" });
  expect(sessionRows.map(row => row.primaryKey)).toEqual([sessionB, sessionA]);
  expect(sessionRows[0]?.className).toBe(AGENT_SESSION);
  expect(sessionRows[0]?.outputs).toMatchObject({ canMoveUp: false, canMoveDown: true });

  // Add and remove dashboard (pruning cards)
  await addOp.execute(host, { kind: "object", objectType: DASHBOARD, primaryKey: "dash-1" } as never, {}, "intent-5");
  state.dashboardCards = { "dash-1": ["card-1"] };
  await removeOp.execute(host, { kind: "object", objectType: DASHBOARD, primaryKey: "dash-1" } as never, {}, "intent-6");
  expect(state.dashboardIds).toEqual([]);
  expect(state.dashboardCards).toEqual({});

  // Remove object
  const removed = await removeOp.execute(host, orderTarget as never, {}, "intent-7");
  expect(removed).toMatchObject({
    kind: "success",
    data: { favorited: false },
    affected: { objectTypes: [FAVORITE, "Order"] },
  });
  expect((await adapter.status({ object: { className: "Order", primaryKey: "ord-1" } })).outputs).toMatchObject({
    favorited: false,
  });
  expect(await adapter.list({ targetGroup: "objects" })).toEqual([]);
});

it("executes live dashboard card previews with formatted KPI values, chart payloads, truncation, error isolation, and default cap", async () => {
  const makeMetric = (id: string, metricId: string, unit = "USD") => ({
    id,
    name: `Metric ${id}`,
    valueField: "total",
    unit,
    formats: { total: { kind: "number", decimals: 1 } },
    query: { metricId, parameters: {} },
  });
  const makeChart = (id: string, metricId: string) => ({
    id,
    name: `Chart ${id}`,
    query: { metricId, parameters: {} },
    chartFile: {
      name: `${id}.chart.json`,
      content: {
        dataset: [{ id: "metric", dimensions: ["day", "total"], source: [] }],
        series: [{ id: "main", type: "bar", datasetId: "metric", encode: { x: "day", y: "total" } }],
        ontomato: {},
      },
    },
  });

  state.dashboardIds = ["dash-live"];
  state.dashboardsById["dash-live"] = {
    id: "dash-live",
    name: "Revenue Board",
    groups: [
      {
        id: "g1",
        title: "Overview",
        metrics: [
          makeMetric("m1", "metric-ok"),
          makeMetric("m2", "metric-fail"),
          makeMetric("m3", "metric-ok"),
          makeMetric("m4", "metric-ok"),
        ],
        charts: [
          makeChart("c1", "metric-chart"),
          makeChart("c2", "metric-chart"),
          makeChart("c3", "metric-chart"),
        ],
      },
    ],
  };

  state.metricDescribe.mockImplementation(async (metricId: string) => ({
    id: metricId,
    name: metricId,
    revision: 3,
    status: "PUBLISHED",
    parameterDefs: [],
  }));
  state.metricExecute.mockImplementation(async (query: { metricId: string }) => {
    if (query.metricId === "metric-fail") {
      throw new Error("Metric engine timeout");
    }
    if (query.metricId === "metric-chart") {
      return {
        columns: [{ key: "day", label: "Day" }, { key: "total", label: "Total" }],
        rows: [{ day: "Mon", total: 42 }],
        truncation: { returnedRows: 1, totalRows: 50 },
      };
    }
    return {
      columns: [{ key: "total", label: "Total" }],
      rows: [{ total: 1234.5 }],
    };
  });

  const rows = await adapter.list({ targetGroup: "dashboardCards" });
  // Default cap without explicit dashboardCards selection: 3 metrics + 2 charts
  expect(rows.map(r => r.fields.cardId)).toEqual(["m1", "m2", "m3", "c1", "c2"]);

  // Deduplicated describe calls per unique metricId
  expect(state.metricDescribe).toHaveBeenCalledTimes(3);

  // Metric m1 formatted cleanly
  expect(rows[0]?.fields).toMatchObject({
    cardKind: "metric",
    value: "1,234.5",
    unit: "USD",
    partial: false,
  });
  expect(rows[0]?.fields.output).toMatchObject({ kind: "json" });

  // Metric m2 isolated error without failing siblings
  expect(rows[1]?.fields).toMatchObject({
    cardKind: "metric",
    error: "Metric engine timeout",
  });

  // Chart c1 carries wrapped chartFile, output, and partial truncation flag
  expect(rows[3]?.fields).toMatchObject({
    cardKind: "chart",
    partial: true,
    chartFile: { kind: "json" },
    output: { kind: "json" },
  });
});
