import { beforeEach, expect, it, vi } from "vitest";
import type { HomeItemRef } from "@ontomato/contracts/platform-home";

const storeState = vi.hoisted(() => ({
  favorites: [] as HomeItemRef[],
  dashboardIds: [] as string[],
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
    recentApplications: vi.fn(async () => []),
  },
}));
vi.mock("../../assistant/store", () => ({
  assistantStore: { recentConversations: async () => [] },
}));

import { addHomeFavorite, readHome, removeHomeFavorite, saveDashboards, saveFavorites } from "../service";

beforeEach(() => {
  storeState.favorites = [{ kind: "application", id: "ontology" }];
  storeState.dashboardIds = ["board-1"];
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
