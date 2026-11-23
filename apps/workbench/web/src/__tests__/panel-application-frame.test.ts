import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, type Ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { parseApplicationPanelAddress } from "@ontomato/contracts/panel-host";
import { provideApplicationFrame } from "@ontomato/platform-shell";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import platformFrameSource from "../../../../../packages/platform-shell/resources/builtin-panels/platform-frame/panel.json";
import platformFrameHtml from "../../../../../packages/platform-shell/resources/builtin-panels/platform-frame/panel.html?raw";
import platformFrameModule from "../../../../../packages/platform-shell/resources/builtin-panels/platform-frame/panel.mjs?raw";
import { installPlatform, leaveFrame, mountPlatformPage, nothingAt, panelAnswer, panelRecord, panelSnapshot, panelUse, projections, type Sent } from "./panel-frame";

/*
 * An application's own frame (product-layer standard, part one; design §三, big main's rulings 2026-11-21): the frame
 * panel Java names stands in the application's area, the platform's layout gives way, and the entry's page — the
 * platform's header with the content — stands where the frame's <current-entry> is. The frame's shared term rides in
 * the address's `frame` segment and reaches the content through the entry's `{frameState}` input; going to another entry
 * keeps the same frame.
 *
 * What this rules out: a frame that cannot hold the entry's page, or holds a second instance of it; a page header lost
 * when the application draws its own frame; a shared value that does not reach the content or the address; a frame
 * rebuilt on every entry.
 */

const app = "app-framed";
const at = (path: string) => `/applications/${app}/${path}`;
const content = panelRecord("panel-framed-content", "Term", definePanel({
  state: { term: { type: { kind: "scalar", type: "string" }, deepLink: true, external: true } },
  members: {},
}));
content.content = {
  ...content.content,
  html: `<div id="app"><page-header :title="t('panel.name')"></page-header><output class="term">{{ instance.state.values.value.term ?? '' }}</output></div>`,
  module: `import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({ setup() {
  const { instance, t } = usePanelContext();
  return { instance, t };
} });
`,
  messages: { en: { "panel.name": "Term" } },
};
const frame = panelRecord("panel-framed-frame", "Frame", definePanel({
  state: { term: { type: { kind: "scalar", type: "string" }, deepLink: true, external: true, default: "A" } },
  members: { content: { target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } } } },
}));
frame.content = {
  ...frame.content,
  html: `<div id="app"><nav class="frame-menu"><span class="current">{{ current?.pageKey }}</span>
    <button class="term-b" @click="setB">B</button></nav><current-entry member="content"></current-entry></div>`,
  module: `import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";
await mountPanel({ setup() {
  const { currentEntry, instance } = usePanelContext();
  return { current: currentEntry, setB: () => instance.state.set("term", "B") };
} });
`,
};
const uses = ["spring", "autumn"].map((name) => ({
  ...panelUse(`use-${name}`, `framed-${name}`, content.id, at(name)), names: { en: name }, inputs: { term: { frameState: "term" } },
}));

async function answer(request: Sent) {
  // Node answers the frame for the entry with no page skill: the frame is no page of its own.
  if (request.path === `/api/product-panels/${frame.id}/snapshot`) {
    const { pageSkillContext: _none, ...snapshot } = await (await panelSnapshot(frame, projections, request)).json();
    return Response.json(snapshot);
  }
  if (request.path === `/api/data-query/platform/applications/${app}/panel-uses`)
    return Response.json({ data: { applicationId: app, entry: { path: `/applications/${app}`, renderer: "panels" }, panelUses: uses, framePanelId: frame.id } });
  for (const panel of [content, frame]) {
    if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
    if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
  }
  return nothingAt(request);
}

afterEach(() => leaveFrame());

it("holds the entry's page, header and content, in the frame; shares the frame's term through the address; keeps the frame across entries", async () => {
  const sent = installPlatform(answer);
  const router = createRouter({ history: createMemoryHistory(), routes: [{
    path: "/applications/:applicationId/:panelPath(.*)?", component: PanelApplicationRoute,
    props: route => ({ applicationId: String(route.params.applicationId) }),
  }] });
  await router.push(at("spring"));
  let framed!: Readonly<Ref<boolean>>;
  const { app: mounted, element } = mountPlatformPage(() => h(defineComponent({
    setup() {
      framed = provideApplicationFrame();
      return () => h(RouterView);
    },
  })), router);
  try {
    const frameRoot = await vi.waitFor(() => {
      const found = element.querySelector<HTMLElement>(".panel-application-frame .frame-menu");
      if (!found) throw new Error("The frame is not drawn yet");
      return found.closest<HTMLElement>(".panel-application-frame")!;
    });
    expect(framed.value).toBe(true);
    // The frame read its record as the entry's frame.
    expect(sent.some((request) => request.path === `/api/product-panels/${frame.id}` && request.search.includes("source=frame"))).toBe(true);
    // The entry's page is inside the frame: its own <page-header>, then the content, with the frame's default term.
    await vi.waitFor(() => expect(frameRoot.querySelector(".panel-entry-unit .sdk-page-header-title")?.textContent?.trim()).toBe("Term"));
    await vi.waitFor(() => expect(frameRoot.querySelector(".panel-entry-unit .term")?.textContent).toBe("A"));
    expect(frameRoot.querySelector(".current")?.textContent).toBe("framed-spring");

    // The frame changes the shared term: the content follows, and the address carries it as the frame's.
    frameRoot.querySelector<HTMLButtonElement>(".term-b")!.click();
    await vi.waitFor(() => expect(parseApplicationPanelAddress(router.currentRoute.value.fullPath).frame).toEqual({ term: "B" }));
    await vi.waitFor(() => expect(frameRoot.querySelector(".panel-entry-unit .term")?.textContent).toBe("B"));

    // Another entry: the same frame, its entry and the shared term kept.
    await router.push(`${at("autumn")}?frame.term=B`);
    await vi.waitFor(() => expect(frameRoot.querySelector(".current")?.textContent).toBe("framed-autumn"));
    expect(element.querySelector(".panel-application-frame")).toBe(frameRoot);
    await vi.waitFor(() => expect(frameRoot.querySelector(".panel-entry-unit .sdk-page-header-title")?.textContent?.trim()).toBe("Term"));

    // An entry opened at its bare address — the frame's own menu, a link — keeps the frame's term, and its address says so.
    await router.push(at("spring"));
    await vi.waitFor(() => expect(frameRoot.querySelector(".current")?.textContent).toBe("framed-spring"));
    await vi.waitFor(() => expect(parseApplicationPanelAddress(router.currentRoute.value.fullPath).frame).toEqual({ term: "B" }));
    expect(frameRoot.querySelector(".panel-entry-unit .term")?.textContent).toBe("B");
  } finally {
    mounted.unmount();
  }
});

