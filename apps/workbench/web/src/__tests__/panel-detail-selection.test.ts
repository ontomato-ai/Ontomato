import { afterEach, expect, it } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView, type RouteLocation } from "vue-router";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { detailSelectionRoutes, querySelectionGuard } from "../../../../../packages/platform-web/src/detail-selection";
import {
  currentSdk, hostMessageOf, installPlatform, leaveFrame, manifestP, mountPlatformPage, nothingAt, panelHostFrame,
  panelRecord, panelSnapshot, panelUse, SCHEDULED_TASK, task, type Sent,
} from "./panel-frame";

/*
 * A detail address once a panel has taken its page over (M4's table): the address a link or an answer names opens the
 * panel at its use path with that object selected, converted at the route boundary, and the panel opens on it as on any
 * address of its own. Both shapes: a detail address of its own (`/ontology/objects/:className`), and the panel's own
 * path naming the selection in its query (modelling's `?focus=&id=`). Real router, real panel route and host; the
 * network is a stand-in.
 *
 * What this rules out: a detail address that lands on the panel with nothing selected; one that drops a draft's query,
 * or carries the old page's own parameters (`from`, `back`) onto the panel; one that stays in the reader's history as a
 * page of its own; and a deeper page under the detail address (M2's `/:className/view`) taken for a detail address.
 */

const application = "app-panels-trial-a";
const panel = panelRecord("panel-schedules-trial", "Trial panel P", manifestP);
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panel.id, `/applications/${application}/tasks`);
const selected = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };
const draft = { draftSessionId: "session-1", draftRunId: "run-1", draftPath: use.path };
const selectedBy = (key: string) => ({ selectedTask: { className: SCHEDULED_TASK, primaryKey: key } });

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`) return Response.json({ data: {
    applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use],
  } });
  if (request.path === `/api/product-panels/${panel.id}`) return Response.json({ panel });
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel);
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  return nothingAt(request);
}

async function open(address: { path: string; query: Record<string, string> }) {
  installPlatform(answer);
  const deeper = { render: () => h("p", "view editor") };
  const router = createRouter({ history: createMemoryHistory(), routes: [
    ...detailSelectionRoutes([{
      path: `/applications/${application}/tasks/:taskId`,
      use: use.path,
      state: to => selectedBy(String(to.params.taskId)),
    }]),
    { path: `/applications/${application}/tasks/:taskId/view`, component: deeper },
    { path: "/home", component: { render: () => null } },
    { path: "/applications/:applicationId/:panelPath", component: PanelApplicationRoute, props: route => ({ applicationId: route.params.applicationId }) },
  ] });
  router.beforeEach(querySelectionGuard([{
    use: use.path,
    state: (to: RouteLocation) => to.query.focus === "task" && typeof to.query.id === "string" ? selectedBy(to.query.id) : null,
  }]));
  await router.push("/home");
  await router.push(address);
  const { app } = mountPlatformPage(() => h(RouterView), router);
  return { app, router };
}

async function expectPanelSelected(router: Awaited<ReturnType<typeof open>>["router"]) {
  const { path, query } = router.currentRoute.value;
  expect({ path, query }).toEqual({ path: use.path, query: { ...draft, state: JSON.stringify(selected) } });
  // The panel opens on the selection as on any address of its own.
  expect(hostMessageOf((await panelHostFrame()).srcdoc)).toMatchObject({ pageKey: use.pageKey, state: selected });
  // The detail address is not a page of its own in the reader's history: going back leaves the panel.
  router.back();
  await new Promise(resolve => setTimeout(resolve));
  expect(router.currentRoute.value.path).toBe("/home");
}

afterEach(leaveFrame);

it("opens a detail address of its own as the panel's address with its object selected, a draft's query kept", async () => {
  const { app, router } = await open({ path: `/applications/${application}/tasks/${task.id}`, query: { ...draft, from: "graph" } });
  try {
    expect(router.currentRoute.value.redirectedFrom?.path).toBe(`/applications/${application}/tasks/${task.id}`);
    await expectPanelSelected(router);
  } finally {
    app.unmount();
  }
});

it("opens the panel's own path naming a selection in its query with that object selected", async () => {
  const { app, router } = await open({ path: use.path, query: { focus: "task", id: task.id, back: "playground", ...draft } });
  try {
    await expectPanelSelected(router);
  } finally {
    app.unmount();
  }
});

it("leaves a deeper page under a detail address, and the panel's own address selecting nothing, as they are", async () => {
  const deeper = await open({ path: `/applications/${application}/tasks/${task.id}/view`, query: {} });
  try {
    expect(deeper.router.currentRoute.value.path).toBe(`/applications/${application}/tasks/${task.id}/view`);
  } finally {
    deeper.app.unmount();
  }
  const plain = await open({ path: use.path, query: draft });
  try {
    expect(plain.router.currentRoute.value.query).toEqual(draft);
  } finally {
    plain.app.unmount();
  }
});
