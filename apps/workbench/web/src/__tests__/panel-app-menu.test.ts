import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, nextTick, provide, ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { ApplicationEntryMenu, CurrentApplicationEntry } from "@ontomato/contracts/product-panels";
import type { AppMenuGroup } from "@ontomato/platform-shell";
import AppMenu from "../../../../../packages/apps-sdk/src/base/AppMenu.vue";
import { panelContextKey, type PanelContext } from "../../../../../packages/apps-sdk/src/panel/context";
import { prepareTemplateComponents } from "../../../../../packages/apps-sdk/src/panel/template-components";
import { baseComponents } from "../../../../../packages/apps-sdk/src/base-components";

const i18n = (locale = "en") =>
  createI18n({ legacy: false, locale, messages: { en: publicEn, "zh-CN": publicEn } });

afterEach(() => {
  document.body.innerHTML = "";
});

function createMockPanelContext(options: {
  currentEntry?: CurrentApplicationEntry | null;
  entryMenu?: ApplicationEntryMenu | null;
  hostMenu?: readonly AppMenuGroup[] | null;
  navigate?: (address: string) => Promise<void>;
}) {
  const currentEntry = ref<CurrentApplicationEntry | null>(options.currentEntry ?? null);
  const entryMenu = ref<ApplicationEntryMenu | null>(options.entryMenu ?? null);
  const hostMenu = ref<readonly AppMenuGroup[] | null>(options.hostMenu ?? null);
  const navigate = vi.fn(options.navigate ?? (async () => {}));
  const context = {
    currentEntry: computed(() => currentEntry.value),
    entryMenu: computed(() => entryMenu.value),
    hostMenu: computed(() => hostMenu.value),
    navigate,
  } as unknown as PanelContext;
  return { context, currentEntry, entryMenu, hostMenu, navigate };
}

describe("official SDK AppMenu component", () => {
  it("derives groups, active highlight, counts, icons, and automatic navigation from frame context", async () => {
    const { context, currentEntry, navigate } = createMockPanelContext({
      currentEntry: {
        applicationId: "app-demo",
        useId: "overview",
        pageKey: "demo-overview",
        panelId: "panel-overview",
        path: "/applications/app-demo/overview",
      },
      entryMenu: {
        groups: [
          { key: "second", names: { en: "Second group", "zh-CN": "第二组" }, sort: 2 },
          { key: "first", names: { en: "First group", "zh-CN": "第一组" }, sort: 1 },
        ],
        panelUses: [
          {
            id: "overview",
            pageKey: "demo-overview",
            panelId: "panel-overview",
            path: "/applications/app-demo/overview",
            access: { kind: "domain-member" },
            names: { en: "Overview", "zh-CN": "概览" },
            groupKey: "first",
          },
          {
            id: "items",
            pageKey: "demo-items",
            panelId: "panel-items",
            path: "/applications/app-demo/items",
            access: { kind: "domain-member" },
            names: { en: "Items", "zh-CN": "条目" },
            groupKey: "second",
          },
          {
            id: "hidden",
            pageKey: "demo-hidden",
            panelId: "panel-hidden",
            path: "/applications/app-demo/hidden",
            access: { kind: "domain-member" },
          },
        ],
      },
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      setup() {
        provide(panelContextKey, context);
        return () =>
          h(AppMenu, {
            title: "Demo App",
            counts: { "/applications/app-demo/items": 9 },
            icons: { "/applications/app-demo/overview": "network", "/applications/app-demo/items": "boxes" },
          });
      },
    }));
    app.use(i18n("en"));
    app.mount(host);
    await nextTick();

    expect([...host.querySelectorAll(".group-heading")].map((el) => el.textContent)).toEqual([
      "First group",
      "Second group",
    ]);
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".page-row")];
    expect(rows).toHaveLength(2);
    expect(host.querySelectorAll(".page-row.active")).toHaveLength(1);
    expect(host.querySelector(".page-row.active")?.textContent).toContain("Overview");
    expect(rows[1]?.querySelector(".page-count")?.textContent).toBe("9");

    rows[1]?.click();
    expect(navigate).toHaveBeenCalledWith("/applications/app-demo/items");

    // Moving to another entry updates the single active highlight.
    currentEntry.value = {
      applicationId: "app-demo",
      useId: "items",
      pageKey: "demo-items",
      panelId: "panel-items",
      path: "/applications/app-demo/items",
    };
    await nextTick();
    expect(host.querySelectorAll(".page-row.active")).toHaveLength(1);
    expect(host.querySelector(".page-row.active")?.textContent).toContain("Items");

    app.unmount();
  });

  it("prefers hostMenu for hybrid built-in applications and respects explicit @select without double-navigating", async () => {
    const onSelect = vi.fn();
    const { context, navigate } = createMockPanelContext({
      currentEntry: {
        applicationId: "ontology",
        useId: "ontology-playground",
        pageKey: "ontology-playground",
        panelId: "builtin-product-ontology-graph",
        path: "/ontology/playground",
      },
      entryMenu: { groups: [], panelUses: [] },
      hostMenu: [
        {
          key: "ontology:facts",
          label: "Facts",
          items: [
            { id: "/ontology/playground", label: "Ontology graph" },
            { id: "/ontology/objects", label: "Object types" },
          ],
        },
        {
          key: "ontology:governance",
          label: "Governance",
          items: [
            { id: "/permissions/members", label: "Members", count: 7 },
          ],
        },
      ],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
      setup() {
        provide(panelContextKey, context);
        return () =>
          h(AppMenu, {
            title: "Ontology manager",
            counts: { "/ontology/objects": 18 },
            onSelect,
          });
      },
    }));
    app.use(i18n("en"));
    app.mount(host);
    await nextTick();

    const rows = [...host.querySelectorAll<HTMLButtonElement>(".page-row")];
    expect(rows.find((row) => row.textContent?.includes("Object types"))?.querySelector(".page-count")?.textContent).toBe("18");
    expect(rows.find((row) => row.textContent?.includes("Members"))?.querySelector(".page-count")?.textContent).toBe("7");

    rows.find((row) => row.textContent?.includes("Members"))?.click();
    expect(onSelect).toHaveBeenCalledWith("/permissions/members");
    expect(navigate).not.toHaveBeenCalled();

    app.unmount();
  });

  it("registers <app-menu> through prepareTemplateComponents as an official template tag", async () => {
    const install = await prepareTemplateComponents(`<div id="app"><app-menu title="Catalog" /></div>`, baseComponents);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp({ data: () => ({ groups: [{ key: "g", items: [{ id: "/a", label: "Alpha", count: 3 }] }] }), template: `<div id="app"><app-menu title="Catalog" :groups="groups" active-id="/a" /></div>` });
    install(app);
    app.use(i18n("en"));
    app.mount(host);
    await nextTick();

    expect(host.querySelector(".app-menu-title")?.textContent).toBe("Catalog");
    expect(host.querySelector(".page-row.active")?.textContent).toContain("Alpha");
    expect(host.querySelector(".page-count")?.textContent).toBe("3");

    app.unmount();
  });
});
