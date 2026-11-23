import { afterEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { BundledPanelProjection, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  clearPanelDefinitionCache,
  getCachedPanel,
  getCachedProjection,
  readCachedProjection,
  setCachedPanel,
  setCachedProjection,
} from "../../../../../packages/platform-web/src/panel-definition-cache";
import { candidatePanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  pageSkillContextFor,
  panelRecord,
  panelSnapshot,
  panelUse,
  type Sent,
} from "./panel-frame";

/*
 * Revision-checked client definition cache & bundled panel reads:
 * - Cold open requests `GET /api/product-panels/:id?includeProjections=1` once and issues 0 individual
 *   `GET /api/product-projections/:id` calls for bundled fixed projections (including isolated 403/404 members).
 * - Re-entry reuses cached definitions immediately while verifying access and revisions with `snapshot`, and ALWAYS
 *   fetches business data (`POST /api/product-panels/read`) fresh from the owner (never cached).
 * - Revision bumps or revoked grants reported by `snapshot` evict stale definitions and trigger fresh reads.
 * - Unavailable (403/404) members stay mount-local so restored grants recover on re-entry.
 * - Switching user/domain/token or signing out immediately clears cached definitions; candidate previews bypass cache.
 */

const APP_ID = "app-def-cache";
const PANEL_ID = "panel-def-cache";
const PROJ_A_ID = "proj-def-cache-a";
const PROJ_B_ID = "proj-def-cache-b";

const panelManifest = definePanel({
  state: {},
  members: {
    listA: { target: { projectionId: PROJ_A_ID } },
    listB: { target: { projectionId: PROJ_B_ID } },
  },
});

function makePanel(revision = 1, banner = "Panel v1"): ProductPanel {
  const base = panelRecord(PANEL_ID, `Cached Panel v${revision}`, panelManifest);
  return {
    ...base,
    revision,
    content: {
      html: `<div id="app"><div class="banner">${banner}</div><projection slot="listA"></projection><projection slot="listB"></projection></div>`,
      module: `import { mountPanel } from "@ontomato/sdk/panel"; await mountPanel({});`,
    },
  };
}

function makeProjection(id: string, revision: number, title: string): ProductProjection {
  return {
    id,
    revision,
    name: title,
    description: "",
    domainId: "domain-1",
    ownerId: "owner-1",
    editable: false,
    visibility: "domain",
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {},
    outputs: {},
    config: {
      emptyText: title,
    },
    data: {
      rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
    },
  };
}

const useEntry = panelUse("use-cache", "cache-page", PANEL_ID, `/applications/${APP_ID}/cache`);

function openPage(answer: (request: Sent) => Response | Promise<Response>) {
  const sent = installPlatform(answer);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/applications/:applicationId/:panelPath(.*)?",
        component: PanelApplicationRoute,
        props: (route) => ({ applicationId: String(route.params.applicationId) }),
      },
      {
        path: "/other",
        component: { render: () => h("div", { class: "other-route" }, "Other") },
      },
    ],
  });
  return { sent, router };
}

function installReaderAuth(options: {
  token?: string | null;
  apiKey?: string | null;
  userId?: string;
  loginCode?: string;
  domainId?: string;
}) {
  installAuthHost({
    getToken: () => options.token ?? null,
    getApiKey: () => options.apiKey ?? null,
    getUserInfo: () =>
      options.userId || options.loginCode || options.domainId
        ? { userId: options.userId, loginCode: options.loginCode, domainId: options.domainId }
        : null,
    responseStatusError: () => null,
    verifySessionOnce: async () => "valid",
    handleAuthExpired: () => {},
  });
}

afterEach(() => {
  clearPanelDefinitionCache();
  leaveFrame();
});

