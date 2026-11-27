import { flushPromises, mount } from "@vue/test-utils";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { DirectProjection as DirectProjectionRecord } from "@ontomato/contracts/product-panels";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { computed, h, nextTick, ref, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import { expect, it, vi } from "vitest";
import InfoBanner from "../../../apps-sdk/src/base/InfoBanner.vue";
import { panelContextKey } from "../../../apps-sdk/src/panel/context";
import { createDirectPanelInstance, type MemberInputs } from "../../../apps-sdk/src/panel/direct";
import { createPanelInstance } from "../../../apps-sdk/src/panel/instance";
import DirectProjection, { directMountKey } from "../../../apps-sdk/src/panel/direct-projection";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { MemberDataState } from "../../../apps-sdk/src/panel/member-data-state";
import PanelMember from "../../../apps-sdk/src/panel/PanelMember.vue";
import Projection from "../../../apps-sdk/src/panel/Projection.vue";
import { createPanelText } from "../../../apps-sdk/src/panel/text";

it("shows a record-driven banner only when its field has content and still renders static banners", async () => {
  const i18n = createI18n({
    legacy: false,
    locale: "en",
    messages: { en: { noticeTitle: "Run issue" } },
  });
  const record = shallowRef({ primaryKey: "run", label: "Run", fields: { reason: "", severity: "" } });
  const datum = computed(() => ({ status: "ready" as const, value: record.value }));
  const member: PanelMemberContext = {
    key: "notice",
    projection: {
      id: "notice",
      name: "Run notice",
      description: "",
      visibility: "domain",
      domainId: "default",
      ownerId: "owner",
      editable: true,
      revision: 1,
      createdAt: "",
      updatedAt: "",
      componentId: "@ontomato/sdk:InfoBanner",
      config: {},
      inputs: {},
      outputs: {},
      data: {
        record: {
          read: "record",
          source: { object: { literal: { className: "platform:Trigger", primaryKey: "task" } } },
          params: {},
        },
      },
    },
    inputs: computed(() => ({})),
    operations: computed(() => ({ status: "ready", value: {} })),
    data: { use: () => datum, read: async () => datum.value },
  };
  const global = { plugins: [i18n], provide: { [panelMemberKey as symbol]: () => member } };
  const bodyNotice = mount(InfoBanner, { props: { field: "reason", titleKey: "noticeTitle", hideWhenEmpty: true }, global });
  const toneNotice = mount(InfoBanner, { props: { toneField: "severity", title: "Severity" }, global });
  const staticNotice = mount(InfoBanner, { props: { title: "Read only", text: "Changes are disabled." }, global });

  expect(bodyNotice.find("aside").exists()).toBe(false);
  expect(toneNotice.find("aside").exists()).toBe(false);
  expect(staticNotice.get("aside").text()).toContain("Read only");
  expect(staticNotice.get("aside").text()).toContain("Changes are disabled.");

  record.value = { ...record.value, fields: { reason: "Credentials expired", severity: "danger" } };
  await nextTick();

  expect(bodyNotice.get("aside").text()).toContain("Run issue");
  expect(bodyNotice.get("aside").text()).toContain("Credentials expired");
  expect(toneNotice.get("aside").text()).toContain("Severity");
  expect(toneNotice.get("aside").attributes("data-tone")).toBe("danger");
});

it("hides a template banner whose bound field has no value, and draws it once the field carries one", async () => {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });
  const record = shallowRef({ primaryKey: "dashboardCardsStatus", label: "Dashboard card status", fields: {} as Record<string, unknown> });
  const datum = computed<MemberDataState>(() => ({ status: "ready", value: record.value } as unknown as MemberDataState));
  const member: PanelMemberContext = {
    key: "favoriteDashboardCardsNotice",
    projection: {
      id: "favoriteDashboardCardsNotice",
      name: "Unavailable dashboard cards notice",
      description: "",
      visibility: "domain",
      domainId: "default",
      ownerId: "owner",
      editable: false,
      revision: 1,
      createdAt: "",
      updatedAt: "",
      componentId: "@ontomato/sdk:InfoBanner",
      config: {},
      inputs: {},
      outputs: {},
      data: {
        record: {
          read: "dashboardCardsStatus",
          source: { object: { literal: { className: "platform:Favorite", primaryKey: "dashboardCardsStatus" } } },
          params: {},
        },
      },
    },
    inputs: computed(() => ({})),
    operations: computed(() => ({ status: "ready", value: {} })),
    data: { use: () => datum, read: async () => datum.value },
  };
  const global = { plugins: [i18n], provide: { [panelMemberKey as symbol]: () => member } };
  // The personal workspace board's notice as its panel declares it: a template sentence driven by `missingCount`, which
  // the owner leaves out of `fields` while no card is missing.
  const notice = mount(InfoBanner, {
    props: { field: "missingCount", template: "{missingCount} followed cards are unavailable.", hideWhenEmpty: true, compact: true },
    global,
  });

  expect(notice.find("aside").exists()).toBe(false);

  record.value = { ...record.value, fields: { missingCount: 2 } };
  await nextTick();

  expect(notice.get("aside").text()).toBe("2 followed cards are unavailable.");
});

