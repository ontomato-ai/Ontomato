import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElMessageBox } from "element-plus";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { ossPlatformPages, platformPages } from "../pages";
import { providePlatformHost, type PlatformPageHost } from "../context";
import GeneralSettingsPage from "../pages/GeneralSettingsPage.vue";
import DataAdaptersPage from "../pages/DataAdaptersPage.vue";
import type { PlatformApi } from "../api";
import { PageFrameStandIn, headerButton, pageGlobal, testHost } from "./host";
import { ossSystemConfig } from "../../../../apps/workbench/web/src/manager/system-config";

/*
 * The general page of the system settings: one draft of the whole page, one Save in the frame's page header, and only
 * the changed settings posted (the data engine takes one setting per request). The DSL timeout is shown in seconds and
 * stored in milliseconds. The page has no header of its own: the frame's is the only one.
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
        // The frame belongs to the platform; the test assembles the shell's header and leave check around the page.
        component: { render: () => h(PageFrameStandIn, { title: "General" }) },
        children: [
          { path: platformPages.general.path, component: GeneralSettingsPage, meta: { page: platformPages.general.path } },
          {
            path: platformPages.dataAdapters.path,
            component: DataAdaptersPage,
            meta: { page: platformPages.dataAdapters.path },
          },
        ],
      },
    ],
  });
  await router.push(platformPages.general.path);
  const page = pageGlobal(host);
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: {
      ...page,
      plugins: [...page.plugins, router],
      provide: { ...page.provide, ...providePlatformHost(host) },
    },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router };
}

const headerSave = (wrapper: VueWrapper) => headerButton(wrapper, "Save")!;

describe("system settings, general page", () => {
  it.each([
    {},
    { knowledgeMaxResult: "10", dslCookerTimeout: "300000" },
    { knowledgeMaxResult: 0, dslCookerTimeout: 0 },
    { knowledgeMaxResult: null, dslCookerTimeout: null },
  ])("moves to another page without a warning or writes after loading %j", async (config) => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockRejectedValue("cancel");
    const { wrapper, router } = await mountPage(config);
    expect(headerSave(wrapper).attributes("disabled")).toBeDefined();
    await router.push(platformPages.dataAdapters.path);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformPages.dataAdapters.path);
    await router.push(platformPages.general.path);
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
    await router.push(platformPages.dataAdapters.path);
    expect(confirm).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe(platformPages.dataAdapters.path);
  });

  it("has one page header: the frame's, with only a disabled Save while nothing changed", async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.findAll(".platform-page-header")).toHaveLength(1);
    expect(wrapper.find(".platform-page-header .page-title").text()).toBe("General");
    // No second title inside the page.
    expect(wrapper.findAll(".settings-page h1, .settings-page h2")).toHaveLength(0);
    expect(headerSave(wrapper).attributes("disabled")).toBeDefined();
    expect(headerButton(wrapper, "Discard")).toBeUndefined();
    expect(wrapper.find(".platform-page-header .unsaved").exists()).toBe(false);
  });

  it("shows Discard and the unsaved marker once something changed", async () => {
    const { wrapper } = await mountPage();
    wrapper.findAll(".setting-row")[0]!.findComponent({ name: "ElInputNumber" }).vm.$emit("update:modelValue", 20);
    await flushPromises();
    expect(headerSave(wrapper).attributes("disabled")).toBeUndefined();
    expect(headerButton(wrapper, "Discard")).toBeDefined();
    expect(wrapper.find(".platform-page-header .unsaved").text()).toBe("Unsaved changes");
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
    await router.push(platformPages.dataAdapters.path);
    await flushPromises();
    expect(String(confirm.mock.calls[0]![0])).toContain("unsaved changes");
    expect(router.currentRoute.value.path).toBe(platformPages.general.path);

    confirm.mockResolvedValue("confirm" as never);
    await router.push(platformPages.dataAdapters.path);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformPages.dataAdapters.path);
  });
});
