import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, nextTick } from "vue";
import { createRouter, createWebHashHistory, RouterView, useRoute, useRouter } from "vue-router";
import { panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { useConversationDisplay, type DisplayPage, type DisplayPageController } from "../../../../../packages/agent-shell-ui/src/conversation-display";
import {
  installPanelBackPopStateListener,
  provideUnsavedChanges,
  useLeaveConfirmation,
  useUnsavedChanges,
} from "@ontomato/platform-shell";
import PanelApplicationRoute from "../../../../../packages/platform-web/src/pages/PanelApplicationRoute.vue";
import { pilotPageResolver } from "../../../../../packages/platform-web/src/pilot-pages";
import {
  installPlatform,
  leaveFrame,
  mountPlatformPage,
  nothingAt,
  panelAnswer,
  panelRecord,
  panelSnapshot,
  panelUse,
  type Sent,
} from "./panel-frame";

/*
 * End-to-end integration tests for host-owned detail-page Back (`usePanelContext().navigateBack(fallback)`):
 * - Full-page multi-hop navigation restores each previous page and its URL state via browser history.
 * - Direct open (new tab / external link, `history.state.back === null`) falls back to the panel's catalog address.
 * - Standalone open (`?standalone=1`) behaves identically for both direct open and in-app navigation.
 * - Dirty form edits on a detail page prompt once through the platform's unified unsaved-changes guard; Cancel keeps
 *   edits and stays on the detail page, Confirm leaves cleanly.
 * - Beside a conversation (`?page=...`): direct open and first page beside chat fall back to the catalog inside the
 *   side pane; multi-hop navigation steps back inside the side pane; dirty edits prompt once before stepping back.
 */

const appId = "app-detail-back";
const catalogPath = `/applications/${appId}/catalog`;
const detailAPath = `/applications/${appId}/detail-a`;
const detailBPath = `/applications/${appId}/detail-b`;

const baseMeta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
  editable: true,
  visibility: "domain" as const,
  description: "",
};

const formProjection: DirectProjection = {
  ...baseMeta,
  id: "proj-detail-back-form",
  name: "Detail form",
  componentId: "@ontomato/sdk:ObjectForm",
  inputs: {
    item: { kind: "object", objectType: FUNCTION },
    values: { kind: "json" },
    changedField: { kind: "scalar", type: "string" },
  },
  outputs: {},
  config: {},
  data: {
    form: {
      source: { object: { input: "item" } },
      read: "form",
      params: { values: { input: "values" }, changedField: { input: "changedField" } },
    },
  },
  operations: {
    save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "item" } },
  },
};

const catalogPanel = panelRecord(
  "panel-detail-back-catalog",
  "Catalog",
  definePanel({
    state: {
      search: { type: { kind: "scalar", type: "string" }, deepLink: true },
    },
    members: {},
  }),
);
catalogPanel.content = {
  html: `
    <div id="app" class="test-catalog">
      <span class="catalog-search">{{ search }}</span>
      <button type="button" class="open-detail-a" @click="openA">Open A</button>
    </div>
  `,
  module: `
    import { computed } from "vue";
    import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";
    await mountPanel({
      setup() {
        const { instance, navigate } = usePanelContext();
        const search = computed(() => instance.state.values.value.search ?? "");
        return {
          search,
          openA: () => navigate(panelAddress("${detailAPath}", { selected: "item-a" })),
        };
      },
    });
  `,
};

