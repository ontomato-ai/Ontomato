import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { pageCounterKey } from "@ontomato/agent-shell-ui";
import {
  pilotPageKey,
  platformPageAccessKey,
  provideUnsavedChanges,
  useUnsavedChanges,
  type PilotPage,
} from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import en from "@ontomato/workbench-ui/locales/en";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import elementEn from "element-plus/es/locale/lang/en";
import { displayOf, openLink, paneButton } from "../../../workbench-ui/src/features/workbench/__tests__/shell";

/*
 * What sits beside the agent platform's conversation has one controller. The address is its input and the reader's
 * navigation its result: a page the reader opened is in the address and comes back with a reload, a page that would drop
 * unsaved changes keeps the reader — page and address both — until they agree, and a page tells its own state apart
 * from the reader navigating.
 */
vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  useSessionRunFeed: () => {},
}));
vi.mock("../../../workbench-ui/src/features/workbench/api", () => ({ getWorkbenchAppearance: async () => null }));
vi.mock("../../../workbench-ui/src/features/workbench/assistant-host", async (importOriginal) => {
  const { assistantHostDouble } = await import("../../../workbench-ui/src/features/workbench/__tests__/shell");
  return {
    ...(await importOriginal<object>()),
    createAssistantClient: () => assistantHostDouble(),
    createAssistantFeedback: () => undefined,
    createPanelOperationSettings: () => undefined,
  };
});

installWorkbenchI18n({
  supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
  messages: { en }, elementLocale: () => elementEn,
});

/** What the pages report to their display, and what the reader answers when asked to drop unsaved changes. */
const reports = vi.hoisted(() => ({ dirty: false, nativeDirty: false, leave: false }));

/**
 * A page beside the conversation that reports to its display: unsaved changes (as a panel does), its own state, and a
 * move the reader asked for. Its address is what it shows.
 */
const ReportingPage = defineComponent({
  props: { address: { type: String, required: true } },
  emits: ["display-address", "display-dirty"],
  setup(props, { emit }) {
    emit("display-dirty", reports.dirty);
    return () =>
      h("div", { class: "reporting-page" }, [
        h("span", { class: "shown" }, props.address),
        h("button", {
          class: "state",
          onClick: () => emit("display-address", { kind: "state", address: `${props.address.split("?")[0]}?selected=row-2` }),
        }),
        h("button", { class: "navigate", onClick: () => emit("display-address", { kind: "navigate", address: "/second" }) }),
      ]);
  },
});

/** A native page whose draft the platform's leave guard knows: dirty, and edited only at its own address. */
const DraftPage = defineComponent({
  props: { address: { type: String, required: true } },
  setup(props) {
    useUnsavedChanges({ dirty: () => reports.nativeDirty, paths: () => [props.address.split("?")[0]!] });
    return () => h("div", { class: "draft-page" }, props.address);
  },
});

/** The assembly's registry: the two pages under the ids of pages this application sits beside its conversation. */
const registry = () => (address: string): PilotPage | null => {
  const path = address.split("?")[0]!;
  if (path === "/first" || path === "/second") return { id: "dashboards", component: ReportingPage, instance: path, props: { address } };
  if (path === "/draft") return { id: "agents", component: DraftPage, props: { address } };
  return null;
};

/** The platform frame around the application: it asks before a dirty draft is left, here answered as the test says. */
const Frame = defineComponent({
  setup() {
    const unsaved = provideUnsavedChanges(async () => reports.leave);
    router.beforeEach((to) => unsaved.allows(to.path));
    return () => h(BusinessWorkbench, { defaultLogo: "", defaultBrandName: "Ontomato" });
  },
});

