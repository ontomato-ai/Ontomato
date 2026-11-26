import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h, type Ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAuthoringManifestSchema } from "@ontomato/contracts/panel-authoring";
import { expandPanelAuthoringMember } from "@ontomato/contracts/panel-check";
import { parseApplicationPanelAddress } from "@ontomato/contracts/panel-host";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { provideApplicationFrame } from "@ontomato/platform-shell";
import { components as sdkCatalogueComponents } from "../../../../../packages/apps-sdk/src/catalogue";
import ApplicationFrameHost from "../../../../../packages/platform-web/src/ApplicationFrameHost.vue";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { useApplicationCatalog } from "../../../../../packages/platform-web/src/catalog";
import { catalogFixture } from "../../../../../packages/platform-web/src/__tests__/fixtures";
import platformFrameSource from "../../../../../packages/platform-shell/resources/builtin-panels/platform-frame/panel.json";
import platformFrameHtml from "../../../../../packages/platform-shell/resources/builtin-panels/platform-frame/panel.html?raw";
import platformFrameModule from "../../../../../packages/platform-shell/resources/builtin-panels/platform-frame/panel.mjs?raw";
import ontologyFrameSource from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-frame/panel.json";
import ontologyFrameHtml from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-frame/panel.html?raw";
import ontologyFrameModule from "../../../../../packages/ontology-manager/resources/builtin-panels/ontology-frame/panel.mjs?raw";
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
      return () => h(ApplicationFrameHost, null, { default: () => h(RouterView) });
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
    { ...panelUse("use-overview", "multi-overview", content.id, `/applications/${multiApp}/overview`), names: { en: "Overview" }, icon: "users", groupKey: "main" },
    { ...panelUse("use-reports", "multi-reports", content.id, `/applications/${multiApp}/reports`), names: { en: "Reports" }, icon: "chart-column", groupKey: "main" },
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
      return () => h(ApplicationFrameHost, null, { default: () => h(RouterView) });
    },
  })), router);
  try {
    await vi.waitFor(() => expect(multiMount.element.querySelector(".platform-app-menu .app-menu-title")?.textContent?.trim()).toBe("Academy portal"));
    expect(multiMount.element.querySelector(".platform-app-menu .group-heading")?.textContent?.trim()).toBe("Workspace");
    const activeRows = multiMount.element.querySelectorAll('.platform-app-menu .page-row[aria-current="page"]');
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0]?.textContent).toContain("Overview");
    // Entry icons declared on panelUses render directly in AppMenu without hostMenu or frame :icons prop.
    const rowIcons = multiMount.element.querySelectorAll(".platform-app-menu .page-row .page-icon");
    expect(rowIcons).toHaveLength(2);
  } finally {
    multiMount.app.unmount();
  }

  // 2. Single-entry domain app hides the sidebar menu while still rendering content inside platform-frame.
  await router.push(`/applications/${singleApp}/only`);
  const singleMount = mountPlatformPage(() => h(defineComponent({
    setup() {
      provideApplicationFrame();
      return () => h(ApplicationFrameHost, null, { default: () => h(RouterView) });
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

it("supplies the frame's declared deepLink defaults on first unframed (beside-conversation) open and honors URL overrides", async () => {
  installPlatform(answer);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/chat", component: { template: "<div />" } },
      {
        path: "/applications/:applicationId/:panelPath(.*)?",
        component: PanelApplicationRoute,
        props: (route) => ({ applicationId: String(route.params.applicationId) }),
      },
    ],
  });
  await router.push("/chat");

  // 1. First open beside a conversation with a clean URL omitting `frame.term`: receives frame default `"A"`.
  const defaultMount = mountPlatformPage(() => h(PanelApplicationRoute, {
    applicationId: app,
    address: at("spring"),
    navigate: vi.fn(),
  }), router);
  try {
    await vi.waitFor(() => expect(defaultMount.element.querySelector(".term")?.textContent).toBe("A"));
    expect(defaultMount.element.querySelector(".panel-application-frame")).toBeNull();
  } finally {
    defaultMount.app.unmount();
  }

  // 2. Explicit `frame.term=B` in the URL overrides the frame default beside a conversation.
  const overrideMount = mountPlatformPage(() => h(PanelApplicationRoute, {
    applicationId: app,
    address: `${at("spring")}?frame.term=B`,
    navigate: vi.fn(),
  }), router);
  try {
    await vi.waitFor(() => expect(overrideMount.element.querySelector(".term")?.textContent).toBe("B"));
  } finally {
    overrideMount.app.unmount();
  }

  // 3. Explicit empty `frame.term=` clears the frame default beside a conversation instead of snapping back to `"A"`.
  const clearedMount = mountPlatformPage(() => h(PanelApplicationRoute, {
    applicationId: app,
    address: `${at("spring")}?frame.term=`,
    navigate: vi.fn(),
  }), router);
  try {
    await vi.waitFor(() => expect(clearedMount.element.querySelector(".sdk-page-header-title")?.textContent?.trim()).toBe("Term"));
    expect(clearedMount.element.querySelector(".term")?.textContent).toBe("");
  } finally {
    clearedMount.app.unmount();
  }
});

it("shipped ontology-frame uses ObjectCount badges via #item-trailing, reads only visible count members, populates mobile select, and preserves navigationContext routing", async () => {
  expect(ontologyFrameModule).not.toContain("usePanelData");
  expect(JSON.stringify(ontologyFrameSource)).not.toContain("PanelData");

  const parsedManifest = panelAuthoringManifestSchema.parse(ontologyFrameSource.manifest);
  const typeTable = {
    objectTypes: Object.fromEntries(
      Object.entries(platformObjectTypes).map(([typeId, spec]) => [
        typeId,
        platformTypeTableEntrySchema.parse({ reads: spec.reads ?? {} }),
      ]),
    ),
  };
  const authoringComponents = sdkCatalogueComponents.map((entry) => ({
    ...entry,
    ports: { props: [], events: [], slots: [] },
  })) as unknown as Parameters<typeof expandPanelAuthoringMember>[2]["components"];
  const frameMembers: Record<string, unknown> = {};
  const frameProjections: Record<string, DirectProjection> = {};
  for (const [key, declaration] of Object.entries(parsedManifest.members)) {
    if ("component" in declaration) {
      const id = declaration.id!;
      const expanded = expandPanelAuthoringMember(key, declaration, {
        state: parsedManifest.state,
        components: authoringComponents,
        typeTable,
      });
      frameMembers[key] = { ...expanded.placement, target: { projectionId: id } };
      frameProjections[id] = {
        ...expanded.projection,
        id,
        name: key,
        domainId: null,
        ownerId: null,
        revision: 1,
        createdAt: "",
        updatedAt: "",
        editable: false,
        visibility: "platform",
        description: "",
      } as DirectProjection;
    } else {
      frameMembers[key] = declaration;
    }
  }

  // All 19 count projections use ObjectCount with badge appearance:
  // 10 use count-only reads (no params), 5 ontology paged queries keep size: 1,
  // 3 governance paged queries pass page: { number: 1, size: 1 }, and organization units uses list.
  const countProjectionList = Object.values(frameProjections);
  expect(countProjectionList).toHaveLength(19);
  const catalogueQueryMembers = [
    "builtin-product-om-frame-projections",
    "builtin-product-om-frame-panels",
  ];
  for (const projection of countProjectionList) {
    expect(projection.componentId).toBe("@ontomato/sdk:ObjectCount");
    expect(projection.config).toEqual({ appearance: "badge" });
    if (catalogueQueryMembers.includes(projection.id)) {
      expect(projection.data.rows?.read).toBe("query");
      expect(projection.data.rows?.params).toEqual({ size: { literal: 1 } });
    } else {
      expect(projection.data.rows?.read).toBe("count");
      expect(projection.data.rows?.params).toEqual({});
    }
  }

  const ontologyFrame = {
    ...panelRecord("builtin-product-ontology-frame", "Ontology manager", definePanel({
      state: parsedManifest.state as never,
      members: frameMembers as never,
    })),
    content: {
      html: ontologyFrameHtml,
      module: ontologyFrameModule,
      messages: ontologyFrameSource.content.messages,
    },
    visibility: "platform" as const,
    domainId: null,
    ownerId: null,
    editable: false as const,
  };

  // Expose only a subset of menu entries (omitting agents/applications/panels/workflows/roles/policies/etc.)
  // to verify unmounted count members issue zero data reads even though usePanelOutput wires all 19.
  const ontologyUses = [
    { ...panelUse("use-playground", "om-playground", content.id, "/ontology/playground"), names: { en: "Ontology graph" }, groupKey: "facts" },
    { ...panelUse("use-objects", "om-objects", content.id, "/ontology/objects"), names: { en: "Object types" }, groupKey: "facts" },
    { ...panelUse("use-knowledge", "om-knowledge", content.id, "/ontology/knowledge"), names: { en: "Business knowledge" }, groupKey: "facts" },
    { ...panelUse("use-skills", "om-skills", content.id, "/ontology/skills"), names: { en: "Skills" }, groupKey: "capabilities" },
    { ...panelUse("use-members", "om-members", content.id, "/permissions/members"), names: { en: "Members" }, groupKey: "governance" },
  ];

  const readMembers: string[] = [];
  const responder = async (request: Sent) => {
    if (request.path === `/api/product-panels/${ontologyFrame.id}/snapshot`) {
      const { pageSkillContext: _none, ...snapshot } = await (await panelSnapshot(ontologyFrame, frameProjections, request)).json();
      return Response.json(snapshot);
    }
    if (request.path === "/api/data-query/platform/applications/ontology/panel-uses") {
      return Response.json({
        data: {
          applicationId: "ontology",
          names: { en: "Ontology manager" },
          groups: [
            { key: "facts", names: { en: "Facts" }, sort: 1 },
            { key: "capabilities", names: { en: "Capabilities" }, sort: 2 },
            { key: "products", names: { en: "Product layer" }, sort: 3 },
            { key: "governance", names: { en: "Governance" }, sort: 4 },
          ],
          entry: { path: "/ontology", renderer: "panels" },
          panelUses: ontologyUses,
          framePanelId: ontologyFrame.id,
        },
      });
    }
    if (request.path === "/api/product-panels/read") {
      const payload = request.body as { memberPath?: readonly { member?: string }[]; operations?: unknown };
      if ("operations" in payload) {
        return Response.json({ status: "ready", value: {} });
      }
      const member = payload.memberPath?.[0]?.member ?? "";
      readMembers.push(member);
      if (member === "objectTypes") {
        return Response.json({
          status: "ready",
          value: { rows: [], total: 3 },
        });
      }
      if (member === "knowledge") {
        return Response.json({
          status: "ready",
          value: { total: 42, rows: [{ primaryKey: "k-1", label: "Rule 1", fields: {} }] },
        });
      }
      if (member === "skills") {
        return Response.json({ status: "forbidden" });
      }
      if (member === "members") {
        return Response.json({
          status: "ready",
          value: { rows: [], total: 7 },
        });
      }
      return Response.json({ status: "ready", value: { rows: [], total: 0 } });
    }
    for (const [id, projection] of Object.entries(frameProjections)) {
      if (request.path === `/api/product-projections/${id}`) return Response.json({ projection });
    }
    for (const panel of [content, ontologyFrame]) {
      if (request.path === `/api/product-panels/${panel.id}`) return panelAnswer(panel, request);
      if (request.path === `/api/product-panels/${panel.id}/snapshot`) return panelSnapshot(panel, projections, request);
    }
    return nothingAt(request);
  };

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/ontology/:panelPath(.*)?",
        component: PanelApplicationRoute,
        props: () => ({ applicationId: "ontology" }),
      },
      {
        path: "/permissions/:panelPath(.*)?",
        component: { template: "<div class='permissions-page' />" },
      },
    ],
  });
  const catalog = useApplicationCatalog();
  const previousApplications = catalog.applications.value;
  catalog.applications.value = catalogFixture().map((app) =>
    app.id === "ontology"
      ? { ...app, panelUses: ontologyUses, framePanelId: ontologyFrame.id }
      : app,
  );
  const sent = installPlatform(responder, router);

  await router.push("/ontology/playground");
  const mounted = mountPlatformPage(() => h(defineComponent({
    setup() {
      provideApplicationFrame();
      return () => h(ApplicationFrameHost, null, { default: () => h(RouterView) });
    },
  })), router);

  try {
    await vi.waitFor(() => {
      const objectsBadge = mounted.element.querySelector('[data-member="objectTypes"] .sdk-object-count-badge');
      const knowledgeBadge = mounted.element.querySelector('[data-member="knowledge"] .sdk-object-count-badge');
      const membersBadge = mounted.element.querySelector('[data-member="members"] .sdk-object-count-badge');
      expect(objectsBadge?.textContent?.trim()).toBe("3");
      expect(knowledgeBadge?.textContent?.trim()).toBe("42");
      expect(membersBadge?.textContent?.trim()).toBe("7");
    });

    // Only visible count members issued data reads; unauthorized/omitted members issued zero reads.
    expect([...new Set(readMembers)].sort()).toEqual(["knowledge", "members", "objectTypes", "skills"]);
    const reads = sent.filter(request => request.method === "POST" && request.path.startsWith("/api/product-panels/read"));
    expect(reads).toEqual([expect.objectContaining({
      path: "/api/product-panels/read-batch",
      body: { reads: expect.arrayContaining(["knowledge", "members", "objectTypes", "skills"].map(member =>
        expect.objectContaining({ memberPath: [{ member }] }))) },
    })]);

    // Forbidden count member renders zero ObjectCount DOM nodes; non-count entry renders zero trailing projection.
    expect(mounted.element.querySelector('[data-member="skills"] .sdk-object-count')).toBeNull();
    const playgroundRow = [...mounted.element.querySelectorAll(".page-row")].find((row) => row.textContent?.includes("Ontology graph"));
    expect(playgroundRow?.querySelector(".ontology-frame-trailing")).toBeNull();

    // Mobile <select> receives (${total}) only for valid totals and plain labels for the rest.
    const optionTexts = [...mounted.element.querySelectorAll(".mobile-page-select option")].map((opt) => opt.textContent?.trim());
    expect(optionTexts).toEqual([
      "Ontology graph",
      "Object types (3)",
      "Business knowledge (42)",
      "Skills",
      "Members (7)",
    ]);

    // Non-/ontology/ menu entries still append ?navigationContext=ontology on navigation.
    const membersRow = [...mounted.element.querySelectorAll<HTMLButtonElement>(".page-row")].find((row) => row.textContent?.includes("Members"));
    membersRow?.click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/permissions/members?navigationContext=ontology"));
  } finally {
    mounted.app.unmount();
    catalog.applications.value = previousApplications;
  }
});