it("shipped platform-frame renders grouped app menu for multi-entry apps, hides it for single-entry apps, and skips framing beside a conversation", async () => {
  const platformFrame = {
    ...panelRecord("builtin-product-platform-frame", "Platform application frame", definePanel(platformFrameSource.manifest as never)),
    content: {
      html: platformFrameHtml,
      module: platformFrameModule,
      messages: platformFrameSource.content.messages,
    },
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    editable: false as const,
  };

  const multiApp = "app-multi";
  const singleApp = "app-single";
  const multiUses = [
    { ...panelUse("use-overview", "multi-overview", content.id, `/applications/${multiApp}/overview`), names: { en: "Overview" }, groupKey: "main" },
    { ...panelUse("use-reports", "multi-reports", content.id, `/applications/${multiApp}/reports`), names: { en: "Reports" }, groupKey: "main" },
  ];
  const singleUses = [
    { ...panelUse("use-only", "single-only", content.id, `/applications/${singleApp}/only`), names: { en: "Only page" } },
  ];

  const multiResponder = async (request: Sent) => {
    if (request.path === `/api/product-panels/${platformFrame.id}/snapshot`) {
      const { pageSkillContext: _none, ...snapshot } = await (await panelSnapshot(platformFrame, projections, request)).json();
      return Response.json(snapshot);
    }
    if (request.path === `/api/data-query/platform/applications/${multiApp}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: multiApp,
          names: { en: "Academy portal" },
          groups: [{ key: "main", names: { en: "Workspace" }, sort: 0 }],
          entry: { path: `/applications/${multiApp}`, renderer: "panels" },
          panelUses: multiUses,
          framePanelId: platformFrame.id,
        },
      });
    }
    if (request.path === `/api/data-query/platform/applications/${singleApp}/panel-uses`) {
      return Response.json({
        data: {
          applicationId: singleApp,
          names: { en: "Single view" },
          groups: [],
          entry: { path: `/applications/${singleApp}`, renderer: "panels" },
          panelUses: singleUses,
          framePanelId: platformFrame.id,
        },
      });
    }
    for (const panel of [content, platformFrame]) {
      if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
      if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
    }
    return nothingAt(request);
  };

  installPlatform(multiResponder);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: "/applications/:applicationId/:panelPath(.*)?",
      component: PanelApplicationRoute,
      props: (route) => ({ applicationId: String(route.params.applicationId) }),
    }],
  });

  // 1. Multi-entry domain app renders AppMenu with localized application title, group heading, and single active entry.
  await router.push(`/applications/${multiApp}/overview`);
  const multiMount = mountPlatformPage(() => h(defineComponent({
    setup() {
      provideApplicationFrame();
      return () => h(RouterView);
    },
  })), router);
  try {
    await vi.waitFor(() => expect(multiMount.element.querySelector(".platform-app-menu .app-menu-title")?.textContent?.trim()).toBe("Academy portal"));
    expect(multiMount.element.querySelector(".platform-app-menu .group-heading")?.textContent?.trim()).toBe("Workspace");
    const activeRows = multiMount.element.querySelectorAll('.platform-app-menu .page-row[aria-current="page"]');
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.textContent).toContain("Overview");
  } finally {
    multiMount.app.unmount();
  }

  // 2. Single-entry domain app hides the sidebar menu while still rendering content inside platform-frame.
  await router.push(`/applications/${singleApp}/only`);
  const singleMount = mountPlatformPage(() => h(defineComponent({
    setup() {
      provideApplicationFrame();
      return () => h(RouterView);
    },
  })), router);
  try {
    await vi.waitFor(() => expect(singleMount.element.querySelector(".platform-frame-shell")).not.toBeNull());
    await vi.waitFor(() => expect(singleMount.element.querySelector(".panel-entry-unit .sdk-page-header-title")?.textContent?.trim()).toBe("Term"));
    expect(singleMount.element.querySelector(".platform-app-menu")).toBeNull();
  } finally {
    singleMount.app.unmount();
  }

  // 3. Beside a conversation (`navigate` prop), no frame panel is mounted at all.
  const besideMount = mountPlatformPage(() => h(PanelApplicationRoute, {
    applicationId: multiApp,
    address: `/applications/${multiApp}/overview`,
    navigate: vi.fn(),
  }), router);
  try {
    await vi.waitFor(() => expect(besideMount.element.querySelector(".sdk-page-header-title")?.textContent?.trim()).toBe("Term"));
    expect(besideMount.element.querySelector(".platform-frame-shell")).toBeNull();
    expect(besideMount.element.querySelector(".platform-app-menu")).toBeNull();
  } finally {
    besideMount.app.unmount();
  }
});
