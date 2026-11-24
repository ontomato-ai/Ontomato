import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import ElementPlus from "element-plus";
import { OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { workbenchI18n } from "@ontomato/workbench-ui/i18n";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import type { DisplayObjectRefresh } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import { panelAnswer,
  currentSdk, installPlatform, leaveFrame, manifestP, nothingAt, panelRecord, panelSnapshot, panelUse, SCHEDULED_TASK,
  projections, providePlatform, task, type Sent,
} from "./panel-frame";

/*
 * A write the page beside a conversation hears of (U10): the page takes it in at one place and the shown instance
 * re-reads what it displays when the affected target or object types match its bound members.
 */

const application = "app-panels-trial-a";
const panel = panelRecord("panel-schedules-trial", "Trial panel P", manifestP);
const use = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", panel.id, `/applications/${application}/tasks`);

afterEach(leaveFrame);

it("refreshes the shown panel instance when a conversation write reports matching target or affected object types", async () => {
  const reads: Sent[] = [];
  const answer = (request: Sent) => {
    if (request.path === `/api/data-query/platform/applications/${application}/panel-uses`) return Response.json({ data: {
      applicationId: application, entry: { path: "/", renderer: "panels" }, panelUses: [use],
    } });
    if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, undefined, request);
    if (request.path === "/api/apps-sdk/current") return currentSdk();
    const projection = Object.values(projections).find(one => request.path === `/api/product-projections/${one.id}`);
    if (projection) return Response.json({ projection });
    if (request.path === "/api/product-panels/read") {
      if ((request.body as { operations?: true }).operations) return Response.json({ status: "ready", value: {} });
      reads.push(request);
      return Response.json({ status: "empty" });
    }
    return nothingAt(request);
  };
  installPlatform(answer);
  const refresh = ref<DisplayObjectRefresh | null>(null);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: route.params.applicationId, get objectRefresh() { return refresh.value; } }),
  }] });
  await router.push(use.path);
  const app = providePlatform(createApp({ render: () => h(RouterView) }).use(router).use(workbenchI18n()).use(ElementPlus));
  app.mount(document.body.appendChild(document.createElement("div")));
  try {
    await vi.waitFor(() => expect(document.querySelector(".panel-host-coded > *")).not.toBeNull());
    await vi.waitFor(() => expect(reads.length).toBeGreaterThan(0));
    const initialReads = reads.length;
    const target = { objectType: SCHEDULED_TASK, primaryKey: task.id };

    // An unrelated object type does not trigger a re-read of this panel's scheduled-task member.
    refresh.value = { seq: 1, target: null, affected: { objects: [], objectTypes: [OBJECT_TYPE] } };
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads.length).toBe(initialReads);

    // A write affecting this panel's bound object type re-reads its data.
    refresh.value = { seq: 2, target: null, affected: { objects: [target], objectTypes: [SCHEDULED_TASK, OBJECT_TYPE] } };
    await vi.waitFor(() => expect(reads.length).toBeGreaterThan(initialReads));
  } finally {
    app.unmount();
  }
});
