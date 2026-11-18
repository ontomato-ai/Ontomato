import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import elementEn from "element-plus/es/locale/lang/en";

/*
 * The page of a panel application (design 10.3, fourth check): a selection the panel reports is written into the page's
 * address without rebuilding the panel, a reload restores that view, and the same page beside the conversation writes
 * into the conversation's address instead.
 *
 * The mistakes these catch: keying the instance by the whole address, so writing the state replaces the key, rebuilds
 * the frame and drops the selection; and reading the address back into the instance, which turns its own report into a
 * loop.
 */

const skill = { namespace: { kind: "provider", provider: "workbench" }, name: "panels" } as const;
const uses: ApplicationPanelUse[] = [
  { id: "use-tasks", panelId: "panel-tasks", path: "/tasks", pageKey: "panels-trial-a-tasks", access: { kind: "domain-member" }, skill },
  { id: "use-summary", panelId: "panel-summary", path: "/summary", pageKey: "panels-trial-a-summary", access: { kind: "domain-member" }, skill },
];

/** Every panel instance the route mounted, and the address each last reported. */
const mountedInstances: { useId: string; address: ReturnType<typeof ref<string>>; initial: Record<string, unknown> }[] = [];

vi.mock("../panel-host", () => ({
  panelUsesOf: async () => uses,
  platformPanelHost: () => ({}),
}));

vi.mock("@ontomato/platform-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/platform-shell")>()),
  // Stands in for the frame: it reports an address the way a panel's own state report does.
  PanelHost: defineComponent({
    props: { useId: { type: String, required: true }, address: { type: String, required: true }, initial: { type: Object, default: () => ({}) }, label: { type: String, default: "" }, labels: Object },
    emits: ["address"],
    setup(props, { emit }) {
      const address = ref(props.address);
      mountedInstances.push({ useId: props.useId, address, initial: props.initial });
      return () =>
        h("div", { "data-use": props.useId }, [
          h("button", { "data-select": "task-2", onClick: () => emit("address", `${props.address}?state=${encodeURIComponent(JSON.stringify({ selectedTask: { className: "platform:ScheduledTask", primaryKey: "task-2" } }))}`) }),
        ]);
    },
  }),
}));

const PanelApplicationRoute = (await import("../pages/PanelApplicationRoute.vue")).default;

beforeAll(() => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
    messages: { en: publicEn }, elementLocale: () => elementEn,
  });
});

beforeEach(() => {
  mountedInstances.length = 0;
});

async function mountAt(path: string, props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/applications/:applicationId/:panelPath(.*)",
        component: PanelApplicationRoute,
        // The page's address names the application and the use relation, as the platform's own route table does.
        props: (route) => ({ ...props, applicationId: String(route.params.applicationId), panelPath: String(route.params.panelPath ?? "") }),
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), { global: { plugins: [router, workbenchI18n()] } });
  await flushPromises();
  return { router, wrapper };
}

describe("a panel application's page", () => {
  it("writes a selection into the address without rebuilding the instance", async () => {
    const { router, wrapper } = await mountAt("/applications/app-a/tasks");
    expect(mountedInstances.map((one) => one.useId)).toEqual(["use-tasks"]);

    await wrapper.get("[data-select]").trigger("click");
    await flushPromises();
    // The address carries the selection …
    expect(panelAddressState(router.currentRoute.value.fullPath)).toEqual({
      selectedTask: { className: "platform:ScheduledTask", primaryKey: "task-2" },
    });
    // … and the instance is the same one: the reader's selection in the panel survived the write.
    expect(mountedInstances).toHaveLength(1);
  });

  it("restores the view from the address on reload", async () => {
    const state = { selectedTask: { className: "platform:ScheduledTask", primaryKey: "task-2" } };
    const { router } = await mountAt(`/applications/app-a/tasks?state=${encodeURIComponent(JSON.stringify(state))}`);
    expect(router.currentRoute.value.path).toBe("/applications/app-a/tasks");
    // The instance starts from what the address named.
    expect(mountedInstances[0]!.initial).toEqual(state);
  });

  it("keeps one instance per application and use relation, across addresses of the same page", async () => {
    const { router, wrapper } = await mountAt("/applications/app-a/tasks");
    await router.replace(`/applications/app-a/tasks?state=${encodeURIComponent(JSON.stringify({ selectedTask: { className: "platform:ScheduledTask", primaryKey: "task-2" } }))}`);
    await flushPromises();
    expect(mountedInstances).toHaveLength(1);
    // The state read once is the one the page opened at, not the one just written.
    expect(mountedInstances[0]!.initial).toEqual({});

    // The other relation is another page, and another panel.
    await router.replace("/applications/app-a/summary");
    await flushPromises();
    expect(mountedInstances.map((one) => one.useId)).toEqual(["use-tasks", "use-summary"]);
    wrapper.unmount();
  });

  it("says, in the platform's language, that an address names no panel of the application", async () => {
    const { wrapper } = await mountAt("/applications/app-a/reports");
    expect(wrapper.get("[role=alert]").text()).toBe("/reports is not a panel of this application");
    expect(mountedInstances).toEqual([]);
    wrapper.unmount();
  });

  it("beside the conversation, the selection goes to the conversation's address", async () => {
    const written: string[] = [];
    const { router, wrapper } = await mountAt("/applications/app-a/tasks", { navigate: (next: string) => written.push(next) });
    await wrapper.get("[data-select]").trigger("click");
    await flushPromises();
    // The page's own address (the conversation's) holds it; the router's address is not written.
    expect(written).toHaveLength(1);
    expect(panelAddressState(written[0]!)).toEqual({ selectedTask: { className: "platform:ScheduledTask", primaryKey: "task-2" } });
    expect(router.currentRoute.value.fullPath).toBe("/applications/app-a/tasks");
    wrapper.unmount();
  });
});
