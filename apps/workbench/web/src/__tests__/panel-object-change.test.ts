import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import ElementPlus from "element-plus";
import { OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { countedTypesChangedKey } from "@ontomato/ontology-manager";
import { workbenchI18n } from "@ontomato/workbench-ui/i18n";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import type { DisplayObjectRefresh } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { panelAnswer,
  currentSdk, installPlatform, leaveFrame, manifestP, nothingAt, panelHostFrame, panelRecord, panelSnapshot, panelUse, SCHEDULED_TASK,
  task, type Sent,
} from "./panel-frame";

/*
 * A write the page beside a conversation hears of (U10): the page takes it in at one place, the shown instance re-reads
 * what it displays, and the Manager's counts are told which object types the write changed — the page never reads or
 * refreshes the counts itself. Real route and panel host; the counts' entry is a stand-in, which the Manager's own test
 * covers.
 *
 * What this rules out: a write that changed an ontology type and left the menu counts stale, and the counts told of a
 * change that named no types.
 */

const application = "app-panels-trial-a";
const panel = panelRecord("panel-schedules-trial", "Trial panel P", manifestP);
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panel.id, `/applications/${application}/tasks`);

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`) return Response.json({ data: {
    applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use],
  } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, undefined, request);
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  return nothingAt(request);
}

afterEach(leaveFrame);

it("tells the Manager's counts which object types a write changed, and nothing for a change that names none", async () => {
  installPlatform(answer);
  const counted: (readonly string[])[] = [];
  const refresh = ref<DisplayObjectRefresh | null>(null);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId, get objectRefresh() { return refresh.value; } }),
  }] });
  await router.push(use.path);
  const app = createApp({ render: () => h(RouterView) }).use(router).use(workbenchI18n()).use(ElementPlus);
  app.provide(countedTypesChangedKey, objectTypes => { counted.push(objectTypes); });
  app.mount(document.body.appendChild(document.createElement("div")));
  try {
    await panelHostFrame();
    const target = { objectType: SCHEDULED_TASK, primaryKey: task.id };
    refresh.value = { seq: 1, target };
    await nextTick();
    expect(counted).toEqual([]);
    const affected = { objects: [target], objectTypes: [SCHEDULED_TASK, OBJECT_TYPE] };
    refresh.value = { seq: 2, target: null, affected };
    await vi.waitFor(() => expect(counted).toEqual([affected.objectTypes]));
  } finally {
    app.unmount();
  }
});