let router: Router;
const wrappers: VueWrapper[] = [];
beforeEach(async () => {
  setActivePinia(createPinia());
  Object.assign(reports, { dirty: false, nativeDirty: false, leave: false });
  vi.stubGlobal("fetch", async () => Response.json({ data: null }));
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        name: platformRoutes.layout.name,
        redirect: platformRoutes.chat.path,
        component: { template: "<router-view />" },
        children: [{ ...platformRoutes.chat, component: { template: "<div />" } }],
      },
      { path: "/:unknown(.*)*", redirect: platformRoutes.chat.path },
    ],
  });
  await router.push(platformRoutes.chat.path);
  await router.isReady();
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function workbench() {
  const wrapper = mount(Frame, {
    global: {
      plugins: [workbenchI18n(), ElementPlus, router],
      provide: {
        [pilotPageKey as symbol]: registry,
        [platformPageAccessKey as symbol]: () => true,
        [pageCounterKey as symbol]: { agents: async () => [], preferredAgentId: ref<string | null>(null), ask: () => {} },
      },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const pageParameter = () => router.currentRoute.value.query.page;

describe("the reader's navigation", () => {
  it("is written to the address and comes back with a reload", async () => {
    const wrapper = await workbench();
    await openLink(wrapper, "/first");
    expect(pageParameter()).toBe("/first");
    expect(displayOf(wrapper).restorable.value).toBe(true);

    wrappers.splice(0).forEach((shown) => shown.unmount());
    const reloaded = await workbench();
    expect(displayOf(reloaded).page.value?.address).toBe("/first");
    expect(reloaded.find(".reporting-page .shown").text()).toBe("/first");
  });

  it("takes a card's place out of the address, so a reload does not bring the replaced page back", async () => {
    const wrapper = await workbench();
    await openLink(wrapper, "/first");

    await displayOf(wrapper).openArtifact({
      key: "run:outputs/result.dataset.json",
      artifact: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", runId: "run", path: "outputs/result.dataset.json" } as never,
      title: "Result",
    });
    await flushPromises();
    expect(displayOf(wrapper).target.value?.kind).toBe("artifact");
    expect(pageParameter()).toBeUndefined();
  });
});

describe("a page's own reports", () => {
  it("moves the address with the page's state, and keeps the same page mounted", async () => {
    const wrapper = await workbench();
    await openLink(wrapper, "/first");
    const page = wrapper.find(".reporting-page").element;

    await wrapper.find(".reporting-page .state").trigger("click");
    await flushPromises();
    expect(pageParameter()).toBe("/first?selected=row-2");
    expect(displayOf(wrapper).pageContext.value?.url).toBe("/first?selected=row-2");
    expect(wrapper.find(".reporting-page").element).toBe(page);
  });

  it("opens what the reader asked the page for, as the reader's own navigation", async () => {
    const wrapper = await workbench();
    await openLink(wrapper, "/first");

    await wrapper.find(".reporting-page .navigate").trigger("click");
    await flushPromises();
    expect(pageParameter()).toBe("/second");
    expect(wrapper.find(".reporting-page .shown").text()).toBe("/second");
  });
});

describe("leaving a page with unsaved changes", () => {
  it("keeps the page and the address when the reader stays on a panel that reported them", async () => {
    reports.dirty = true;
    const wrapper = await workbench();
    await openLink(wrapper, "/first");

    expect(await displayOf(wrapper).navigate("/second", { view: "side", history: "push" })).toBe(false);
    await paneButton(wrapper, "close").trigger("click");
    await flushPromises();
    expect(pageParameter()).toBe("/first");
    expect(wrapper.find(".reporting-page .shown").text()).toBe("/first");
  });

  it("keeps the page and the address when the reader stays on a native page's draft", async () => {
    const wrapper = await workbench();
    await openLink(wrapper, "/draft");
    reports.nativeDirty = true;

    await openLink(wrapper, "/first");
    expect(pageParameter()).toBe("/draft");
    expect(wrapper.find(".draft-page").exists()).toBe(true);

    reports.leave = true;
    await openLink(wrapper, "/first");
    expect(pageParameter()).toBe("/first");
    expect(wrapper.find(".reporting-page").exists()).toBe(true);
  });
});
