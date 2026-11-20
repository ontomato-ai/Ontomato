import { afterEach, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  currentSdk, installPlatform, leaveFrame, manifestP, manifestQ, skillRefOf, mountPlatformPage, nothingAt, panelAnswer, panelRecord,
  panelSnapshot, projections, type Sent,
} from "./panel-frame";

/*
 * Which page skill a message beside a panel application's page reaches (protected provider skills contract): the host
 * reads the shown page's panel with the use relation and entrance it is shown for, and Node answers the page skill
 * context with the panel. The route passes it on as `display-skill` for the page shown, through the platform's own
 * route and panel host.
 *
 * What this rules out: a context guessed by the host (a public mode, or a member it names itself); a null member treated
 * as a failure or turned into something else; a context from a page the reader has left reaching the shown page; and a
 * failed read hidden behind a context.
 */

const app = "app-page-skill";
const p = panelRecord("panel-page-skill-p", "Tasks", manifestP);
const q = panelRecord("panel-page-skill-q", "Summary", manifestQ);
const tasks: ApplicationPanelUse = {
  id: "use-tasks", pageKey: "page-skill-tasks", panelId: p.id, path: `/applications/${app}/tasks`,
  access: { permissionCode: "analysis-agent" },
};
const summary: ApplicationPanelUse = {
  id: "use-summary", pageKey: "page-skill-summary", panelId: q.id, path: `/applications/${app}/summary`,
  access: { kind: "domain-member" },
};

/** The panel reads as they reach Node, and a way to hold one of them or answer it differently. */
let hold: Promise<void> | null = null;
let snapshotHold: Promise<void> | null = null;
let override: ((request: Sent) => Response | undefined) | null = null;

