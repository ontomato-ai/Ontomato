import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, shallowRef } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { ossSystemConfig as businessConfig } from "../../../../apps/workbench/web/src/manager/system-config";
import { createPlatformClient, platformApi } from "../api";
import { pageActionsKey, type PlatformPageActions } from "../context";
import { ossPlatformPages, systemSettingsTabs } from "../pages";
import SystemSettingsPage from "../pages/SystemSettingsPage.vue";
import { PageHeaderStandIn, pageGlobal, testHost } from "./host";

/** Language resources the open-source data engine ships (conf-defaults/lang/*.json); tests run from this package. */
const shippedLanguages = readdirSync(resolve(process.cwd(), "../data-engine-core/conf-defaults/lang"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.replace(/\.json$/, ""));

interface Sent {
  url: string;
  body: unknown;
}
let sent: Sent[];
let storedLang: string;
let wrappers: VueWrapper[] = [];

beforeEach(() => {
  sent = [];
  wrappers = [];
  storedLang = "fr";
  vi.stubGlobal("fetch", async (url: string, init: { body?: string }) => {
    sent.push({ url, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const data = url.endsWith("/businessConfig/getConfig")
      ? { agents: { coding: { model: null } }, lang: storedLang, dataAdapter: "", dataAdapterConnections: {} }
      : url.endsWith("/businessConfig/dataAdapters")
        ? { currentType: "", adapters: [] }
        : [];
    return new Response(JSON.stringify({ success: true, data }), { headers: { "Content-Type": "application/json" } });
  });
});

afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** The general screen mounted as the page shows it: inside the layout, whose header carries the one Save. */
async function mountPage() {
  const api = platformApi(createPlatformClient({ apiBase: "/api", credential: { type: "anonymous" }, locale: () => "en" }));
  const host = testHost(api, {
    navigation: computed(() => ({ groups: [], pages: [...ossPlatformPages] })),
    systemConfig: businessConfig,
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
        ],
      },
    ],
  });
  await router.push(systemSettingsTabs.general.path);
  const actions = shallowRef<PlatformPageActions | null>(null);
  const page = pageGlobal(host);
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: {
      ...page,
      plugins: [...page.plugins, router],
      provide: { ...page.provide, [pageActionsKey as symbol]: actions },
    },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const general = (wrapper: VueWrapper) => wrapper.findAll(".setting-row")[2]!;
const headerSave = (wrapper: VueWrapper) =>
  wrapper.findAll(".page-header .page-actions button").find((button) => button.text() === "Save")!;

describe("open-source general settings in the Ontology Manager", () => {
  it("offers only the backend languages the data engine ships; a stored unsupported value shows en and is saved only on request", async () => {
    expect(businessConfig.languageOptions.map(({ value }) => value)).toEqual(shippedLanguages);
    const wrapper = await mountPage();
    const language = general(wrapper).findComponent({ name: "ElSelect" });
    expect(language.props("modelValue")).toBe("en");
    await language.find(".el-select__wrapper").trigger("click");
    await flushPromises();
    // The dropdown list is teleported; the select's input names it through aria-controls.
    const list = document.getElementById(language.find("input").attributes("aria-controls")!)!;
    expect([...list.querySelectorAll(".el-select-dropdown__item")].map((item) => item.textContent?.trim())).toEqual([
      "English",
    ]);
    expect(sent.some((request) => request.url.endsWith("/businessConfig/saveLang"))).toBe(false);
    // Nothing changed on the screen, so the header's Save is disabled: no setting is written on arrival.
    expect(headerSave(wrapper).attributes("disabled")).toBeDefined();
  });

  it("no longer carries query examples (they moved to their own menu page)", async () => {
    await mountPage();
    expect(sent.some((request) => request.url.endsWith("/bussinessexample/getall"))).toBe(false);
  });
});
