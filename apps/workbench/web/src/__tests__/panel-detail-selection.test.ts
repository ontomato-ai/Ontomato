import { afterEach, expect, it } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { detailSelectionRoutes } from "../../../../../packages/platform-web/src/detail-selection";
import {
  currentSdk, hostMessageOf, installPlatform, leaveFrame, manifestP, mountPlatformPage, nothingAt, panelHostFrame,
  panelRecord, panelSnapshot, panelUse, SCHEDULED_TASK, task, type Sent,
} from "./panel-frame";

/*
 * A detail address once a panel has taken its page over (M4): the address a link or an answer names opens the panel at
 * its use path with that object selected, converted at the route boundary, and the panel opens on it as on any address
 * of its own. Real router, real panel route and host; the network is a stand-in.
 *
 * What this rules out: a detail address that lands on the panel with nothing selected, one that drops a draft's query on
 * the way, and one that stays in the reader's history as a page of its own.
 */

const application = "app-panels-trial-a";
const panel = panelRecord("panel-schedules-trial", "Trial panel P", manifestP);
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panel.id, `/applications/${application}/tasks`);
const selected = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };
const draft = { draftSessionId: "session-1", draftRunId: "run-1", draftPath: "/applications/app-panels-trial-a/tasks" };

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`) return Response.json({ data: {
    applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use],
  } });
  if (request.path === `/api/product-panels/${panel.id}`) return Response.json({ panel });
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel);
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  return nothingAt(request);
}

afterEach(leaveFrame);

it("opens a detail address as the panel's own address with its object selected, a draft's query kept", async () => {
  installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [
    ...detailSelectionRoutes([{
      path: `/applications/${application}/tasks/:taskId`,
      use: use.path,
      state: to => ({ selectedTask: { className: SCHEDULED_TASK, primaryKey: String(to.params.taskId) } }),
    }]),
    { path: "/home", component: { render: () => null } },
    { path: "/applications/:applicationId/:panelPath", component: PanelApplicationRoute, props: route => ({ applicationId: route.params.applicationId }) },
  ] });
  await router.push("/home");
  await router.push({ path: `/applications/${application}/tasks/${task.id}`, query: draft });
  const { app } = mountPlatformPage(() => h(RouterView), router);
  try {
    const { path, query } = router.currentRoute.value;
    expect({ path, query }).toEqual({ path: use.path, query: { ...draft, state: JSON.stringify(selected) } });
    expect(router.currentRoute.value.redirectedFrom?.path).toBe(`/applications/${application}/tasks/${task.id}`);
    // The panel opens on the selection as on any address of its own.
    expect(hostMessageOf((await panelHostFrame()).srcdoc)).toMatchObject({ pageKey: use.pageKey, state: selected });
    // The detail address is not a page of its own in the reader's history: going back leaves the panel.
    router.back();
    await new Promise(resolve => setTimeout(resolve));
    expect(router.currentRoute.value.path).toBe("/home");
  } finally {
    app.unmount();
  }
});
