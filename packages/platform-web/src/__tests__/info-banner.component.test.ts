import { mount } from "@vue/test-utils";
import { computed, nextTick, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import { expect, it } from "vitest";
import InfoBanner from "../../../apps-sdk/src/base/InfoBanner.vue";
import { panelMemberKey, type PanelMemberContext } from "../../../apps-sdk/src/panel/member";
import type { MemberDataState } from "../../../apps-sdk/src/panel/member-data-state";

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