it("collapses its direct member host when empty and restores it when populated", async () => {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: publicEn } });
  const projection: DirectProjectionRecord = {
    id: "default-policy-banner",
    domainId: "default",
    ownerId: "owner",
    revision: 1,
    createdAt: "",
    updatedAt: "",
    editable: false,
    visibility: "domain",
    name: "Default policy banner",
    description: "",
    componentId: "@ontomato/sdk:InfoBanner",
    inputs: {},
    outputs: {},
    config: { field: "defaultPolicyBadge", tone: "success", toneField: "defaultPolicyBadge", compact: true, hideWhenEmpty: true },
    data: {
      record: {
        read: "record",
        source: { object: { literal: { className: "platform:PermissionPolicy", primaryKey: "p-1" } } },
        params: {},
      },
    },
  };
  let badge = "";
  const unused = () => { throw new Error("Not used by banner test"); };
  const instance = createDirectPanelInstance(
    { state: {}, members: { defaultPolicyBanner: { target: { projectionId: projection.id } } } },
    {
      pageKey: "policy-detail",
      url: () => "/policies/p-1",
      label: () => "Policy detail",
      text: createPanelText({ en: {} }, ref("en"), "en"),
      readProjection: async () => projection,
      read: async (request): Promise<ProductPanelReadResponse> => {
        if (request.dataName !== "record") return { status: "ready", value: {} };
        return {
          status: "ready",
          value: {
            primaryKey: "p-1",
            label: "Policy",
            fields: badge ? { defaultPolicyBadge: { kind: "tag", label: badge, tone: "success" } } : {},
          },
        };
      },
      operations: { describe: unused, read: unused, upload: unused, prepare: unused },
      confirmOperation: unused,
      expandPageComposer: unused,
      navigate: unused,
      nested: unused,
      readComponentPackage: unused,
    },
  );
  const directMount = {
    instance,
    member: (member: string, slots?: Record<string, unknown>, inputs?: MemberInputs, values?: Record<string, unknown>) =>
      h(PanelMember, { instance, member, ...(inputs ? { inputs } : {}), ...(values ? { values } : {}) }, slots as never),
  };

  const wrapper = mount(DirectProjection, {
    props: { slot: "defaultPolicyBanner" },
    slots: { actions: () => h("span", { class: "hint" }, "Non-deletable") },
    global: {
      plugins: [i18n],
      provide: { [directMountKey as symbol]: directMount },
    },
  });

  await vi.waitFor(() => {
    expect(wrapper.element.hasAttribute("hidden")).toBe(true);
  });
  expect(wrapper.find("aside").exists()).toBe(false);

  badge = "Domain member default policy";
  await instance.refreshObjects();
  await flushPromises();

  expect(wrapper.element.hasAttribute("hidden")).toBe(false);
  expect(wrapper.get("aside").text()).toContain("Domain member default policy");
  expect(wrapper.get(".hint").text()).toBe("Non-deletable");

  badge = "";
  await instance.refreshObjects();
  await flushPromises();

  expect(wrapper.element.hasAttribute("hidden")).toBe(true);
  expect(wrapper.find("aside").exists()).toBe(false);
});

