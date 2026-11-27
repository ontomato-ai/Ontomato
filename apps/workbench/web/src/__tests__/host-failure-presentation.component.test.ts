import { afterEach, expect, it, vi } from "vitest";
import { computed, defineComponent, h, provide, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { isApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { platformHostKey, type PlatformPageHost } from "@ontomato/platform-admin";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { PlatformShellLayout, platformLayoutRoute, unknownAddressRoute } from "@ontomato/platform-web";
import { registerPlatformRoutes } from "../../../../../packages/platform-web/src/layout-route";
import { addressLandingGuard, panelEntryGuard } from "../../../../../packages/platform-web/src/panel-entries";
import { resetEntryResolutionFailures } from "../../../../../packages/platform-web/src/entry-resolution-failure";
import { catalogFixture } from "../../../../../packages/platform-web/src/__tests__/fixtures";
import { ossSystemConfig } from "../manager/system-config";
import { APPLICATION_ENTRY_PATH, installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, type Sent } from "./panel-frame";

const catalog = catalogFixture().filter((app) => app.id === "home");
const home = catalog[0]!;
const use = home.panelUses!.filter(isApplicationPanelUse).find((entry) => entry.id === "home")!;
const panel = {
  ...panelRecord(use.panelId, "Workspace", definePanel({
    state: { layout: { type: { kind: "scalar", type: "string" }, personal: true } },
    members: {},
  })),
  visibility: "platform" as const,
  domainId: null,
  ownerId: null,
  editable: false as const,
};
panel.content = {
  ...panel.content,
  module: `import { h } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({ setup() {
  const { instance } = usePanelContext();
  return () => h("output", { "data-layout": "" }, instance.state.values.value.layout);
} });`,
};
const personalStatePath = "/api/product-panels/personal-state/read";

function workspaceResponse(request: Sent) {
  if (request.path === APPLICATION_ENTRY_PATH && new URLSearchParams(request.search).get("path") === use.path) {
    return Response.json({
      applicationId: home.id, use, allowStandalone: false, frame: null, content: null,
      menu: { singleEntry: true, groups: [], panelUses: [use] },
    });
  }
  if (request.path === "/api/data-query/platform/applications") return Response.json({ success: true, data: catalog });
  if (request.path === "/api/data-query/platform/applications/home") return Response.json({ success: true, data: home });
  if (request.path === "/api/platform/home") return Response.json({ favorites: [], dashboardIds: [], recentApplications: [], recentConversations: [] });
  if (request.path === "/api/platform/home/panel") return Response.json({ panel: null });
  if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
  if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, {}, request);
  if (request.path === personalStatePath) return Response.json({ values: { layout: "saved layout" } });
  return nothingAt(request);
}

async function open(address: string, answer: (request: Sent) => Response) {
  const router = createRouter({ history: createMemoryHistory(), routes: [] });
  registerPlatformRoutes(router, [platformLayoutRoute([], PlatformShellLayout), unknownAddressRoute]);
  router.beforeEach(panelEntryGuard(router));
  router.beforeResolve(addressLandingGuard(router));
  const sent = installPlatform(answer, router);
  const host: PlatformPageHost = {
    api: { getServiceInfo: async () => ({}), getBusinessConfig: async () => ({}) },
    access: { ready: true, error: null, canEnter: () => true, verifyEntry: async () => "allowed", load: async () => {} },
    navigation: computed(() => ({ groups: [], pages: [] })),
    account: null,
    links: [],
    navigationHidden: computed(() => false),
    systemConfig: ossSystemConfig,
    separators: { detail: ": " },
    preferences: { locales: ["en"], locale: ref("en"), setLocale: () => {}, theme: ref("light"), setTheme: () => {} },
  };
  const Shell = defineComponent({
    setup() {
      provide(platformHostKey, host);
      return () => h(RouterView);
    },
  });
  await router.push(address);
  return { router, sent, ...mountPlatformPage(() => h(Shell), router) };
}

afterEach(() => {
  leaveFrame();
  resetEntryResolutionFailures();
});

function errorResponse(message: string) {
  return Response.json({ error: { message } }, { status: 503 });
}

it("keeps the workspace header and rail during a failed layout read, then retries with the saved layout", async () => {
  const reason = "Personal layout store is unavailable";
  let failRead = true;
  const { app, element, sent } = await open(use.path, (request) => {
    if (request.path === personalStatePath && failRead) return errorResponse(reason);
    return workspaceResponse(request);
  });
  try {
    const body = element.querySelector(".platform-page-body")!;
    await vi.waitFor(() => expect(body.querySelector("[role=alert]")?.textContent).toBe(reason));
    expect(element.querySelector("nav.platform-rail")).not.toBeNull();
    expect(body.querySelector("header h1")?.textContent).toBe(use.names!.en);
    expect(body.querySelector("h2")?.textContent).toBe(publicEn.home.personalLayoutReadFailed);
    expect(body.querySelector("[data-layout]")).toBeNull();
    expect(sent.some((request) => request.method === "PUT")).toBe(false);

    failRead = false;
    body.querySelector<HTMLButtonElement>(".fui-data-state-error button")!.click();
    await vi.waitFor(() => expect(body.querySelector("[data-layout]")?.textContent).toBe("saved layout"));
    expect(body.querySelector("[role=alert]")).toBeNull();
  } finally {
    app.unmount();
  }
});

it("shows an entry read failure in the shell, retries the same address and lets the rail open Home", async () => {
  const path = "/entry-not-yet-loaded";
  const address = `${path}?view=details#section`;
  let reason = "Entry service is unavailable";
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { app, element, router } = await open(address, (request) => {
    if (request.path === APPLICATION_ENTRY_PATH && new URLSearchParams(request.search).get("path") === path) {
      return errorResponse(reason);
    }
    return workspaceResponse(request);
  });
  try {
    const body = element.querySelector(".platform-page-body")!;
    expect(body.querySelector("header h1")?.textContent).toBe(publicEn.platform.entryReadFailed);
    expect(body.querySelector("[role=alert]")?.textContent).toBe(reason);
    const rail = element.querySelector("nav.platform-rail")!;
    const homeButton = await vi.waitFor(() => {
      const button = rail.querySelector<HTMLButtonElement>(`button[title="${home.names.en}"]`);
      expect(button).not.toBeNull();
      return button!;
    });

    reason = "Entry service is still unavailable";
    body.querySelector<HTMLButtonElement>(".fui-data-state-error button")!.click();
    await vi.waitFor(() => expect(body.querySelector("[role=alert]")?.textContent).toBe(reason));
    expect(router.currentRoute.value.fullPath).toBe(address);

    homeButton.click();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(platformRoutes.home.path));
    expect(element.querySelector("nav.platform-rail")).toBe(rail);
    await vi.waitFor(() => expect(body.querySelector("[data-layout]")?.textContent).toBe("saved layout"));
  } finally {
    app.unmount();
  }
});
