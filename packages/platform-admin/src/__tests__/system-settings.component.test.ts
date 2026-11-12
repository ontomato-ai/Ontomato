import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElMessageBox } from "element-plus";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { ossPlatformPages, systemSettingsTabs } from "../pages";
import { pageActionsKey, providePlatformHost, type PlatformPageActions, type PlatformPageHost } from "../context";
import { shallowRef } from "vue";
import SystemSettingsPage from "../pages/SystemSettingsPage.vue";
import type { PlatformApi } from "../api";
import { PageHeaderStandIn, pageGlobal, testHost } from "./host";
import { ossSystemConfig } from "../../../../apps/workbench/web/src/manager/system-config";

/*
 * The general screen of the system settings: one draft of the whole screen, one Save in the layout's page header, and
 * only the changed settings posted (the data engine takes one setting per request). The DSL timeout is shown in
 * seconds and stored in milliseconds. The screen has no header of its own: the layout's is the only one.
 */

const sent: { path: string; body: unknown }[] = [];
const api: Partial<PlatformApi> = {
  getBusinessConfig: async () => ({
    success: true,
    data: { knowledgeMaxResult: 10, dslCookerTimeout: 300000, lang: "fr", dataAdapter: "", dataAdapterConnections: {} },
  }),
  saveGeneralConfig: async (key: string, value: unknown) => {
    sent.push({ path: key, body: value });
    return { success: true };
  },
};

const wrappers: VueWrapper[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

async function mountPage(config: Record<string, unknown> = {}) {
  sent.length = 0;
  const host: PlatformPageHost = testHost({
    ...api,
    getBusinessConfig: async () => {
      const result = await api.getBusinessConfig!();
      return { ...result, data: { ...result.data, ...config } };
    },
    listDataAdapters: async () => ({ success: true, data: { adapters: [], currentType: "" } }),
  }, {
    navigation: computed(() => ({ groups: [], pages: [...ossPlatformPages] })),
    systemConfig: ossSystemConfig,
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        // The frame belongs to the platform shell; the test draws the header's contract by hand around the page.
        component: {
          render: () => h("div", [h(PageHeaderStandIn, { title: "System Settings" }), h(RouterView)]),
        },
        children: [
          { path: systemSettingsTabs.general.path, component: SystemSettingsPage, meta: { page: "/settings/system-config" } },
          {
            path: systemSettingsTabs.dataAdapters.path,
            component: SystemSettingsPage,
            meta: { page: "/settings/system-config" },
          },
        ],
      },
    ],
  });
  await router.push(systemSettingsTabs.general.path);
  const page = pageGlobal(host);
  // The app provides the header-action slot once; the page writes it and the layout draws it.
  const actions = shallowRef<PlatformPageActions | null>(null);
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: {
      ...page,
      plugins: [...page.plugins, router],
      provide: { ...page.provide, ...providePlatformHost(host), [pageActionsKey as symbol]: actions },
    },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}

const headerSave = (wrapper: VueWrapper) =>
  wrapper.findAll(".page-header .page-actions button").find((button) => button.text() === "Save")!;

describe("system settings, general screen", () => {
  it.each([
    {},
    { knowledgeMaxResult: "10", dslCookerTimeout: "300000" },
    { knowledgeMaxResult: 0, dslCookerTimeout: 0 },
    { knowledgeMaxResult: null, dslCookerTimeout: null },
  ])("switches tabs without a warning or writes after loading %j", async (config) => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockRejectedValue("cancel");
    const { wrapper, router } = await mountPage(config);
    expect(headerSave(wrapper).attributes("disabled")).toBeDefined();
    await router.push(systemSettingsTabs.dataAdapters.path);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(systemSettingsTabs.dataAdapters.path);
    await router.push(systemSettingsTabs.general.path);
    await flushPromises();
    expect(headerSave(wrapper).attributes("disabled")).toBeDefined();
    expect(confirm).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("does not warn when an edit is restored to its loaded value", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockRejectedValue("cancel");
    const { wrapper, router } = await mountPage();
    const input = wrapper.findAll(".setting-row")[0]!.findComponent({ name: "ElInputNumber" });
    input.vm.$emit("update:modelValue", 20);
    await flushPromises();
    expect(headerSave(wrapper).attributes("disabled")).toBeUndefined();
    input.vm.$emit("update:modelValue", 10);
    await flushPromises();
    expect(headerSave(wrapper).attributes("disabled")).toBeDefined();
    await router.push(systemSettingsTabs.dataAdapters.path);
    expect(confirm).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe(systemSettingsTabs.dataAdapters.path);
  });

  it("posts only the changed settings, the timeout in milliseconds", async () => {
    const { wrapper } = await mountPage();
    // Seconds in the interface: the stored 300000 ms shows as 300.
    const timeout = wrapper.findAll(".setting-row")[1]!.findComponent({ name: "ElInputNumber" });
    expect(timeout.props("modelValue")).toBe(300);
    timeout.vm.$emit("update:modelValue", 450);
    await flushPromises();

    expect(headerSave(wrapper).attributes("disabled")).toBeUndefined();
    await headerSave(wrapper).trigger("click");
    await flushPromises();

    expect(sent).toEqual([{ path: "dslCookerTimeout", body: 450000 }]);
    // The stored values become the new baseline: nothing is left to save.
    expect(headerSave(wrapper).attributes("disabled")).toBeDefined();
  });

  it("posts every changed setting once, leaving the untouched one alone", async () => {
    const { wrapper } = await mountPage();
    const rows = wrapper.findAll(".setting-row");
    // The open-source engine ships one language; a stored value it does not ship shows the default until saved.
    expect(rows[2]!.findComponent({ name: "ElSelect" }).props("modelValue")).toBe(ossSystemConfig.defaultLanguage);
    rows[0]!.findComponent({ name: "ElInputNumber" }).vm.$emit("update:modelValue", 25);
    rows[1]!.findComponent({ name: "ElInputNumber" }).vm.$emit("update:modelValue", 600);
    await flushPromises();
    await headerSave(wrapper).trigger("click");
    await flushPromises();
    expect(sent).toHaveLength(2);
    expect(sent).toEqual(
      expect.arrayContaining([
        { path: "knowledgeMaxResult", body: 25 },
        { path: "dslCookerTimeout", body: 600000 },
      ])
    );
  });

  it("asks before leaving the page with unsaved changes", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockRejectedValue("cancel");
    const { wrapper, router } = await mountPage();
    await wrapper.findAll(".setting-row")[0]!.findComponent({ name: "ElInputNumber" }).vm.$emit("update:modelValue", 20);
    await flushPromises();
    await router.push(systemSettingsTabs.dataAdapters.path);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(systemSettingsTabs.general.path);

    confirm.mockResolvedValue("confirm" as never);
    await router.push(systemSettingsTabs.dataAdapters.path);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(systemSettingsTabs.dataAdapters.path);
  });
});