it("collapses its framed Projection host when empty and leaves outer member hosts unaffected by slot banners", async () => {
  const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });
  const bannerProjection: DirectProjectionRecord = {
    id: "banner",
    domainId: "default",
    ownerId: "owner",
    revision: 1,
    createdAt: "",
    updatedAt: "",
    editable: false,
    visibility: "domain",
    name: "Banner",
    description: "",
    componentId: "@ontomato/sdk:InfoBanner",
    inputs: {},
    outputs: {},
    config: { field: "note", hideWhenEmpty: true },
    data: {
      record: {
        read: "record",
        source: { object: { literal: { className: "platform:Trigger", primaryKey: "t-1" } } },
        params: {},
      },
    },
  };
  const outerProjection: DirectProjectionRecord = {
    ...bannerProjection,
    id: "outer",
    name: "Outer banner",
    config: { title: "Outer stays visible", text: "Always shown" },
    data: {},
  };
  const manifest = definePanel({
    state: {},
    members: {
      banner: { target: { projectionId: "banner" } },
      outer: { target: { projectionId: "outer" } },
    },
  });
  let note = "";
  const unused = () => { throw new Error("Not used"); };
  const instance = createPanelInstance(manifest, {
    text: (key) => key,
    pageKey: "frame-test",
    url: () => "/frame",
    label: () => "Frame",
    initial: {},
    operations: { describe: unused, read: unused, upload: unused, prepare: unused },
    confirmOperation: unused,
    readProjection: async (id) => (id === "banner" ? bannerProjection : outerProjection) as never,
  });
  const panelContext = {
    panel: { content: { html: "", module: "" }, manifest },
    manifest,
    instance,
    projection: (id: string) => instance.projection(id),
    invoke: unused,
    resources: async () => {},
    readPanelData: async (): Promise<ProductPanelReadResponse> => ({
      status: "ready",
      value: { primaryKey: "t-1", label: "Task", fields: note ? { note } : {} },
    }),
    projectionsChanged: () => () => {},
    state: instance.state,
    t: (key: string) => key,
  };

  const bannerWrapper = mount(Projection, {
    props: { slot: "banner" },
    global: { plugins: [i18n], provide: { [panelContextKey as symbol]: panelContext } },
  });

  await vi.waitFor(() => {
    expect(bannerWrapper.element.hasAttribute("hidden")).toBe(true);
  });
  expect(bannerWrapper.find("aside").exists()).toBe(false);

  note = "Warning message";
  instance.refreshObjects();
  await flushPromises();
  await vi.waitFor(() => {
    expect(bannerWrapper.element.hasAttribute("hidden")).toBe(false);
  });
  expect(bannerWrapper.get("aside").text()).toContain("Warning message");

  // A standalone empty InfoBanner inside another member's slot must never hide that outer member host.
  const outerWrapper = mount(Projection, {
    props: { slot: "outer" },
    slots: { actions: () => h(InfoBanner, { hideWhenEmpty: true, text: "" }) },
    global: { plugins: [i18n], provide: { [panelContextKey as symbol]: panelContext } },
  });

  await vi.waitFor(() => {
    expect(outerWrapper.find("aside").exists()).toBe(true);
  });
  expect(outerWrapper.element.hasAttribute("hidden")).toBe(false);
  expect(outerWrapper.get("aside").text()).toContain("Outer stays visible");
});
