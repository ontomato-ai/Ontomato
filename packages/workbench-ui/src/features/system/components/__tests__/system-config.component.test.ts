import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import QuerySettingsCard from "../business-config/QuerySettingsCard.vue";
import SystemConfig from "../SystemConfig.vue";
import { workbenchI18n } from "../../../../i18n";

const sent = vi.hoisted(() => ({ system: null as unknown }));

vi.mock("../../../admin", () => ({
  adminApi: {
    getSystemModelConfig: vi.fn(async () => ({ success: true, data: { queryTimeoutSeconds: 600 } })),
    saveSystemModelConfig: vi.fn(async (payload: Record<string, unknown>) => {
      sent.system = JSON.parse(JSON.stringify(payload));
      return { success: true, data: { ...payload } };
    }),
  },
}));

const i18n = workbenchI18n();
const t = i18n.global.t as (key: string) => string;
const global = { plugins: [i18n, ElementPlus] };

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  sent.system = null;
});

function button(wrapper: Pick<ReturnType<typeof mount>, "findAll">, text: string) {
  return wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
}

describe("query settings card", () => {
  it("shows the load error with retry and blocks save", async () => {
    const wrapper = mount(QuerySettingsCard, {
      props: { model: { queryTimeoutSeconds: 600 }, loading: false, saving: false, loadError: "node down" },
      global,
    });
    wrappers.push(wrapper);
    expect(wrapper.find(".load-error").text()).toContain("node down");
    expect(button(wrapper, t("common.saveConfig"))!.attributes("disabled")).toBeDefined();
    await button(wrapper, t("common.retry"))!.trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
  });
});

describe("system config page", () => {
  it("reads and writes only the query timeout setting", async () => {
    const page = mount(SystemConfig, { global });
    wrappers.push(page);
    await flushPromises();
    const query = page.findComponent(QuerySettingsCard);
    await query.find(".el-input-number input").setValue("900");
    await button(query, t("common.saveConfig"))!.trigger("click");
    await flushPromises();
    expect(sent.system).toEqual({ queryTimeoutSeconds: 900 });
    expect(query.find(".dirty-tag").exists()).toBe(false);
  });
});
