import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { provideApplicationFrame, providePageHeading } from "@ontomato/platform-shell";
import PlatformLayout from "../../../../../packages/platform-web/src/PlatformLayout.vue";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import {
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  panelUse,
  projections,
  type Sent,
} from "./panel-frame";

/*
 * Host content-box height contract (direct rendering design §3 "Content box height", standard parts 2 & 3):
 * every panel entry — full page, beside a conversation, or inside a custom application frame's `<current-entry>` —
 * gets a definite-height content box below the page header and above the page composer. `.panel-host-direct` is the
 * scrolling box, `.panel-host-coded` is layout-transparent (`display: contents`), bare `#app` wrappers carry
 * `data-panel-bare-root` (`display: contents`) so the panel's own root sits directly in `.panel-host-direct`, styled
 * `#app` roots keep their own box without forced flex-direction/height, and direct flex items keep `flex-shrink: 0`
 * at zero specificity so both fill-height (`height: 100%` / `flex: 1`) and flow-down layouts work consistently.
 */

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const stylesOf = (relative: string) =>
  [...source(relative).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]!).join("\n");

const layoutLabels = {
  expandRail: "Expand",
  collapseRail: "Collapse",
  back: "Back",
  applications: "Applications",
  brand: "Ontomato",
  account: "Account",
  language: "Language",
  theme: { light: "Light", dark: "Dark" },
  signOut: "Sign out",
  opensInNewTab: "Opens in a new tab",
  pages: "Pages",
  save: "Save",
  discard: "Discard",
  unsavedChanges: "Unsaved changes",
  more: "More",
  copyExternalLink: "Copy external link",
  externalLinkCopied: "Copied",
};

const agent = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Analyst", description: "", icon: null, enabled: true };
const pageCounter = {
  agents: async () => [agent],
  pageAgents: async () => ({ agents: [agent], defaultAgentId: agent.id }),
  preferredAgentId: ref<string | null>(agent.id),
  ask: vi.fn(),
};

afterEach(() => leaveFrame());

