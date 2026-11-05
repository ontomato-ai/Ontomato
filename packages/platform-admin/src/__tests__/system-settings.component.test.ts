import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElMessageBox } from "element-plus";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { ossPlatformPages, systemSettingsTabs } from "../pages";
import { pageActionsKey, providePlatformHost, type PlatformPageActions, type PlatformPageHost } from "../context";
import { shallowRef } from "vue";
import ServiceLayout from "../layout/ServiceLayout.vue";
import SystemSettingsPage from "../pages/SystemSettingsPage.vue";
import type { PlatformApi } from "../api";
import { pageGlobal, testHost } from "./host";
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

async function mountPage() {
  sent.length = 0;
  const host: PlatformPageHost = testHost(api, {
    navigation: computed(() => ({ groups: [], pages: [...ossPlatformPages] })),
    systemConfig: ossSystemConfig,
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: ServiceLayout,
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
  it("has one page header: the layout's, with the Save in it and the tabs right under it", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.findAll(".page-header")).toHaveLength(1);
    expect(wrapper.find(".page-header .page-title").text()).toBe("System Settings");
    // No second title inside the page body.
    expect(wrapper.findAll(".page-body h1")).toHaveLength(0);
    expect(headerSave(wrapper).attributes("disabled")).toBeDefined();
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

  it("posts the changed settings in the engine's order, leaving the untouched ones alone", async () => {
    const { wrapper } = await mountPage();
    const rows = wrapper.findAll(".setting-row");
    // The open-source engine ships one language; a stored value it does not ship shows the default until saved.
    expect(rows[2]!.findComponent({ name: "ElSelect" }).props("modelValue")).toBe(ossSystemConfig.defaultLanguage);
    rows[0]!.findComponent({ name: "ElInputNumber" }).vm.$emit("update:modelValue", 25);
    rows[1]!.findComponent({ name: "ElInputNumber" }).vm.$emit("update:modelValue", 600);
    await flushPromises();
    await headerSave(wrapper).trigger("click");
    await flushPromises();
    expect(sent).toEqual([
      { path: "knowledgeMaxResult", body: 25 },
      { path: "dslCookerTimeout", body: 600000 },
    ]);
  });

  it("asks before leaving the page with unsaved changes", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockRejectedValue("cancel");
    const { wrapper, router } = await mountPage();
    await wrapper.findAll(".setting-row")[0]!.findComponent({ name: "ElInputNumber" }).vm.$emit("update:modelValue", 20);
    await flushPromises();
    await router.push(systemSettingsTabs.dataAdapters.path);
    await flushPromises();
    expect(String(confirm.mock.calls[0]![0])).toContain("unsaved changes");
    expect(router.currentRoute.value.path).toBe(systemSettingsTabs.general.path);

    confirm.mockResolvedValue("confirm" as never);
    await router.push(systemSettingsTabs.dataAdapters.path);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(systemSettingsTabs.dataAdapters.path);
  });
});