const detailAPanel = panelRecord(
  "panel-detail-back-a",
  "Detail A",
  definePanel({
    state: {
      selected: { type: { kind: "object", objectType: FUNCTION }, deepLink: true },
    },
    members: {},
  }),
);
detailAPanel.content = {
  html: `
    <div id="app" class="test-detail-a">
      <page-header :title="selectedKey" back-label="Back to catalog" @back="goBack"></page-header>
      <button type="button" class="open-detail-b" @click="openB">Open B</button>
    </div>
  `,
  module: `
    import { computed } from "vue";
    import { mountPanel, panelAddress, usePanelContext } from "@ontomato/sdk/panel";
    await mountPanel({
      setup() {
        const { instance, navigate, navigateBack } = usePanelContext();
        const selectedKey = computed(() => instance.state.values.value.selected?.primaryKey ?? "");
        return {
          selectedKey,
          openB: () => navigate(panelAddress("${detailBPath}", { selected: "item-b" })),
          goBack: () => navigateBack("${catalogPath}"),
        };
      },
    });
  `,
};

const detailBPanel = panelRecord(
  "panel-detail-back-b",
  "Detail B",
  definePanel({
    state: {
      selected: { type: { kind: "object", objectType: FUNCTION }, deepLink: true },
    },
    members: {
      form: { target: { projectionId: formProjection.id }, inputs: { item: { state: "selected" } } },
    },
  }),
);
detailBPanel.content = {
  html: `
    <div id="app" class="test-detail-b">
      <page-header :title="selectedKey" back-label="Back to list" :draft="draft" @back="goBack"></page-header>
      <projection slot="form"></projection>
    </div>
  `,
  module: `
    import { computed } from "vue";
    import { mountPanel, usePanelContext, usePanelFormDraft } from "@ontomato/sdk/panel";
    await mountPanel({
      setup() {
        const { instance, navigateBack } = usePanelContext();
        const selectedKey = computed(() => instance.state.values.value.selected?.primaryKey ?? "");
        const draft = usePanelFormDraft("form");
        return {
          selectedKey,
          draft,
          goBack: () => navigateBack("${catalogPath}"),
        };
      },
    });
  `,
};

const uses = [
  { ...panelUse("use-catalog", "catalog", catalogPanel.id, catalogPath), names: { en: "Catalog" } },
  { ...panelUse("use-detail-a", "detail-a", detailAPanel.id, detailAPath) },
  { ...panelUse("use-detail-b", "detail-b", detailBPanel.id, detailBPath) },
];

const panelsById = new Map([
  [catalogPanel.id, catalogPanel],
  [detailAPanel.id, detailAPanel],
  [detailBPanel.id, detailBPanel],
]);

const saveDescriptor = {
  kind: "form.save",
  handlerRef: `${FUNCTION}.save`,
  label: "Save",
  effect: "write",
  target: { source: "input", input: "item" },
  inputSchema: {},
  resultSchema: {},
  batch: false,
};

const fields = [
  { path: "/name", label: "Name", required: false, readOnly: false, valueSchema: {}, control: { kind: "text" } },
];

function answer(request: Sent) {
  if (request.path === `/api/data-query/platform/applications/${appId}/panel-uses`) {
    return Response.json({
      data: {
        applicationId: appId,
        entry: { path: `/applications/${appId}`, renderer: "panels" },
        panelUses: uses,
      },
    });
  }
  const panelMatch = /^\/api\/product-panels\/([^/]+)$/.exec(request.path);
  if (panelMatch && panelsById.has(panelMatch[1]!)) {
    return panelAnswer(panelsById.get(panelMatch[1]!)!, request);
  }
  const snapshotMatch = /^\/api\/product-panels\/([^/]+)\/snapshot$/.exec(request.path);
  if (snapshotMatch && panelsById.has(snapshotMatch[1]!)) {
    return panelSnapshot(panelsById.get(snapshotMatch[1]!)!, { [formProjection.id]: formProjection }, request);
  }
  if (request.path === `/api/product-projections/${formProjection.id}`) {
    return Response.json({ projection: formProjection });
  }
  if (request.path === "/api/product-panels/read") {
    const body = request.body as { operations?: boolean; inputs?: { item?: unknown; values?: { name?: string } } };
    if (body.operations) return Response.json({ status: "ready", value: body.inputs?.item ? { save: saveDescriptor } : {} });
    return Response.json({
      status: "ready",
      value: {
        fields,
        values: { name: body.inputs?.values?.name ?? "Original" },
        errors: [],
        revision: 1,
        save: { method: "PUT", path: "/items/:id", bodySchema: {} },
      },
    });
  }
  return nothingAt(request);
}

