import { beforeEach, expect, it, vi } from "vitest";
import type { HomeItemRef, HomePinnedObject } from "@ontomato/contracts/platform-home";

const storeState = vi.hoisted(() => ({
  favorites: [] as HomeItemRef[],
  dashboardIds: [] as string[],
  pinnedObjects: [] as HomePinnedObject[],
}));

vi.mock("../store", () => ({
  platformHomeStore: {
    preferences: vi.fn(async () => ({
      favorites: [...storeState.favorites],
      dashboardIds: [...storeState.dashboardIds],
    })),
    saveFavorites: vi.fn(async (_owner, items: HomeItemRef[]) => {
      storeState.favorites = [...items];
    }),
    saveDashboards: vi.fn(async (_owner, ids: string[]) => {
      storeState.dashboardIds = [...ids];
    }),
    pinnedObjects: vi.fn(async () => [...storeState.pinnedObjects]),
    savePinnedObjects: vi.fn(async (_owner, items: HomePinnedObject[]) => {
      storeState.pinnedObjects = [...items];
    }),
    recentApplications: vi.fn(async () => []),
  },
}));
vi.mock("../../assistant/store", () => ({
  assistantStore: { recentConversations: async () => [] },
}));

import {
  addHomeFavorite, addPinnedObject, readHome, readPinnedObjects, removeHomeFavorite, removePinnedObject,
  saveDashboards, saveFavorites, savePinnedObjects,
} from "../service";

beforeEach(() => {
  storeState.favorites = [{ kind: "application", id: "ontology" }];
  storeState.dashboardIds = ["board-1"];
  storeState.pinnedObjects = [];
});

it("reads and writes personal favorites and dashboards directly in platformHomeStore without touching legacy assets", async () => {
  const owner = { domainId: "domain", userId: "reader" };
  expect((await readHome(owner)).favorites).toEqual([{ kind: "application", id: "ontology" }]);

  await addHomeFavorite(owner, { kind: "application", id: "dashboards" });
  // Adding an already pinned item is idempotent and preserves order.
  await addHomeFavorite(owner, { kind: "application", id: "ontology" });
  expect((await readHome(owner)).favorites).toEqual([
    { kind: "application", id: "ontology" },
    { kind: "application", id: "dashboards" },
  ]);

  await removeHomeFavorite(owner, { kind: "application", id: "ontology" });
  // Removing an absent item is idempotent.
  await removeHomeFavorite(owner, { kind: "application", id: "ontology" });
  expect((await readHome(owner)).favorites).toEqual([{ kind: "application", id: "dashboards" }]);

  await saveFavorites(owner, [{ kind: "application", id: "schedules" }]);
  await saveDashboards(owner, ["board-2"]);
  expect(await readHome(owner)).toMatchObject({
    favorites: [{ kind: "application", id: "schedules" }],
    dashboardIds: ["board-2"],
  });
});

it("manages pinned objects deduplicated by className + primaryKey in platformHomeStore", async () => {
  const owner = { domainId: "domain", userId: "reader" };
  expect(await readPinnedObjects(owner)).toEqual([]);

  await addPinnedObject(owner, { className: "Order", primaryKey: "ord-1", title: "Order #1" });
  await addPinnedObject(owner, { className: "Order", primaryKey: "ord-1", title: "Order #1" });
  await addPinnedObject(owner, { className: "Customer", primaryKey: "cust-1", title: "Acme" });
  expect(await readPinnedObjects(owner)).toEqual([
    { className: "Order", primaryKey: "ord-1", title: "Order #1" },
    { className: "Customer", primaryKey: "cust-1", title: "Acme" },
  ]);

  await addPinnedObject(owner, { className: "Order", primaryKey: "ord-1", title: "Order #1 Updated" });
  expect(await readPinnedObjects(owner)).toEqual([
    { className: "Order", primaryKey: "ord-1", title: "Order #1 Updated" },
    { className: "Customer", primaryKey: "cust-1", title: "Acme" },
  ]);

  await removePinnedObject(owner, { className: "Order", primaryKey: "ord-1" });
  await removePinnedObject(owner, { className: "Order", primaryKey: "ord-1" });
  expect(await readPinnedObjects(owner)).toEqual([
    { className: "Customer", primaryKey: "cust-1", title: "Acme" },
  ]);

  await savePinnedObjects(owner, [
    { className: "Order", primaryKey: "ord-2", title: "Order #2" },
    { className: "Order", primaryKey: "ord-2", title: "Duplicate" },
  ]);
  expect(await readPinnedObjects(owner)).toEqual([
    { className: "Order", primaryKey: "ord-2", title: "Order #2" },
  ]);
});