describe("host content-box height stylesheets", () => {
  it("connects PanelHost direct box through coded wrapper to panel root for fill and flow-down modes", () => {
    const css = stylesOf("../../../../../packages/platform-shell/src/PanelHost.vue");
    expect(css).toMatch(/\.panel-host-direct\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/\.panel-host-coded\s*\{[^}]*display:\s*contents;/s);
    // Bare `#app` wrappers are layout-transparent; direct flex items keep `flex-shrink: 0` at zero specificity.
    expect(css).toMatch(/:where\(\.panel-host-direct > \.panel-host-coded > \[data-panel-bare-root\]\)\s*\{[^}]*display:\s*contents;/s);
    expect(css).toMatch(/:where\(\.panel-host-direct > \.panel-host-coded > \*\),\s*:where\(\.panel-host-direct > \.panel-host-coded > \[data-panel-bare-root\] > \*\)\s*\{[^}]*flex-shrink:\s*0;/s);
    // Host banners stay fixed above the scrolling content box.
    expect(css).toMatch(/\.panel-host-notice\s*\{[^}]*flex-shrink:\s*0;/s);
    expect(css).toMatch(/\.panel-host-draft\s*\{[^}]*flex-shrink:\s*0;/s);
  });

  it("places PageComposer as a non-sticky flex foot and keeps non-panel PlatformLayout scrolling intact", () => {
    const composerCss = stylesOf("../../../../../packages/agent-shell-ui/src/components/PageComposer.vue");
    expect(composerCss).toMatch(/\.page-ask\s*\{[^}]*flex-shrink:\s*0;/s);
    expect(composerCss).not.toMatch(/\.page-ask\s*\{[^}]*position:\s*sticky;/s);
    expect(composerCss).toMatch(/\.page-ask:has\(\.composer-unfold\)\s*\{[^}]*padding:[^;]*var\(--shell-composer-foot\);/s);

    const layoutCss = stylesOf("../../../../../packages/platform-web/src/PlatformLayout.vue");
    // Conventional pages keep body scrolling and vertical padding.
    expect(layoutCss).toMatch(/\.platform-page-body\s*\{[^}]*overflow:\s*auto;[^}]*padding-block:\s*var\(--page-content-gap\)\s+var\(--spacing-xl\);/s);
    // Panel routes and candidate previews own their scrolling content box without outer padding or double scrollbars.
    expect(layoutCss).toMatch(/\.platform-page-body:has\(> \.panel-application-area\),\s*\.platform-page-body:has\(> \.panel-host\)\s*\{[^}]*padding:\s*0;[^}]*overflow:\s*hidden;/s);
  });

  it("propagates definite height through CurrentEntry, EntryUnit and nested panel wrappers", () => {
    const memberCss = source("../../../../../packages/apps-sdk/src/panel/panel-member.css");
    expect(memberCss).toMatch(/:where\(\.sdk-current-entry-slot\)\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 auto;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
    expect(memberCss).toMatch(/:where\(\.sdk-panel-member-nested\)\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 auto;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
    expect(memberCss).toMatch(/:where\(\.sdk-current-entry\)\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 auto;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
    expect(memberCss).toMatch(/:where\(\.sdk-panel-member-nested > \[data-panel-bare-root\]\)\s*\{[^}]*display:\s*contents;/s);

    const entryUnitCss = stylesOf("../../../../../packages/platform-web/src/pages/EntryUnit.vue");
    expect(entryUnitCss).toMatch(/\.panel-entry-unit\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(entryUnitCss).toMatch(/\.panel-entry-unit-body\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(entryUnitCss).toMatch(/\.panel-entry-unit-foot\s*\{[^}]*flex-shrink:\s*0;/s);

    const routeCss = stylesOf("../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue");
    expect(routeCss).toMatch(/\.panel-application-area\s*\{[^}]*padding-bottom:\s*var\(--pane-dock-space,\s*0px\);/s);

    const paneCss = stylesOf("../../../../../packages/agent-shell-ui/src/components/ShellPagePane.vue");
    expect(paneCss).not.toContain(".pane-dock:has(> .composer-unfold:only-child)");
  });
});

describe("host content-box structure across full-page, beside-conversation, and custom-frame placements", () => {
  const appId = "app-height";
  const path = `/applications/${appId}/work`;
  const entryUse = { ...panelUse("use-work", "height-work", "panel-height-work", path), names: { en: "Work" } };
  const entryPanel = panelRecord("panel-height-work", "Work", definePanel({ state: {}, members: {}, commands: {} }));
  entryPanel.content = {
    html: `<style>} body { color: red; }</style><div id="app"><section class="work-root">Work</section></div>`,
    module: `import { mountPanel } from "@ontomato/sdk/panel"; await mountPanel({});`,
  };

  const framePanel = panelRecord("panel-height-frame", "Frame", definePanel({
    state: {},
    members: { content: { target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } } } },
    commands: {},
  }));
  framePanel.content = {
    html: `<div id="app" class="frame-app"><nav class="frame-nav">Menu</nav><current-entry member="content"></current-entry></div>`,
    module: `import { mountPanel } from "@ontomato/sdk/panel"; await mountPanel({});`,
  };

  function responder(framePanelId?: string) {
    return async (request: Sent) => {
      if (request.path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
        return Response.json({
          data: {
            applicationId: appId,
            entry: { path: `/applications/${appId}`, renderer: "panels" },
            panelUses: [entryUse],
            ...(framePanelId ? { framePanelId } : {}),
          },
        });
      }
      if (request.path === `/api/product-panels/${framePanel.id}/snapshot`) {
        const { pageSkillContext: _none, ...snapshot } = await (await panelSnapshot(framePanel, projections, request)).json();
        return Response.json(snapshot);
      }
      for (const panel of [entryPanel, framePanel]) {
        if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
        if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
      }
      return nothingAt(request);
    };
  }

  it("places notice above the scrolling box and PageComposer below PanelHost on full-page routes", async () => {
    installPlatform(responder());
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/applications/:applicationId/:panelPath(.*)?",
          component: PanelApplicationRoute,
          props: (route) => ({ applicationId: String(route.params.applicationId) }),
        },
      ],
    });
    await router.push(path);
    const { app, element } = mountPlatformPage(
      () =>
        h({
          setup() {
            const heading = providePageHeading();
            const framed = provideApplicationFrame();
            return () =>
              h(PlatformLayout, {
                apps: [],
                shownPage: heading.value ? { title: heading.value.title, named: true } : null,
                account: null,
                preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
                labels: layoutLabels,
                pageActions: null,
                appFramed: framed.value,
              });
          },
        }),
      router,
      pageCounter,
    );
    try {
      await vi.waitFor(() => expect(element.querySelector(".work-root")).not.toBeNull());
      await vi.waitFor(() => expect(element.querySelector(".page-ask")).not.toBeNull());

      const body = element.querySelector<HTMLElement>(".platform-page-body")!;
      const area = body.querySelector<HTMLElement>(":scope > .panel-application-area")!;
      const host = area.querySelector<HTMLElement>(":scope > .panel-host.panel-host-page")!;
      const direct = host.querySelector<HTMLElement>(":scope > .panel-host-direct")!;
      const notice = host.querySelector<HTMLElement>(":scope > .panel-host-notice")!;
      const foot = area.querySelector<HTMLElement>(":scope > .panel-page-foot")!;

      expect(direct.querySelector(".panel-host-notice")).toBeNull();
      expect(notice.compareDocumentPosition(direct) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(direct.querySelector(":scope > .panel-host-coded > [data-panel-bare-root] > .work-root")).not.toBeNull();
      // PageComposer sits below PanelHost inside the flex column foot, never inside the scrolling content box.
      expect(direct.querySelector(".page-ask")).toBeNull();
      expect(foot.querySelector(":scope > .page-ask")).not.toBeNull();
      expect(host.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      app.unmount();
    }
  });

  it("mounts the same content-box chain beside a conversation without a duplicate PageComposer", async () => {
    installPlatform(responder());
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/agents/chat", component: { render: () => null } }] });
    await router.push("/agents/chat");
    const { app, element } = mountPlatformPage(
      () => h(PanelApplicationRoute, { applicationId: appId, address: path, navigate: vi.fn() }),
      router,
      pageCounter,
    );
    try {
      await vi.waitFor(() => expect(element.querySelector(".work-root")).not.toBeNull());
      const area = element.querySelector<HTMLElement>(".panel-application-area")!;
      const host = area.querySelector<HTMLElement>(":scope > .panel-host")!;
      expect(host.classList.contains("panel-host-page")).toBe(false);
      expect(host.querySelector(":scope > .panel-host-direct > .panel-host-coded > [data-panel-bare-root] > .work-root")).not.toBeNull();
      expect(area.querySelector(".page-ask")).toBeNull();
    } finally {
      app.unmount();
    }
  });

  it("keeps the same header, content box, and PageComposer structure inside a custom frame's CurrentEntry", async () => {
    installPlatform(responder(framePanel.id));
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/applications/:applicationId/:panelPath(.*)?",
          component: PanelApplicationRoute,
          props: (route) => ({ applicationId: String(route.params.applicationId) }),
        },
      ],
    });
    await router.push(path);
    const { app, element } = mountPlatformPage(
      () =>
        h({
          setup() {
            provideApplicationFrame();
            return () => h(RouterView);
          },
        }),
      router,
      pageCounter,
    );
    try {
      await vi.waitFor(() => expect(element.querySelector(".panel-application-frame .panel-entry-unit .work-root")).not.toBeNull());
      await vi.waitFor(() => expect(element.querySelector(".panel-application-frame .panel-entry-unit .page-ask")).not.toBeNull());

      const area = element.querySelector<HTMLElement>(".panel-application-area")!;
      const frameHost = area.querySelector<HTMLElement>(":scope > .panel-host.panel-application-frame")!;
      expect(frameHost.classList.contains("panel-host-page")).toBe(false);
      // Styled `#app` roots keep their own box (no `data-panel-bare-root`), while bare `#app` entries are layout-transparent.
      const frameRoot = frameHost.querySelector<HTMLElement>(":scope > .panel-host-direct > .panel-host-coded > .frame-app")!;
      expect(frameRoot).not.toBeNull();
      expect(frameRoot.hasAttribute("data-panel-bare-root")).toBe(false);
      // The frame's own CurrentEntry slot chains straight into EntryUnit (header + entry content box + PageComposer).
      const slot = frameRoot.querySelector<HTMLElement>(":scope > [data-member='content'].sdk-current-entry-slot")!;
      expect(slot).not.toBeNull();
      const unit = slot.querySelector<HTMLElement>(":scope > .sdk-panel-member-nested > .sdk-current-entry > .panel-entry-unit")!;
      expect(unit).not.toBeNull();
      expect(unit.querySelector(":scope > .platform-page-header .page-title")?.textContent).toBe("Work");
      const entryBody = unit.querySelector<HTMLElement>(":scope > .panel-entry-unit-body")!;
      expect(
        entryBody.querySelector(":scope > .panel-host.panel-host-page > .panel-host-direct > .panel-host-coded > [data-panel-bare-root] > .work-root"),
      ).not.toBeNull();
      const entryFoot = unit.querySelector<HTMLElement>(":scope > .panel-entry-unit-foot")!;
      expect(entryFoot.querySelector(":scope > .page-ask")).not.toBeNull();
      // PageComposer stays inside the entry unit rather than below the outer frame navigation.
      expect(area.querySelector(":scope > .panel-page-foot")).toBeNull();
    } finally {
      app.unmount();
    }
  });

  it("keeps conventional non-panel routes outside the panel-host body overrides in PlatformLayout", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/settings/general", component: { render: () => h("div", { class: "legacy-page" }, "General") } }],
    });
    await router.push("/settings/general");
    const { app, element } = mountPlatformPage(
      () =>
        h(PlatformLayout, {
          apps: [],
          shownPage: { title: "General" },
          account: null,
          preferences: { locales: ["en"], locale: "en", setLocale: () => {}, theme: "light", setTheme: () => {} },
          labels: layoutLabels,
          pageActions: null,
        }),
      router,
    );
    try {
      const body = element.querySelector<HTMLElement>(".platform-page-body")!;
      expect(body.querySelector(":scope > .legacy-page")).not.toBeNull();
      expect(body.querySelector(":scope > .panel-application-area")).toBeNull();
      expect(body.querySelector(":scope > .panel-host")).toBeNull();
    } finally {
      app.unmount();
    }
  });
});