/** Minimal beside-chat host mirroring BusinessWorkbench's `?page=` serialization, push navigation, and dirty guard. */
const BesideChatHost = defineComponent({
  setup() {
    const route = useRoute();
    const router = useRouter();
    const leave = useLeaveConfirmation();
    const queryText = (value: unknown) => (typeof value === "string" ? value : null);
    const resolvePilot = pilotPageResolver((address) => {
      void display.navigate(address, { history: "push" });
    });
    const display = useConversationDisplay({
      features: () => [],
      resolve: (href) => {
        const page = resolvePilot(href);
        return page ? { featureId: page.id, address: href, instance: page.instance ?? href } : null;
      },
      async serialize(page, _view, history) {
        const { page: _page, ...rest } = route.query;
        const to = { query: page ? { ...rest, page: page.address } : rest };
        await (history === "push" ? router.push(to) : router.replace(to));
        return true;
      },
      context: (page, reported) => ({ url: page.address, label: reported?.label ?? "", selection: reported?.selection ?? [] }),
      leave: { leaves: (address) => leave.leaves(address?.split("?")[0] ?? ""), confirm: () => leave.confirm() },
    });
    let activeController: DisplayPageController | null = null;
    const registerActiveController = (instance: string, controller: DisplayPageController) => {
      activeController = controller;
      const unregister = display.registerPageController(instance, controller);
      return () => {
        if (activeController === controller) activeController = null;
        unregister();
      };
    };
    useUnsavedChanges({
      dirty: () => display.isDirty.value,
      paths: () => [route.path],
      guardSamePath: (fullPath) => {
        const nextPage = queryText(router.resolve(fullPath).query.page);
        const currentPage = queryText(route.query.page);
        if (nextPage === currentPage) return Promise.resolve(true);
        const nextBase = nextPage?.split("?", 1)[0] ?? null;
        const currentBase = currentPage?.split("?", 1)[0] ?? null;
        if (nextBase !== currentBase) return leave.confirm();
        return activeController?.guardNavigation?.({ address: nextPage! }) ?? Promise.resolve(true);
      },
    });
    const currentPage = computed(() => {
      const address = queryText(route.query.page);
      return address ? resolvePilot(address) : null;
    });
    const syncFollow = () => display.follow(queryText(route.query.page));
    syncFollow();
    router.afterEach(() => syncFollow());
    return () => {
      const shown = currentPage.value;
      const displayPage: DisplayPage | null = display.page.value;
      if (!shown || !displayPage) return h("div", { class: "chat-only" }, "Chat only");
      return h("div", { class: "beside-pane" }, [
        h(shown.component as never, {
          key: displayPage.instance,
          ...shown.props,
          registerPageController: (controller: DisplayPageController) =>
            registerActiveController(displayPage.instance, controller),
          "onDisplay-address": display.address,
          "onDisplay-dirty": display.dirty,
          "onDisplay-loaded": display.loaded,
          onContext: display.context,
        }),
      ]);
    };
  },
});

function mountApp(initialHash: string, askUnsaved: () => Promise<boolean>) {
  installPanelBackPopStateListener();
  window.history.replaceState(null, "", `/#${initialHash}`);
  const history = createWebHashHistory();
  const router = createRouter({
    history,
    routes: [
      { path: "/agents/chat", component: BesideChatHost },
      {
        path: "/applications/:applicationId/:panelPath(.*)?",
        component: PanelApplicationRoute,
        props: (route) => ({ applicationId: String(route.params.applicationId) }),
      },
    ],
  });
  installPlatform(answer, router);
  let unsavedCheck!: ReturnType<typeof provideUnsavedChanges>;
  const Shell = defineComponent({
    setup() {
      unsavedCheck = provideUnsavedChanges(askUnsaved);
      return () => h(RouterView);
    },
  });
  const mounted = mountPlatformPage(() => h(Shell), router);
  const removeGuard = router.beforeEach((to) => unsavedCheck.allows(to.path, to.fullPath));
  return {
    ...mounted,
    router,
    dispose() {
      removeGuard();
      mounted.app.unmount();
      history.destroy();
    },
  };
}

