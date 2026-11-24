import { beforeEach, expect, it, vi } from "vitest";
import type { HomePinnedObject } from "@ontomato/contracts/platform-home";
import { ADD_FAVORITE, FAVORITE, REMOVE_FAVORITE } from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost } from "../server-operations";

const state = vi.hoisted(() => ({
  pinnedObjects: [] as HomePinnedObject[],
}));

vi.mock("../../platform-home/store", () => ({
  platformHomeStore: {
    pinnedObjects: vi.fn(async () => [...state.pinnedObjects]),
    savePinnedObjects: vi.fn(async (_owner, items: HomePinnedObject[]) => {
      state.pinnedObjects = [...items];
    }),
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
const [addOp, removeOp] = favoriteServerOperations;

beforeEach(() => {
  state.pinnedObjects = [];
});

it("lists favorites, checks favorite status by target object, and adds/removes with FAVORITE invalidation", async () => {
  expect(addOp.handlerRef).toBe(ADD_FAVORITE);
  expect(removeOp.handlerRef).toBe(REMOVE_FAVORITE);

  expect(await adapter.list()).toEqual([]);
  expect((await adapter.record({ className: "Order", primaryKey: "ord-1" })).outputs).toMatchObject({
    favorited: false,
    className: "Order",
    primaryKey: "ord-1",
    title: "",
  });

  const added = await addOp.execute(host, null as never, { className: "Order", primaryKey: "ord-1", title: "Order #1" }, "intent-1");
  expect(added).toMatchObject({
    kind: "success",
    data: { favorited: true },
    affected: {
      objectTypes: [FAVORITE],
      objects: expect.arrayContaining([
        { objectType: FAVORITE, primaryKey: JSON.stringify(["Order", "ord-1"]) },
        { objectType: "Order", primaryKey: "ord-1" },
      ]),
    },
  });

  expect((await adapter.record({ className: "Order", primaryKey: "ord-1" })).outputs).toMatchObject({
    favorited: true,
    className: "Order",
    primaryKey: "ord-1",
    title: "Order #1",
  });
  expect(await adapter.list()).toMatchObject([
    {
      className: FAVORITE,
      primaryKey: JSON.stringify(["Order", "ord-1"]),
      label: "Order #1",
      fields: { className: "Order", primaryKey: "ord-1", title: "Order #1" },
      outputs: { favorited: true },
    },
  ]);

  const removed = await removeOp.execute(host, null as never, { className: "Order", primaryKey: "ord-1" }, "intent-2");
  expect(removed).toMatchObject({
    kind: "success",
    data: { favorited: false },
    affected: { objectTypes: [FAVORITE] },
  });
  expect((await adapter.record({ className: "Order", primaryKey: "ord-1" })).outputs).toMatchObject({
    favorited: false,
  });
  expect(await adapter.list()).toEqual([]);
});