function answer(request: Sent): Response | Promise<Response> {
  const changed = override?.(request);
  if (changed) return changed;
  if (request.path === `/api/data-query/platform/applications/${app}/panel-uses`)
    return Response.json({ data: { applicationId: app, entry: { path: `/applications/${app}`, renderer: "panels" }, panelUses: [tasks, summary] } });
  if (request.path === `/api/product-panels/${p.id}`) return (hold ?? Promise.resolve()).then(() => panelAnswer(p, request));
  if (request.path === `/api/product-panels/${q.id}`) return panelAnswer(q, request);
  if (request.path === `/api/product-panels/${p.id}/snapshot`) return (snapshotHold ?? Promise.resolve()).then(() => panelSnapshot(p, projections, request));
  if (request.path === `/api/product-panels/${q.id}/snapshot`) return panelSnapshot(q, projections, request);
  if (request.path === "/api/apps-sdk/current") return currentSdk();
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

const member = (use: ApplicationPanelUse, locator: PageSkillContext["locator"]): PageSkillContext => ({
  mode: "member", locator,
  member: { source: { kind: "application-use", applicationId: app, useId: use.id }, memberPath: [], ref: skillRefOf(use.panelId) },
});
const panelReads = (sent: Sent[], panelId: string) => sent.filter(request => request.path === `/api/product-panels/${panelId}`);

afterEach(() => {
  hold = null;
  snapshotHold = null;
  override = null;
  leaveFrame();
  vi.resetModules();
});

it("reads the shown page's panel with its use relation and entrance, and passes on the context Node answers", async () => {
  const { app: page, router, sent, skills } = await openApplication(tasks.path);
  try {
    await vi.waitFor(() => expect(skills).toEqual([member(tasks, { permissionCode: "analysis-agent", pageKey: tasks.pageKey })]));
    expect(Object.fromEntries(new URLSearchParams(panelReads(sent, p.id)[0]!.search))).toEqual({
      applicationId: app, useId: tasks.id, pageKey: tasks.pageKey, permissionCode: "analysis-agent",
    });

    // A page reached by domain membership names that entrance instead.
    await router.push(summary.path);
    await vi.waitFor(() => expect(skills.at(-1)).toEqual(member(summary, { access: "domain-member", pageKey: summary.pageKey })));
    expect(Object.fromEntries(new URLSearchParams(panelReads(sent, q.id)[0]!.search))).toEqual({
      applicationId: app, useId: summary.id, pageKey: summary.pageKey, access: "domain-member",
    });

    // Back on the kept page: its check, read for this page, confirms what it reaches again; the panel is not read again.
    await router.push(tasks.path);
    await vi.waitFor(() => expect(skills).toHaveLength(3));
    expect(skills.at(-1)).toEqual(skills[0]);
    expect(panelReads(sent, p.id)).toHaveLength(1);
    const checks = sent.filter(request => request.path === `/api/product-panels/${p.id}/snapshot`);
    expect(Object.fromEntries(new URLSearchParams(checks.at(-1)!.search))).toEqual({
      applicationId: app, useId: tasks.id, pageKey: tasks.pageKey, permissionCode: "analysis-agent",
    });
  } finally {
    page.unmount();
  }
});

it("passes on a null member as Node answers it, never a public context of its own", async () => {
  const unavailable = { mode: "member", locator: { permissionCode: "analysis-agent", pageKey: tasks.pageKey }, member: null };
  override = request => {
    if (request.path === `/api/product-panels/${p.id}`) return Response.json({ panel: p, pageSkillContext: unavailable });
    if (request.path === `/api/product-panels/${p.id}/snapshot`)
      return Response.json({ panel: { id: p.id, revision: p.revision }, projections: [], pageSkillContext: unavailable });
    return undefined;
  };
  const { app: page, element, skills } = await openApplication(tasks.path);
  try {
    await vi.waitFor(() => expect(skills).toEqual([{ mode: "member", locator: { permissionCode: "analysis-agent", pageKey: tasks.pageKey }, member: null }]));
    await vi.waitFor(() => expect(element.querySelector("iframe.panel-host-frame")?.getAttribute("srcdoc")).toBeTruthy());
  } finally {
    page.unmount();
  }
});

it("passes on, for a kept page shown again, the member its check confirms now — not the null it was first answered", async () => {
  const locator = { permissionCode: "analysis-agent", pageKey: tasks.pageKey };
  let granted = false;
  override = request => {
    if (request.path === `/api/product-panels/${p.id}`)
      return Response.json({ panel: p, pageSkillContext: { mode: "member", locator, member: null } });
    if (request.path === `/api/product-panels/${p.id}/snapshot` && !granted)
      return Response.json({ panel: { id: p.id, revision: p.revision }, projections: [], pageSkillContext: { mode: "member", locator, member: null } });
    return undefined;
  };
  const { app: page, router, skills } = await openApplication(tasks.path);
  try {
    await vi.waitFor(() => expect(skills).toEqual([{ mode: "member", locator, member: null }]));
    await router.push(summary.path);
    await vi.waitFor(() => expect(skills).toHaveLength(2));
    // The Grant the member depends on is given while the page is kept, the use and the panel unchanged. Shown again,
    // nothing is passed on while its check is out; once it is through, the member it confirmed is.
    granted = true;
    let release!: () => void;
    snapshotHold = new Promise(resolve => (release = resolve));
    await router.push(tasks.path);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(skills).toHaveLength(2);
    release();
    await vi.waitFor(() => expect(skills).toHaveLength(3));
    expect(skills.at(-1)).toEqual(member(tasks, locator));
  } finally {
    page.unmount();
  }
});

it("keeps a late answer for a page the reader has left from reaching the page shown", async () => {
  let release!: () => void;
  hold = new Promise(resolve => (release = resolve));
  const { app: page, router, skills } = await openApplication(tasks.path);
  try {
    await router.push(summary.path);
    await vi.waitFor(() => expect(skills).toEqual([member(summary, { access: "domain-member", pageKey: summary.pageKey })]));
    release();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(skills).toHaveLength(1);
    // Shown again, the tasks page reaches the member its own check confirms.
    await router.push(tasks.path);
    await vi.waitFor(() => expect(skills.at(-1)).toEqual(member(tasks, { permissionCode: "analysis-agent", pageKey: tasks.pageKey })));
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