afterEach(() => {
  leaveFrame();
  window.history.replaceState(null, "", "/");
});

describe("detail panel navigateBack across full-page, standalone, direct open, dirty edits, and beside-chat", () => {
  it("steps back across multiple hops preserving URL state, and guards dirty edits once", async () => {
    let allowLeave = false;
    const askUnsaved = vi.fn(async () => allowLeave);
    const ctx = mountApp(panelAddress(catalogPath, { search: "alpha" }), askUnsaved);
    try {
      await ctx.router.isReady();
      await vi.waitFor(() => expect(ctx.element.querySelector(".open-detail-a")).not.toBeNull());
      expect(ctx.element.querySelector(".catalog-search")?.textContent).toBe("alpha");

      // Catalog -> Detail A -> Detail B.
      ctx.element.querySelector<HTMLButtonElement>(".open-detail-a")!.click();
      await vi.waitFor(() => expect(ctx.element.querySelector(".open-detail-b")).not.toBeNull());
      expect(ctx.router.currentRoute.value.path).toBe(detailAPath);

      ctx.element.querySelector<HTMLButtonElement>(".open-detail-b")!.click();
      await vi.waitFor(() => expect(ctx.element.querySelector('[data-field="/name"] input')).not.toBeNull());
      expect(ctx.router.currentRoute.value.path).toBe(detailBPath);

      // Edit Detail B and click Back -> unified guard prompts once; Cancel stays with edits intact.
      const input = ctx.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      input.value = "Draft edit";
      input.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(ctx.element.querySelector(".sdk-page-header-unsaved")).not.toBeNull());

      allowLeave = false;
      ctx.element.querySelector<HTMLButtonElement>(".test-detail-b .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(askUnsaved).toHaveBeenCalledTimes(1));
      await askUnsaved.mock.results[0]!.value;
      await nextTick();
      expect(ctx.router.currentRoute.value.path).toBe(detailBPath);
      expect(ctx.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!.value).toBe("Draft edit");

      // Confirm -> steps back to Detail A (not catalog!).
      allowLeave = true;
      ctx.element.querySelector<HTMLButtonElement>(".test-detail-b .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(ctx.router.currentRoute.value.path).toBe(detailAPath));
      expect(askUnsaved).toHaveBeenCalledTimes(2);
      expect(panelAddressState(ctx.router.currentRoute.value.fullPath)).toEqual({ selected: "item-a" });

      // Click Back on Detail A -> steps back to Catalog with `?search=alpha` restored.
      await vi.waitFor(() => expect(ctx.element.querySelector(".test-detail-a .sdk-page-header-back")).not.toBeNull());
      ctx.element.querySelector<HTMLButtonElement>(".test-detail-a .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(ctx.router.currentRoute.value.path).toBe(catalogPath));
      expect(panelAddressState(ctx.router.currentRoute.value.fullPath)).toEqual({ search: "alpha" });
      expect(ctx.element.querySelector(".catalog-search")?.textContent).toBe("alpha");
    } finally {
      ctx.dispose();
    }
  });

  it("falls back to the owning catalog when a detail URL is opened directly or standalone with no history", async () => {
    const direct = mountApp(panelAddress(detailAPath, { selected: "item-a" }), async () => true);
    try {
      await direct.router.isReady();
      await vi.waitFor(() => expect(direct.element.querySelector(".test-detail-a .sdk-page-header-back")).not.toBeNull());
      direct.element.querySelector<HTMLButtonElement>(".test-detail-a .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(direct.router.currentRoute.value.path).toBe(catalogPath));
    } finally {
      direct.dispose();
    }

    const standalone = mountApp(`${panelAddress(detailAPath, { selected: "item-a" })}&standalone=1`, async () => true);
    try {
      await standalone.router.isReady();
      await vi.waitFor(() => expect(standalone.element.querySelector(".test-detail-a .sdk-page-header-back")).not.toBeNull());
      standalone.element.querySelector<HTMLButtonElement>(".test-detail-a .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(standalone.router.currentRoute.value.path).toBe(catalogPath));
    } finally {
      standalone.dispose();
    }
  });

  it("behaves consistently beside a conversation for direct open, first side page, multi-hop back, and dirty edits", async () => {
    // 1. Direct open beside chat with no previous history -> falls back to catalog beside chat.
    const directBeside = mountApp(
      `/agents/chat?page=${encodeURIComponent(panelAddress(detailAPath, { selected: "item-a" }))}`,
      async () => true,
    );
    try {
      await directBeside.router.isReady();
      await vi.waitFor(() => expect(directBeside.element.querySelector(".test-detail-a .sdk-page-header-back")).not.toBeNull());
      directBeside.element.querySelector<HTMLButtonElement>(".test-detail-a .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(directBeside.router.currentRoute.value.query.page).toBe(catalogPath));
      expect(directBeside.router.currentRoute.value.path).toBe("/agents/chat");
    } finally {
      directBeside.dispose();
    }

    // 2. Chat without `?page=` -> open Detail A beside chat -> Back falls back to catalog (does not close side pane).
    let allowLeave = false;
    const askUnsaved = vi.fn(async () => allowLeave);
    const beside = mountApp("/agents/chat?sessionId=s1", askUnsaved);
    try {
      await beside.router.isReady();
      await beside.router.push({
        path: "/agents/chat",
        query: { sessionId: "s1", page: panelAddress(detailAPath, { selected: "item-a" }) },
      });
      await vi.waitFor(() => expect(beside.element.querySelector(".test-detail-a .sdk-page-header-back")).not.toBeNull());

      // Click into Detail B beside chat -> edit -> dirty Back prompts once -> Cancel stays -> Confirm returns to Detail A.
      beside.element.querySelector<HTMLButtonElement>(".open-detail-b")!.click();
      await vi.waitFor(() => expect(beside.element.querySelector('[data-field="/name"] input')).not.toBeNull());
      expect(String(beside.router.currentRoute.value.query.page)).toContain(detailBPath);

      const input = beside.element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
      input.value = "Beside draft";
      input.dispatchEvent(new Event("input"));
      await vi.waitFor(() => expect(beside.element.querySelector(".sdk-page-header-unsaved")).not.toBeNull());

      allowLeave = false;
      beside.element.querySelector<HTMLButtonElement>(".test-detail-b .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(askUnsaved).toHaveBeenCalledTimes(1));
      await askUnsaved.mock.results[0]!.value;
      await nextTick();
      expect(String(beside.router.currentRoute.value.query.page)).toContain(detailBPath);

      allowLeave = true;
      beside.element.querySelector<HTMLButtonElement>(".test-detail-b .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(String(beside.router.currentRoute.value.query.page)).toContain(detailAPath));
      expect(askUnsaved).toHaveBeenCalledTimes(2);

      // Now back on Detail A whose previous entry is bare `/agents/chat?sessionId=s1` (no `?page=`) -> Back falls back to catalog beside chat.
      await vi.waitFor(() => expect(beside.element.querySelector(".test-detail-a .sdk-page-header-back")).not.toBeNull());
      beside.element.querySelector<HTMLButtonElement>(".test-detail-a .sdk-page-header-back")!.click();
      await vi.waitFor(() => expect(beside.router.currentRoute.value.query.page).toBe(catalogPath));
      expect(beside.router.currentRoute.value.path).toBe("/agents/chat");
    } finally {
      beside.dispose();
    }
  });
});
