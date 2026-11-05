import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter } from "vue-router";
import en from "element-plus/es/locale/lang/en";
import { installWorkbenchI18n } from "@ontomato/workbench-ui/i18n";
import { installAuthHost } from "@ontomato/workbench-ui/utils/auth";
import publicEn from "@ontomato/workbench-ui/locales/en";
import PlatformSchedulesRoute from "../pages/PlatformSchedulesRoute.vue";

/*
 * The platform's scheduled-tasks page, with the one host both places share. What this guards: creating a task offers the
 * agents the Node API returns — on the deployed build the dialog's picker was empty because the page asked the
 * data-query interface, which serves no such list.
 */
const requests: string[] = [];

/** Requests carry the session's credential through the auth host, which the entry installs once at startup. */
installAuthHost({
  getToken: () => null,
  getApiKey: () => null,
  responseStatusError: () => null,
  getUserInfo: () => null,
  verifySessionOnce: () => Promise.resolve("valid"),
  handleAuthExpired: () => {},
});

/** The page reads the platform's language; the host installs it once before mounting. */
const i18n = installWorkbenchI18n({
  supported: ["en"],
  defaultLocale: "en",
  initialLocale: "en",
  switchEnabled: false,
  save: null,
  messages: { en: publicEn },
  elementLocale: () => en,
});

beforeEach(() => {
  requests.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/assistant/agents")) {
      return json({
        agents: [
          { id: "3f4b0d0e-1c2a-4f6e-9a0b-2d5c8e7f1a34", name: "Order agent", description: "", icon: null, enabled: true },
        ],
      });
    }
    return json({ success: true, data: [] });
  });
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/schedules", component: PlatformSchedulesRoute },
      { path: "/agents/chat", component: { template: "<div />" } },
    ],
  });
  await router.push("/schedules");
  await router.isReady();
  const wrapper = mount(PlatformSchedulesRoute, { global: { plugins: [i18n, ElementPlus, router] } });
  await flushPromises();
  return wrapper;
}

describe("the platform's scheduled-tasks page", () => {
  it("offers the Node API's agents when a task is created", async () => {
    const wrapper = await mountPage();
    expect(requests.some((url) => url.includes("/assistant/agents")), "the page never asked for the agents").toBe(true);
    expect(requests.every((url) => !url.includes("/data-query/assistant/agents"))).toBe(true);

    // The create entry opens the dialog; the picker inside it is fed by the host's list.
    // The page's words come from the public English tree it was just merged into: no raw `platformSchedules.*` key.
    expect(wrapper.text()).not.toContain("platformSchedules.");
    const create = wrapper.findAll("button").find((button) => button.text().includes("New task"));
    expect(create, "the page has no entry to create a task").toBeDefined();
    await create!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Order agent");
  });
});