describe("panel definition cache & bundled projections", () => {
  it("cold open bundles fixed projections in 1 panel request (0 individual projection GETs), isolates 403, and re-entry reuses cached definitions while always fetching fresh business data", async () => {
    const panel = makePanel(1, "Panel v1");
    const projA = makeProjection(PROJ_A_ID, 1, "Tasks A v1");
    let dataGeneration = 1;
    let projBAllowed = false;
    const projB = makeProjection(PROJ_B_ID, 1, "Tasks B v1");

    const answer = (request: Sent): Response => {
      if (request.path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
        return Response.json({
          data: { applicationId: APP_ID, entry: { path: `/applications/${APP_ID}`, renderer: "panels" }, panelUses: [useEntry] },
        });
      }
      if (request.path === `/api/product-panels/${PANEL_ID}`) {
        const query = new URLSearchParams(request.search);
        const pageSkillContext = pageSkillContextFor(panel, request);
        const projections: Record<string, BundledPanelProjection> | undefined =
          query.get("includeProjections") === "1"
            ? {
                [PROJ_A_ID]: { status: "ready", projection: projA },
                [PROJ_B_ID]: projBAllowed
                  ? { status: "ready", projection: projB }
                  : { status: "unavailable", httpStatus: 403, message: "No access to projection B" },
              }
            : undefined;
        return Response.json({ panel, ...(pageSkillContext && { pageSkillContext }), ...(projections && { projections }) });
      }
      if (request.path === `/api/product-panels/${PANEL_ID}/snapshot`) {
        const pageSkillContext = pageSkillContextFor(panel, request);
        return Response.json({
          panel: { id: panel.id, revision: panel.revision },
          projections: projBAllowed
            ? [{ id: PROJ_A_ID, revision: projA.revision }, { id: PROJ_B_ID, revision: projB.revision }]
            : [{ id: PROJ_A_ID, revision: projA.revision }],
          members: [
            { status: "ready", memberPath: [{ member: "listA" }], target: { kind: "projection", id: PROJ_A_ID }, revision: projA.revision },
            projBAllowed
              ? { status: "ready", memberPath: [{ member: "listB" }], target: { kind: "projection", id: PROJ_B_ID }, revision: projB.revision }
              : { status: "forbidden", memberPath: [{ member: "listB" }] },
          ],
          ...(pageSkillContext && { pageSkillContext }),
        });
      }
      if (request.path === `/api/product-projections/${PROJ_A_ID}`) {
        return Response.json({ projection: projA });
      }
      if (request.path === `/api/product-projections/${PROJ_B_ID}`) {
        return projBAllowed
          ? Response.json({ projection: projB })
          : Response.json({ error: { code: "FORBIDDEN", message: "No access to projection B" } }, { status: 403 });
      }
      if (request.path === "/api/product-panels/read") {
        const body = request.body as { operations?: true; memberPath: Array<{ member: string }> };
        if (body.operations) return Response.json({ status: "ready", value: {} });
        const member = body.memberPath[0]?.member;
        return Response.json({
          status: "ready",
          value: [{
            primaryKey: `${member}-${dataGeneration}`,
            label: `Row ${member} gen ${dataGeneration}`,
            fields: {},
          }],
        });
      }
      return nothingAt(request);
    };

    const { sent, router } = openPage(answer);
    await router.push(useEntry.path);
    const first = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(first.element.textContent).toContain("Row listA gen 1"));
      expect(first.element.textContent).toContain("Panel v1");
      // Bundled cold open: 1 panel GET with includeProjections=1, 0 individual GET /api/product-projections/:id.
      const panelGets = sent.filter((r) => r.path === `/api/product-panels/${PANEL_ID}`);
      expect(panelGets).toHaveLength(1);
      expect(panelGets[0]!.search).toContain("includeProjections=1");
      // Initial mount uses bundled ready + bundled unavailable without separate projection GETs (until snapshot forbids listB and triggers re-read).
      const projAGets = sent.filter((r) => r.path === `/api/product-projections/${PROJ_A_ID}`);
      expect(projAGets).toHaveLength(0);
    } finally {
      first.app.unmount();
    }

    // Restore access to projection B and advance business data generation before re-entry.
    projBAllowed = true;
    dataGeneration = 2;
    const panelGetsBeforeReentry = sent.filter((r) => r.path === `/api/product-panels/${PANEL_ID}`).length;
    const projAGetsBeforeReentry = sent.filter((r) => r.path === `/api/product-projections/${PROJ_A_ID}`).length;
    const dataReadsBeforeReentry = sent.filter((r) => r.path === "/api/product-panels/read").length;

    const second = mountPlatformPage(() => h(RouterView), router);
    try {
      // Re-entry shows fresh business data (gen 2) and recovers projection B (since 403 was mount-local, not cached).
      await vi.waitFor(() => expect(second.element.textContent).toContain("Row listA gen 2"));
      await vi.waitFor(() => expect(second.element.textContent).toContain("Row listB gen 2"));
      // Cached panel and projection A were reused without refetching their definitions.
      expect(sent.filter((r) => r.path === `/api/product-panels/${PANEL_ID}`)).toHaveLength(panelGetsBeforeReentry);
      expect(sent.filter((r) => r.path === `/api/product-projections/${PROJ_A_ID}`)).toHaveLength(projAGetsBeforeReentry);
      // Projection B was not cached while unavailable, so it was fetched on re-entry once access returned.
      expect(sent.filter((r) => r.path === `/api/product-projections/${PROJ_B_ID}`).length).toBeGreaterThanOrEqual(1);
      // Business data was freshly read on re-entry (never served from cache).
      expect(sent.filter((r) => r.path === "/api/product-panels/read").length).toBeGreaterThan(dataReadsBeforeReentry);
    } finally {
      second.app.unmount();
    }
  });

  it("evicts and refetches a cached projection or panel when snapshot reports a newer revision on re-entry", async () => {
    let currentPanel = makePanel(1, "Banner v1");
    let currentProjA = makeProjection(PROJ_A_ID, 1, "Title A v1");
    const currentProjB = makeProjection(PROJ_B_ID, 1, "Title B v1");

    const answer = (request: Sent): Response => {
      if (request.path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
        return Response.json({
          data: { applicationId: APP_ID, entry: { path: `/applications/${APP_ID}`, renderer: "panels" }, panelUses: [useEntry] },
        });
      }
      if (request.path === `/api/product-panels/${PANEL_ID}`) {
        const query = new URLSearchParams(request.search);
        const pageSkillContext = pageSkillContextFor(currentPanel, request);
        const projections: Record<string, BundledPanelProjection> | undefined =
          query.get("includeProjections") === "1"
            ? {
                [PROJ_A_ID]: { status: "ready", projection: currentProjA },
                [PROJ_B_ID]: { status: "ready", projection: currentProjB },
              }
            : undefined;
        return Response.json({ panel: currentPanel, ...(pageSkillContext && { pageSkillContext }), ...(projections && { projections }) });
      }
      if (request.path === `/api/product-panels/${PANEL_ID}/snapshot`) {
        return panelSnapshot(currentPanel, { [PROJ_A_ID]: currentProjA, [PROJ_B_ID]: currentProjB }, request);
      }
      if (request.path === `/api/product-projections/${PROJ_A_ID}`) {
        return Response.json({ projection: currentProjA });
      }
      if (request.path === `/api/product-projections/${PROJ_B_ID}`) {
        return Response.json({ projection: currentProjB });
      }
      if (request.path === "/api/product-panels/read") {
        const body = request.body as { operations?: true };
        return Response.json(body.operations ? { status: "ready", value: {} } : { status: "ready", value: [] });
      }
      return nothingAt(request);
    };

    const { sent, router } = openPage(answer);
    await router.push(useEntry.path);

    // 1. Cold open populates cache at revision 1.
    const first = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(first.element.textContent).toContain("Banner v1"));
      await vi.waitFor(() => expect(first.element.textContent).toContain("Title A v1"));
    } finally {
      first.app.unmount();
    }

    // 2. Bump projection A to revision 2 (panel stays at revision 1).
    currentProjA = makeProjection(PROJ_A_ID, 2, "Title A v2");
    const second = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(second.element.textContent).toContain("Title A v2"));
      expect(sent.filter((r) => r.path === `/api/product-projections/${PROJ_A_ID}`)).toHaveLength(1);
      expect(getCachedProjection(PROJ_A_ID)?.projection.revision).toBe(2);
    } finally {
      second.app.unmount();
    }

    // 3. Bump panel itself to revision 2.
    currentPanel = makePanel(2, "Banner v2");
    const third = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(third.element.textContent).toContain("Banner v2"));
      expect(getCachedPanel(PANEL_ID)?.revision).toBe(2);
    } finally {
      third.app.unmount();
    }
  });

  it("evicts cached projection or panel when snapshot reports revoked access (403) on re-entry", async () => {
    const currentPanel = makePanel(1, "Banner v1");
    const currentProjA = makeProjection(PROJ_A_ID, 1, "Title A v1");
    const currentProjB = makeProjection(PROJ_B_ID, 1, "Title B v1");
    let projARevoked = false;
    let panelRevoked = false;

    const answer = (request: Sent): Response => {
      if (request.path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
        return Response.json({
          data: { applicationId: APP_ID, entry: { path: `/applications/${APP_ID}`, renderer: "panels" }, panelUses: [useEntry] },
        });
      }
      if (request.path === `/api/product-panels/${PANEL_ID}`) {
        if (panelRevoked) {
          return Response.json({ error: { code: "FORBIDDEN", message: "Panel access revoked" } }, { status: 403 });
        }
        const pageSkillContext = pageSkillContextFor(currentPanel, request);
        return Response.json({
          panel: currentPanel,
          ...(pageSkillContext && { pageSkillContext }),
          projections: {
            [PROJ_A_ID]: { status: "ready", projection: currentProjA },
            [PROJ_B_ID]: { status: "ready", projection: currentProjB },
          },
        });
      }
      if (request.path === `/api/product-panels/${PANEL_ID}/snapshot`) {
        if (panelRevoked) {
          return Response.json({ error: { code: "FORBIDDEN", message: "Panel access revoked" } }, { status: 403 });
        }
        const pageSkillContext = pageSkillContextFor(currentPanel, request);
        return Response.json({
          panel: { id: currentPanel.id, revision: currentPanel.revision },
          projections: projARevoked
            ? [{ id: PROJ_B_ID, revision: currentProjB.revision }]
            : [{ id: PROJ_A_ID, revision: currentProjA.revision }, { id: PROJ_B_ID, revision: currentProjB.revision }],
          members: [
            projARevoked
              ? { status: "forbidden", memberPath: [{ member: "listA" }] }
              : { status: "ready", memberPath: [{ member: "listA" }], target: { kind: "projection", id: PROJ_A_ID }, revision: currentProjA.revision },
            { status: "ready", memberPath: [{ member: "listB" }], target: { kind: "projection", id: PROJ_B_ID }, revision: currentProjB.revision },
          ],
          ...(pageSkillContext && { pageSkillContext }),
        });
      }
      if (request.path === `/api/product-projections/${PROJ_A_ID}`) {
        return projARevoked
          ? Response.json({ error: { code: "FORBIDDEN", message: "Projection A revoked" } }, { status: 403 })
          : Response.json({ projection: currentProjA });
      }
      if (request.path === `/api/product-projections/${PROJ_B_ID}`) {
        return Response.json({ projection: currentProjB });
      }
      if (request.path === "/api/product-panels/read") {
        const body = request.body as { operations?: true };
        return Response.json(body.operations ? { status: "ready", value: {} } : { status: "ready", value: [] });
      }
      return nothingAt(request);
    };

    const { sent, router } = openPage(answer);
    await router.push(useEntry.path);

    // 1. Cold open caches panel + both projections.
    const first = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(first.element.textContent).toContain("Title A v1"));
      expect(getCachedProjection(PROJ_A_ID)).toBeDefined();
    } finally {
      first.app.unmount();
    }

    // 2. Revoke projection A: pre-mount snapshot reports listA forbidden -> cache evicted & recorded in mountUnavailable
    // so listA renders 403 immediately without flashing Title A v1 or issuing an extra projection GET.
    projARevoked = true;
    const second = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(second.element.textContent).toContain("Title B v1"));
      expect(getCachedProjection(PROJ_A_ID)).toBeUndefined();
      expect(second.element.textContent).not.toContain("Title A v1");
      expect(sent.filter((r) => r.path === `/api/product-projections/${PROJ_A_ID}`)).toHaveLength(0);
    } finally {
      second.app.unmount();
    }

    // 3. Revoke panel itself: pre-mount snapshot returns 403 -> panel cache evicted, never mounts, and error reported.
    panelRevoked = true;
    const readsBeforeRevoked = sent.filter((r) => r.path === "/api/product-panels/read").length;
    const third = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(getCachedPanel(PANEL_ID)).toBeUndefined());
      await vi.waitFor(() => expect(third.element.textContent).toContain("Panel access revoked"));
      expect(third.element.textContent).not.toContain("Banner v1");
      expect(sent.filter((r) => r.path === "/api/product-panels/read")).toHaveLength(readsBeforeRevoked);
    } finally {
      third.app.unmount();
    }
  });

  it("verifies cached panels before mounting: lightweight snapshot on match, direct refetch on upgrade without mounting stale v1, and no mount on 403", async () => {
    let currentPanel = makePanel(1, "Banner v1");
    const currentProjA = makeProjection(PROJ_A_ID, 1, "Title A v1");
    const currentProjB = makeProjection(PROJ_B_ID, 1, "Title B v1");
    let panelRevoked = false;

    const answer = (request: Sent): Response => {
      if (request.path === `/api/data-query/platform/applications/${APP_ID}/panel-uses`) {
        return Response.json({
          data: { applicationId: APP_ID, entry: { path: `/applications/${APP_ID}`, renderer: "panels" }, panelUses: [useEntry] },
        });
      }
      if (request.path === `/api/product-panels/${PANEL_ID}`) {
        const query = new URLSearchParams(request.search);
        const pageSkillContext = pageSkillContextFor(currentPanel, request);
        const projections: Record<string, BundledPanelProjection> | undefined =
          query.get("includeProjections") === "1"
            ? {
                [PROJ_A_ID]: { status: "ready", projection: currentProjA },
                [PROJ_B_ID]: { status: "ready", projection: currentProjB },
              }
            : undefined;
        return Response.json({ panel: currentPanel, ...(pageSkillContext && { pageSkillContext }), ...(projections && { projections }) });
      }
      if (request.path === `/api/product-panels/${PANEL_ID}/snapshot`) {
        if (panelRevoked) {
          return Response.json({ error: { code: "FORBIDDEN", message: "Panel revoked before mount" } }, { status: 403 });
        }
        return panelSnapshot(currentPanel, { [PROJ_A_ID]: currentProjA, [PROJ_B_ID]: currentProjB }, request);
      }
      if (request.path === `/api/product-projections/${PROJ_A_ID}`) return Response.json({ projection: currentProjA });
      if (request.path === `/api/product-projections/${PROJ_B_ID}`) return Response.json({ projection: currentProjB });
      if (request.path === "/api/product-panels/read") {
        const body = request.body as { operations?: true };
        return Response.json(body.operations ? { status: "ready", value: {} } : { status: "ready", value: [] });
      }
      return nothingAt(request);
    };

    const { sent, router } = openPage(answer);
    await router.push(useEntry.path);

    // Warm the cache on cold open (revision 1).
    const warm = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(warm.element.textContent).toContain("Title A v1"));
      expect(getCachedPanel(PANEL_ID)?.revision).toBe(1);
    } finally {
      warm.app.unmount();
    }

    // 1. Cache hit with matching revision: exactly 1 lightweight /snapshot (without applicationId), 0 panel GETs, 0 projection GETs.
    sent.length = 0;
    const hit = mountPlatformPage(() => h(RouterView), router);
    try {
      await vi.waitFor(() => expect(hit.element.textContent).toContain("Banner v1"));
      await vi.waitFor(() => expect(hit.element.textContent).toContain("Title A v1"));
      await vi.waitFor(() => expect(hit.element.textContent).toContain("Title B v1"));
      // Let any stray post-mount microtasks settle before asserting request counts.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const snapshots = sent.filter((r) => r.path === `/api/product-panels/${PANEL_ID}/snapshot`);
      expect(snapshots).toHaveLength(1);
      expect(new URLSearchParams(snapshots[0]!.search).has("applicationId")).toBe(false);
      expect(snapshots[0]!.search).toBe("");
      expect(sent.filter((r) => r.path === `/api/product-panels/${PANEL_ID}`)).toHaveLength(0);
      expect(sent.filter((r) => r.path.startsWith("/api/product-projections/"))).toHaveLength(0);
    } finally {
      hit.app.unmount();
    }

    // 2. Cache hit when snapshot reports a newer panel revision (v2): never mounts stale v1 first; fetches v2 bundle directly.
    currentPanel = makePanel(2, "Banner v2");
    sent.length = 0;
    const seenBanners: string[] = [];
    const upgraded = mountPlatformPage(() => h(RouterView), router);
    const observer = new MutationObserver(() => {
      const banner = upgraded.element.querySelector(".banner")?.textContent;
      if (banner) seenBanners.push(banner);
    });
    observer.observe(upgraded.element, { childList: true, subtree: true, characterData: true });
    try {
      await vi.waitFor(() => expect(upgraded.element.textContent).toContain("Banner v2"));
      expect(seenBanners).not.toContain("Banner v1");
      expect(getCachedPanel(PANEL_ID)?.revision).toBe(2);
      const panelGets = sent.filter((r) => r.path === `/api/product-panels/${PANEL_ID}`);
      expect(panelGets).toHaveLength(1);
      expect(panelGets[0]!.search).toBe("?includeProjections=1");
      expect(sent.filter((r) => r.path === `/api/product-panels/${PANEL_ID}/snapshot`)).toHaveLength(1);
    } finally {
      observer.disconnect();
      upgraded.app.unmount();
    }

    // 3. Cache hit when snapshot returns 403: never mounts cached v2, evicts cache, sends 0 data reads, reports error.
    panelRevoked = true;
    sent.length = 0;
    const revokedSeenBanners: string[] = [];
    const revoked = mountPlatformPage(() => h(RouterView), router);
    const revokedObserver = new MutationObserver(() => {
      const banner = revoked.element.querySelector(".banner")?.textContent;
      if (banner) revokedSeenBanners.push(banner);
    });
    revokedObserver.observe(revoked.element, { childList: true, subtree: true, characterData: true });
    try {
      await vi.waitFor(() => expect(revoked.element.textContent).toContain("Panel revoked before mount"));
      expect(getCachedPanel(PANEL_ID)).toBeUndefined();
      expect(revokedSeenBanners).toEqual([]);
      expect(revoked.element.querySelector(".panel-host-coded > *")).toBeNull();
      expect(sent.filter((r) => r.path === "/api/product-panels/read")).toHaveLength(0);
    } finally {
      revokedObserver.disconnect();
      revoked.app.unmount();
    }
  });

  it("isolates and clears cached definitions across auth user/domain switches and logout", () => {
    const panel = makePanel(1);
    const projA = makeProjection(PROJ_A_ID, 1, "Tasks A");

    installReaderAuth({ token: "tok-1", userId: "u-1", domainId: "d-1" });
    setCachedPanel(PANEL_ID, panel);
    setCachedProjection({ projection: projA });
    expect(getCachedPanel(PANEL_ID)?.id).toBe(PANEL_ID);
    expect(getCachedProjection(PROJ_A_ID)?.projection.id).toBe(PROJ_A_ID);

    // Switching domain clears cache immediately.
    let currentDomain = "d-1";
    let currentToken: string | null = "tok-1";
    let currentUserId = "u-1";
    installAuthHost({
      getToken: () => currentToken,
      getApiKey: () => null,
      getUserInfo: () => ({ userId: currentUserId, domainId: currentDomain }),
      responseStatusError: () => null,
      verifySessionOnce: async () => "valid",
      handleAuthExpired: () => {},
    });
    // New auth host instance already isolated from prior host.
    expect(getCachedPanel(PANEL_ID)).toBeUndefined();

    setCachedPanel(PANEL_ID, panel);
    setCachedProjection({ projection: projA });
    expect(getCachedPanel(PANEL_ID)?.id).toBe(PANEL_ID);

    // Same auth host, domain changes -> cache cleared.
    currentDomain = "d-2";
    expect(getCachedPanel(PANEL_ID)).toBeUndefined();
    expect(getCachedProjection(PROJ_A_ID)).toBeUndefined();

    setCachedPanel(PANEL_ID, panel);
    // Same auth host, user changes -> cache cleared.
    currentUserId = "u-2";
    expect(getCachedPanel(PANEL_ID)).toBeUndefined();

    setCachedPanel(PANEL_ID, panel);
    // Logout (token becomes null) -> cache cleared.
    currentToken = null;
    expect(getCachedPanel(PANEL_ID)).toBeUndefined();
  });

  it("deduplicates concurrent in-flight projection reads and never caches failures", async () => {
    installReaderAuth({ token: "tok-dedup", userId: "u-1", domainId: "d-1" });
    const projA = makeProjection(PROJ_A_ID, 1, "Dedup A");

    let resolveFirst!: (value: { projection: ProductProjection }) => void;
    const fetcher = vi.fn(() => new Promise<{ projection: ProductProjection }>((resolve) => {
      resolveFirst = resolve;
    }));

    const p1 = readCachedProjection(PROJ_A_ID, fetcher);
    const p2 = readCachedProjection(PROJ_A_ID, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveFirst({ projection: projA });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.projection.id).toBe(PROJ_A_ID);
    expect(r2.projection.id).toBe(PROJ_A_ID);

    // Failures are never cached: a subsequent call retries.
    const failing = vi.fn().mockRejectedValueOnce(new Error("Transient 500")).mockResolvedValueOnce({ projection: makeProjection(PROJ_B_ID, 1, "Recovered B") });
    await expect(readCachedProjection(PROJ_B_ID, failing)).rejects.toThrow("Transient 500");
    expect(getCachedProjection(PROJ_B_ID)).toBeUndefined();
    const recovered = await readCachedProjection(PROJ_B_ID, failing);
    expect(recovered.projection.id).toBe(PROJ_B_ID);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("candidatePanelHost never reads or writes the definition cache", async () => {
    const panel = makePanel(1, "Candidate Panel");
    const sent = installPlatform((request) => {
      if (request.path === `/api/product-panels/${PANEL_ID}`) return Response.json({ panel });
      return nothingAt(request);
    });
    const host = candidatePanelHost({ id: "ws-1", ref: "candidate-1", pageKey: "preview" });
    const loaded = await host.panel(PANEL_ID);
    expect(loaded.id).toBe(PANEL_ID);
    expect(sent.filter((r) => r.path === `/api/product-panels/${PANEL_ID}`)).toHaveLength(1);
    expect(getCachedPanel(PANEL_ID)).toBeUndefined();
  });
});
