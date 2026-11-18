import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { PanelFrameMessage } from "@ontomato/contracts/panel-host";
import { PANEL_HOST_CHANNEL, panelAddress } from "@ontomato/contracts/panel-host";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  hostMessageOf, inside, installPlatform, leaveFrame, manifestP, manifestQ, mountPlatformPage, nothingAt,
  panelHostFrame, panelRecord, panelUse, projections, READER, SCHEDULED_TASK, task, taskForm, writeFrameDocument,
  type Sent,
} from "./panel-frame";

const appA = "app-panels-trial-a";
const appB = "app-panels-trial-b";
const panelPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/apps-sdk/examples/panels/schedules-trial");
const p = panelRecord("panel-schedules-trial", "Trial panel P", manifestP);
const q = panelRecord("panel-schedules-summary", "Trial panel Q", manifestQ);
p.content.html = readFileSync(join(panelPath, "p/panel.html"), "utf8");
q.content.html = readFileSync(join(panelPath, "q/panel.html"), "utf8");
const useP = panelUse("use-trial-a-tasks", "panels-trial-a-tasks", p.id, "/tasks");
const useQ = panelUse("use-trial-b-summary", "panels-trial-b-summary", q.id, "/summary");
const taskPath = "/api/data-query/platform/scheduled-tasks";
const deepState = { selectedTask: { className: SCHEDULED_TASK, primaryKey: task.id } };

function answer(request: Sent) {
  const applicationId = [appA, appB].find(id => request.path === `/api/data-query/platform/applications/${id}/panel-uses`);
  if (applicationId) return Response.json({ data: {
    applicationId, entry: { path: "/", renderer: "panels" }, panelUses: [applicationId === appA ? useP : useQ],
  } });
  const panel = [p, q].find(panel => request.path === `/api/product-panels/${panel.id}`);
  if (panel) return Response.json({ panel });
  const projection = Object.values(projections).find(projection => request.path === `/api/product-projections/${projection.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/apps-sdk/current") return Response.json({
    version: "1.1.1", publicBasePath: "/apps-sdk", sdkBasePath: "/apps-sdk/1.1.1",
    manifestPath: "/apps-sdk/1.1.1/sdk.json", docsPath: "/apps-sdk/1.1.1/docs", referencePath: "/apps-sdk/1.1.1/reference",
  });
  if (request.path === "/api/product-assets/subscriptions") return Response.json({ id: "subscription-1", intervalMs: 3_600_000 });
  if (request.path === "/api/product-assets/subscriptions/subscription-1") return new Response(null, { status: 204 });
  if (request.path === taskPath) return Response.json({ tasks: [task], timeZone: task.timeZone });
  if (request.path === `${taskPath}/${task.id}`) return Response.json(task);
  if (request.path === `${taskPath}/applications/${task.appId}/form`) return Response.json(taskForm);
  return nothingAt(request);
}

async function open(address: string) {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath",
    component: PanelApplicationRoute,
    props: true,
  }] });
  await router.push(address);
  const { app, element } = mountPlatformPage(() => h(RouterView), router);
  const frame = await panelHostFrame();
  return { app, element, frame, router, sent };
}

async function startFrame(frame: HTMLIFrameElement) {
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  writeFrameDocument(hostMessageOf(frame.srcdoc));
  inside(frame.contentWindow!);
  return mountPanel({ setup: () => ({}) });
}

afterEach(() => {
  leaveFrame();
  // Each real frame starts with its own SDK modules and registries.
  vi.resetModules();
});

it("updates shared summary X from P's selection and opens the next application's panel in the same route", async () => {
  const { app, element, frame, router, sent } = await open(`/applications/${appA}/tasks`);
  try {
    const operations: PanelFrameMessage[] = [];
    const listener = (event: MessageEvent) => {
      if (event.data?.channel === PANEL_HOST_CHANNEL && event.data.kind === "operations") operations.push(event.data);
    };
    window.addEventListener("message", listener);
    try {
      await startFrame(frame);
      const option = await vi.waitFor(() => {
        const button = document.querySelector<HTMLButtonElement>('#app [role="option"]');
        expect(button?.textContent).toContain(task.title);
        return button!;
      });
      option.click();
      await vi.waitFor(() => {
        expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title);
        expect(document.querySelector(".sdk-owner-form [data-field]")).not.toBeNull();
      });
      expect(sent.filter(request => request.path === `${taskPath}/${task.id}`)).toHaveLength(2);
      expect(operations.some(message => message.kind === "operations" && message.operations.some(operation => operation.kind === "form.save"))).toBe(true);
      expect(router.currentRoute.value.query.state).toBe(JSON.stringify(deepState));

      await router.push(`/applications/${appB}/summary`);
      await vi.waitFor(() => {
        const next = element.querySelector<HTMLIFrameElement>("iframe.panel-host-frame");
        expect(next?.srcdoc).toContain(useQ.pageKey);
      });
      expect(element.querySelector('[role="alert"]')).toBeNull();
    } finally {
      window.removeEventListener("message", listener);
    }
  } finally {
    app.unmount();
  }
});

it("mounts Q at its deep-linked task and reads X over the real bridge", async () => {
  const { app, element, frame, sent } = await open(panelAddress(`/applications/${appB}/summary`, deepState));
  try {
    const { context } = await startFrame(frame);
    await vi.waitFor(() => expect(document.querySelector(".sdk-object-summary-title")?.textContent).toBe(task.title));
    expect(sent.filter(request => request.path === `${taskPath}/${task.id}`)).toMatchObject([{ method: "GET", credential: READER }]);
    expect(context.instance.deepLink()).toEqual(deepState);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  } finally {
    app.unmount();
  }
});

it("shows the script's actual error when the browser reports a generic message", async () => {
  const { app, element, frame } = await open(`/applications/${appB}/summary`);
  try {
    const bootstrap = frame.srcdoc.match(/<script>\n([\s\S]*?)<\/script>/)![1]!;
    inside(frame.contentWindow!);
    const frameEvents = new EventTarget();
    Object.assign(frameEvents, { parent: window.parent });
    new Function("window", bootstrap)(frameEvents);
    frameEvents.dispatchEvent(new ErrorEvent("error", {
      message: "Uncaught",
      error: new Error("The panel's script failed during setup"),
    }));
    await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toBe("The panel's script failed during setup"));
  } finally {
    app.unmount();
  }
});
