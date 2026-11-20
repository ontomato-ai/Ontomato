import { afterEach, expect, it } from "vitest";
import { computed, createApp, h, nextTick, ref, type Component } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { MemberDataState } from "../../../../../packages/apps-sdk/src/panel/direct";
import { panelMemberKey, type PanelMemberContext } from "../../../../../packages/apps-sdk/src/panel/member";
import { panelContextKey, projectionKey, type PanelContext, type ProjectionSlot } from "../../../../../packages/apps-sdk/src/panel/context";
import AppMenu from "../../../../../packages/apps-sdk/src/base/AppMenu.vue";
import { APPLICATION_PANEL_USE } from "@ontomato/contracts/platform-object-types";
import type { ApplicationMenu } from "../../../../../packages/apps-sdk/src/base/app-menu";

/*
 * The application's menu (design §3): it draws the one menu Java resolved and says only which entry the reader picked —
 * the panel's own `open` event decides where that jump goes, so the component never navigates.
 */

const menu: ApplicationMenu = {
  groups: [
    { key: "reports", names: { en: "Reports", "zh-CN": "报表" }, sort: 20 },
    { key: "orders", names: { en: "Orders", "zh-CN": "订单" }, sort: 10 },
  ],
  panelUses: [
    { id: "orders-open", pageKey: "orders", path: "/app/orders/open", names: { en: "Open orders" }, groupKey: "orders" },
    { id: "home", pageKey: "home", path: "/app/home", names: { en: "Home" } },
    { id: "reports-sales", pageKey: "sales", path: "/app/reports/sales", names: { en: "Sales" }, groupKey: "reports" },
  ],
};

let mounted: { unmount(): void } | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

/** The panel context a component runs under, with the member it is drawn as and the outputs it hands over. */
function contextOf(member: PanelMemberContext, outputs: unknown[]): PanelContext {
  return {
    instance: { output: async (slot: string, output: string, value: unknown) => { outputs.push({ slot, output, value }); } },
  } as unknown as PanelContext;
}

function mount(component: Component, props: Record<string, unknown>, datum: MemberDataState, emitted: unknown[]) {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: publicEn } });
  const data = { use: () => ref(datum), read: async () => datum } as unknown as PanelMemberContext["data"];
  const member: PanelMemberContext = {
    key: "menu",
    projection: { componentId: "@ontomato/sdk:AppMenu", data: {} } as unknown as PanelMemberContext["projection"],
    inputs: computed(() => ({})),
    data,
  };
  const element = document.createElement("div");
  const app = createApp({ render: () => h(component, { ...props }) });
  app.provide(panelMemberKey, () => member);
  app.provide(panelContextKey, contextOf(member, emitted));
  app.provide(projectionKey, { slot: "menu", projection: member.projection, inputs: {} } as unknown as ProjectionSlot);
  app.use(i18n).use(ElementPlus);
  app.mount(element);
  mounted = app;
  return element;
}

/** The menu member's datum as the instance hands it over: the answer, and nothing about how it was read. */
const ready = (value: ApplicationMenu): MemberDataState => ({ status: "ready", value } as unknown as MemberDataState);

it("draws Java's menu in the order the frame shows it, and names the entry the reader picked", async () => {
  const emitted: unknown[] = [];
  const element = mount(AppMenu, {}, ready(menu), emitted);
  await nextTick();
  const buttons = [...element.querySelectorAll(".app-menu-entry")].map((button) => button.textContent?.trim());
  expect(buttons).toEqual(["Home", "Open orders", "Sales"]);
  element.querySelectorAll<HTMLButtonElement>(".app-menu-entry")[1]!.click();
  await nextTick();
  expect(emitted).toEqual([
    { slot: "menu", output: "activated", value: { className: APPLICATION_PANEL_USE, primaryKey: "orders-open" } },
  ]);
});

it("says nothing about an entry the reader may not see, and draws nothing until the datum is there", async () => {
  const emitted: unknown[] = [];
  const loading = mount(AppMenu, {}, { status: "loading" }, emitted);
  expect(loading.querySelectorAll(".app-menu-entry")).toHaveLength(0);
  mounted?.unmount();
  const empty = mount(AppMenu, {}, ready({ groups: [], panelUses: [{ id: "unnamed", pageKey: "unnamed", path: "/app/unnamed" }] }), emitted);
  await nextTick();
  expect(empty.querySelectorAll(".app-menu-entry")).toHaveLength(0);
  expect(emitted).toEqual([]);
});

it("marks the entry the frame says is shown", async () => {
  const element = mount(AppMenu, { active: "reports-sales" }, ready(menu), []);
  await nextTick();
  const active = element.querySelector(".app-menu-entry.active");
  expect(active?.textContent?.trim()).toBe("Sales");
});
