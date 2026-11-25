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
  getOwnedDashboard: vi.fn(async (_u, _d, id: string) => ({
    id,
    name: `Board ${id}`,
    groups: [],
  })),
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
