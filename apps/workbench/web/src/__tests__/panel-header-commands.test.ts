import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, type Ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import { providePageActions, type PlatformPageActions } from "@ontomato/platform-shell";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  installPlatform, leaveFrame, manifestP, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse,
  projections, SCHEDULED_TASK, task, type Sent,
} from "./panel-frame";

/*
 * A panel page's commands in the header it is shown under (big main's ruling, 2026-11-21): the host's refresh, then the
 * panel's declared commands. A member's operations (the run button, the form's
 * save) stay where the panel draws them, and the header never shows them.
 *
 * What this rules out: a header left empty while the panel draws its own row of page commands; a header filled with every
 * operation a member publishes; a refresh that is the panel's to declare.
 */

const app = "app-header-commands";
const at = (path: string) => `/applications/${app}/${path}`;
const panel = {
  ...panelRecord("panel-header-commands", "Tasks", {
    ...manifestP,
    commands: {
      clear: { labelKey: "tasks.clear", do: { set: { fields: { selectedTask: { literal: null } } } } },
      create: { labelKey: "tasks.create", primary: true, do: { set: { fields: { selectedTask: { literal: null } } } } },
    },
  }),
};
panel.content = { ...panel.content, messages: { en: { "tasks.clear": "Clear selection", "tasks.create": "New task" } } };
const selected = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${app}/panel-uses`)
    return Response.json({ data: { applicationId: app, entry: { path: `/applications/${app}`, renderer: "panels" },
      panelUses: [panelUse("use-tasks", "header-tasks", panel.id, at("tasks"))] } });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
  const projection = Object.values(projections).find(one => request.path === `/api/product-projections/${one.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/product-panels/read")
    return Response.json({ status: "ready", value: (request.body as { dataName: string }).dataName === "rows"
      ? [{ primaryKey: task.id, label: task.title, fields: {} }] : { primaryKey: task.id, label: task.title, fields: {} } });
  return nothingAt(request);
}

afterEach(() => leaveFrame());

it("draws the host's refresh and the panel's named shortcuts in the header, and no member's operation", async () => {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(panelAddress(at("tasks"), selected));
  let header!: Readonly<Ref<PlatformPageActions | null>>;
  const { app: mounted } = mountPlatformPage(() => h(defineComponent({
    setup() {
      header = providePageActions();
      return () => h(RouterView);
    },
  })), router);
  try {
    await vi.waitFor(() => expect(header.value?.actions?.map(action => action.id)).toEqual(["refresh", "clear", "create"]));
    const [refresh, clear, create] = header.value!.actions!;
    expect(refresh).toMatchObject({ label: "Refresh", iconOnly: true });
    expect(clear).toMatchObject({ label: "Clear selection", primary: false });
    // The event the panel marks primary is the page's main action.
    expect(create).toMatchObject({ label: "New task", primary: true });

    // Refresh reads the shown data again.
    const reads = () => sent.filter(request => request.path === "/api/product-panels/read").length;
    const before = reads();
    refresh!.onClick();
    await vi.waitFor(() => expect(reads()).toBeGreaterThan(before));

    // The shortcut runs the panel's own event: the selection goes, and the address with it.
    clear!.onClick();
    await vi.waitFor(() => expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual({}));
    await nextTick();
  } finally {
    mounted.unmount();
  }
});
