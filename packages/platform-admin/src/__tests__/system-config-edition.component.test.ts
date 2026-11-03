import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SystemConfigPage from "../pages/SystemConfigPage.vue";
import { createPlatformClient, platformApi } from "../api";
import { ossSystemConfig as businessConfig } from "../../../../apps/ontology-manager/src/system-config";
import { pageGlobal, testHost, testI18n } from "./host";

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

beforeEach(() => {
  sent = [];
  storedLang = "fr";
  vi.stubGlobal("fetch", async (url: string, init: { body?: string }) => {
    sent.push({ url, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const data = url.endsWith("/businessConfig/getConfig")
      ? { agents: { coding: { model: null } }, lang: storedLang, dataAdapter: "", dataAdapterConnections: {} }
      : url.endsWith("/businessConfig/dataAdapters")
        ? { currentType: "", adapters: [] }
        : [];
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { "Content-Type": "application/json" },
    });
  });
});

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function mountPage() {
  const api = platformApi(
    createPlatformClient({ apiBase: "/api", credential: { type: "anonymous" }, locale: () => "en" })
  );
  const page = mount(SystemConfigPage, {
    global: pageGlobal(testHost(api, { systemConfig: businessConfig })),
    attachTo: document.body,
  });
  wrappers.push(page);
  await flushPromises();
  return page;
}

const t = testI18n().global.t as (key: string) => string;

describe("open-source system configuration page in the Ontology Manager", () => {
  it("offers only the backend languages the data engine ships; a stored unsupported value shows en and is saved only on request", async () => {
    expect(businessConfig.languageOptions.map(({ value }) => value)).toEqual(shippedLanguages);
    const page = await mountPage();
    const languageRow = page
      .findAll(".el-form-item")
      .find((item) => item.text().includes(t("admin.backendLanguage")))!;
    await languageRow.find(".el-select__wrapper").trigger("click");
    await flushPromises();
    // The dropdown list is teleported; the select's input names it through aria-controls.
    const list = document.getElementById(languageRow.find("input").attributes("aria-controls")!)!;
    const options = [...list.querySelectorAll(".el-select-dropdown__item")].map((item) => item.textContent?.trim());
    expect(options).toEqual(["English"]);
    expect(list.querySelector(".el-select-dropdown__item.is-selected")?.textContent?.trim()).toBe("English");
    expect(sent.some((request) => request.url.endsWith("/businessConfig/saveLang"))).toBe(false);

    await languageRow.find("button.el-button--primary").trigger("click");
    await flushPromises();
    expect(sent.find((request) => request.url.endsWith("/businessConfig/saveLang"))?.body).toEqual({
      lang: "en",
    });
  });

  it("no longer carries query examples (they moved to their own menu page)", async () => {
    await mountPage();
    expect(sent.some((request) => request.url.endsWith("/bussinessexample/getall"))).toBe(false);
  });
});
