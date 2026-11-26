import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { PageSkillContext } from "@ontomato/contracts/page-context";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  APPLICATION_ENTRY_PATH, applicationEntryPageContext, currentSdk, installPlatform, leaveFrame, manifestP, manifestQ, mountPlatformPage, nothingAt, panelAnswer, panelRecord,
  panelSnapshot, projections, type Sent,
} from "./panel-frame";

const app = "app-page-skill";
const p = panelRecord("panel-page-skill-p", "Tasks", manifestP);
const q = panelRecord("panel-page-skill-q", "Summary", manifestQ);
const tasks: ApplicationPanelUse = {
  id: "use-tasks", pageKey: "page-skill-tasks", panelId: p.id, path: `/applications/${app}/tasks`,
};
const summary: ApplicationPanelUse = {
  id: "use-summary", pageKey: "page-skill-summary", panelId: q.id, path: `/applications/${app}/summary`,
};

/** The panel reads as they reach Node, and a way to hold one of them or answer it differently. */
let hold: Promise<void> | null = null;
let snapshotHold: Promise<void> | null = null;
let override: ((request: Sent) => Response | Promise<Response> | undefined) | null = null;

function answer(request: Sent): Response | Promise<Response> {
  const changed = override?.(request);
  if (changed) return changed;
  if (request.path === `/api/data-query/platform/applications/${app}/panel-uses`)
    return Response.json({ data: { applicationId: app, entry: { path: `/applications/${app}`, renderer: "panels" }, panelUses: [tasks, summary] } });
  if (request.path === `/api/product-panels/${p.id}`) return panelAnswer(p, request);
  if (request.path === `/api/product-panels/${q.id}`) return panelAnswer(q, request);
  if (request.path === `/api/product-panels/${p.id}/snapshot`) return (snapshotHold ?? Promise.resolve()).then(() => panelSnapshot(p, projections, request));
  if (request.path === `/api/product-panels/${q.id}/snapshot`) return panelSnapshot(q, projections, request);
  if (request.path === "/api/apps-sdk/current") return currentSdk();
  // The panel's members, as Node holds them: their projections, no data, and nothing they can do.
  const projection = Object.values(projections).find(one => request.path === `/api/product-projections/${one.id}`);
  if (projection) return Response.json({ projection });
  if (request.path === "/api/product-panels/read")
    return Response.json((request.body as { operations?: true }).operations ? { status: "ready", value: {} } : { status: "empty" });
  return nothingAt(request);
}

async function openApplication(address: string) {
  const sent = installPlatform(answer);
  const skills: PageSkillContext[] = [];
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?",
    component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId), onDisplaySkill: (context: PageSkillContext) => skills.push(context) }),
  }] });
  await router.push(address);
  const page = mountPlatformPage(() => h(RouterView), router);
  return { ...page, router, sent, skills };
}

const member = (use: ApplicationPanelUse) => applicationEntryPageContext(app, use);
const panelReads = (sent: Sent[], panelId: string) => sent.filter(request => request.path === `/api/product-panels/${panelId}`);
const openings = (sent: Sent[]) => sent.filter(request => request.path === APPLICATION_ENTRY_PATH);

function entryAnswer(use: ApplicationPanelUse, pageSkillContext = member(use)) {
  return Response.json({
    applicationId: app,
    use,
    allowStandalone: true,
    frame: null,
    content: null,
    menu: { singleEntry: false, groups: [], panelUses: [] },
    pageSkillContext,
  });
}
const asksToOpen = (request: Sent, use: ApplicationPanelUse) =>
  request.path === APPLICATION_ENTRY_PATH && new URLSearchParams(request.search).get("path") === use.path;

afterEach(() => {
  hold = null;
  snapshotHold = null;
  override = null;
  leaveFrame();
  vi.resetModules();
});

it("obtains the current page placement on opening and reads the definition and its members separately", async () => {
  const { app: page, router, sent, skills } = await openApplication(tasks.path);
  try {
    await vi.waitFor(() => expect(skills).toEqual([member(tasks)]));
    expect(Object.fromEntries(new URLSearchParams(panelReads(sent, p.id)[0]!.search))).toEqual({ includeProjections: "1", view: "1" });
    expect(openings(sent).map(request => new URLSearchParams(request.search).get("path"))).toEqual([tasks.path]);

    await router.push(summary.path);
    await vi.waitFor(() => expect(skills.at(-1)).toEqual(member(summary)));
    expect(openings(sent).map(request => new URLSearchParams(request.search).get("path"))).toEqual([tasks.path, summary.path]);

    await router.push(tasks.path);
    await vi.waitFor(() => expect(skills).toHaveLength(3));
    expect(skills.at(-1)).toEqual(skills[0]);
    expect(panelReads(sent, p.id)).toHaveLength(1);
    const checks = sent.filter(request => request.path === `/api/product-panels/${p.id}/snapshot`);
    expect(checks.at(-1)!.search).toBe("");
    expect(openings(sent).map(request => new URLSearchParams(request.search).get("path"))).toEqual([tasks.path, summary.path, tasks.path]);
  } finally {
    page.unmount();
  }
});

it("keeps a late opening response from being forwarded to another entry", async () => {
  let release!: () => void;
  hold = new Promise(resolve => (release = resolve));
  override = request => asksToOpen(request, tasks) ? hold!.then(() => entryAnswer(tasks)) : undefined;
  const { app: page, router, skills } = await openApplication(tasks.path);
  try {
    await router.push(summary.path);
    await vi.waitFor(() => expect(skills).toEqual([member(summary)]));
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(skills).toHaveLength(1);
    await router.push(tasks.path);
    await vi.waitFor(() => expect(skills.at(-1)).toEqual(member(tasks)));
  } finally {
    page.unmount();
  }
});

it("reports a failed panel read where the panel would be, with no context", async () => {
  override = request => request.path === `/api/product-panels/${p.id}`
    ? Response.json({ error: { message: "Panel use Grant required" } }, { status: 403 })
    : undefined;
  const { app: page, element, skills } = await openApplication(tasks.path);
  try {
    await vi.waitFor(() => expect(element.querySelector(".panel-host-error")?.textContent).toBe("Panel use Grant required"));
    expect(skills).toEqual([]);
  } finally {
    page.unmount();
  }
});
