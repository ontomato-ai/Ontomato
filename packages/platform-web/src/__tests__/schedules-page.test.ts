import { expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { workbenchApplications } from "../../../workbench-server/src/services/applications/builtins";
import { schedulePages } from "../workbench-routes";

it("publishes the scheduled task panel at the same native address and admission", async () => {
  const { entry, entryAccess, declaration } = workbenchApplications.find(app => app.id === "schedules")!;
  expect(entry).toMatchObject({ path: "/schedules", home: "/schedules" });
  expect(entryAccess).toEqual(["domain-member"]);
  expect(declaration.panelUses).toMatchObject([{
    path: "/schedules", pageKey: "schedules", panelId: "builtin-product-scheduled-tasks",
    access: { kind: "domain-member" },
    inputs: { schedulesApplication: { literal: { className: "platform:Application", primaryKey: "schedules" } } },
  }]);
  expect(schedulePages().some(route => route.path === entry.path)).toBe(false);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [...schedulePages(), { path: entry.path, component: { render: () => null } }],
  });
  await router.push("/agents/schedules?agent=3f4b0d0e-1c2a-4f6e-9a0b-2d5c8e7f1a34");
  expect(router.currentRoute.value.fullPath).toBe("/schedules?app=agents");
});
